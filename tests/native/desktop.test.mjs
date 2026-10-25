import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { createWriteStream } from "node:fs";
import path from "node:path";
import { createServer } from "node:net";
import { Builder, By, until, Key } from "selenium-webdriver";

const root = path.resolve(".jait/artifacts/native", String(Date.now()));
const application = path.resolve(
  process.env.TAURI_TEST_BINARY ||
    `src-tauri/target/debug/zinsrechner${process.platform === "win32" ? ".exe" : ""}`,
);
const account = {
  bankName: "Migration Bank",
  kontoNumber: "E2E-001",
  startDatum: "2025-01-01",
  endDatum: "2025-12-31",
  zinssatz: 4,
  nominal: 10000,
  dayCountConvention: "actual",
};
const fixture = {
  Product: {
    DisplaySkuAvailabilities: [
      {
        Sku: {
          Properties: {
            Packages: [
              {
                PackageFullName:
                  "Wideve.U.BBGZinsrechner_1.2.4.0_x64__svv3hhfbxqbc8",
              },
            ],
          },
        },
      },
    ],
  },
};

async function freePort() {
  const socket = createServer();
  await new Promise((resolve, reject) =>
    socket.once("error", reject).listen(0, "127.0.0.1", resolve),
  );
  const port = socket.address().port;
  await new Promise((resolve) => socket.close(resolve));
  return port;
}

async function start(name, options = {}) {
  const dir = path.join(root, name);
  const legacy = path.join(dir, "legacy"),
    data = path.join(dir, "data");
  await mkdir(legacy, { recursive: true });
  await mkdir(data, { recursive: true });
  if (!options.reopen) {
    await writeFile(
      path.join(legacy, "konten.json"),
      options.corrupt ? "{broken" : JSON.stringify([account]),
    );
    await writeFile(path.join(legacy, "prognose.json"), "null");
    await writeFile(
      path.join(legacy, "history-groups.json"),
      JSON.stringify([{ name: "Native Gruppe", banks: ["Migration Bank"] }]),
    );
  }
  await writeFile(path.join(dir, "catalog.json"), JSON.stringify(fixture));
  const log = createWriteStream(path.join(dir, "driver.log"), { flags: "a" });
  const native =
    process.env.NATIVE_WEBDRIVER ||
    (process.platform === "linux"
      ? path.resolve(".jait/artifacts/tools/usr/bin/WebKitWebDriver")
      : undefined);
  const port = await freePort();
  let nativePort = await freePort();
  while (nativePort === port) nativePort = await freePort();
  const endpoint = `http://127.0.0.1:${port}`;
  const args = ["--port", String(port), "--native-port", String(nativePort)];
  if (native) args.push("--native-driver", native);
  const server = spawn(
    process.env.TAURI_DRIVER ||
      path.resolve(".jait/artifacts/tools/bin/tauri-driver"),
    args,
    {
      env: {
        ...process.env,
        WEBKIT_DISABLE_COMPOSITING_MODE: "1",
        XDG_CONFIG_HOME: path.join(dir, "config"),
        XDG_DATA_HOME: path.join(dir, "webview-data"),
        XDG_CACHE_HOME: path.join(dir, "cache"),
        ZINSRECHNER_E2E_DATA_DIR: data,
        ZINSRECHNER_E2E_LEGACY_DIR: legacy,
        ZINSRECHNER_E2E_EXPORT_DIR: path.join(dir, "exports"),
        ZINSRECHNER_E2E_STORE: "1",
        ZINSRECHNER_E2E_UPDATE_FIXTURE: path.join(dir, "catalog.json"),
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  server.stdout.pipe(log, { end: false });
  server.stderr.pipe(log, { end: false });
  const serverClosed = new Promise((resolve) =>
    server.once("close", () => {
      log.end();
      resolve();
    }),
  );
  let startupError;
  server.on("error", (error) => {
    startupError = error;
  });
  let driver;
  try {
    await new Promise((resolve, reject) => {
      server.once("error", reject);
      const deadline = Date.now() + 10000;
      const probe = async () => {
        if (startupError || server.exitCode !== null)
          return reject(
            startupError ||
              new Error(
                "tauri-driver exited; see " + path.join(dir, "driver.log"),
              ),
          );
        try {
          const r = await fetch(`${endpoint}/status`, {
            signal: AbortSignal.timeout(500),
          });
          if (r.ok) return resolve();
        } catch {}
        if (Date.now() > deadline)
          return reject(
            new Error(
              "tauri-driver did not start; see " + path.join(dir, "driver.log"),
            ),
          );
        setTimeout(probe, 100);
      };
      probe();
    });
    driver = await new Builder()
      .usingServer(endpoint)
      .withCapabilities({
        browserName: "wry",
        "tauri:options": { application },
      })
      .build();
    await driver
      .manage()
      .setTimeouts({ implicit: 0, script: 30000, pageLoad: 30000 });
    await driver.wait(
      async () => driver.executeScript("return !!window.desktop"),
      30000,
    );
  } catch (error) {
    server.kill();
    await serverClosed;
    throw error;
  }
  return {
    driver,
    dir,
    legacy,
    data,
    async close() {
      await driver.quit().catch(() => {});
      server.kill();
      await serverClosed;
    },
  };
}
const invoke = (driver, channel, ...args) =>
  driver
    .executeAsyncScript(
      "const done = arguments[arguments.length-1]; window.desktop.invoke(arguments[0], ...arguments[1]).then(v => done({value:v}), e => done({error:String(e)}));",
      channel,
      args,
    )
    .then((result) => {
      if (result.error) throw new Error(result.error);
      return result.value;
    });
const find = (driver, selector) =>
  driver.wait(until.elementLocated(By.css(selector)), 15000);
async function clickText(driver, text) {
  const element = await driver.wait(
    until.elementLocated(
      By.xpath(
        `//*[self::button or self::li or @role="menuitem"][normalize-space(.)="${text}"]`,
      ),
    ),
    10000,
  );
  await driver.wait(until.elementIsVisible(element), 10000);
  await element.click();
}

test(
  "native: Electron data migration, unchanged calculations, writes and relaunch persistence",
  { timeout: 90000 },
  async () => {
    let app = await start("persistence");
    try {
      const { driver, data, legacy } = app;
      await driver.wait(
        until.elementLocated(By.xpath('//*[text()="E2E-001"]')),
        20000,
      );
      assert.match(
        await driver.findElement(By.css(".stat-grid")).getText(),
        /400[.,]00/,
      );
      const loaded = JSON.parse(
        await readFile(path.join(data, "konten.json"), "utf8"),
      )[0];
      assert.equal(loaded.bankName, account.bankName);
      assert.equal(loaded.nominal, account.nominal);
      assert.equal(
        new Date(loaded.startDatum).getTime(),
        new Date(account.startDatum).getTime(),
      );
      const updated = [{ ...account, verbuchteRueckstellung: 75 }];
      await invoke(driver, "save-data", JSON.stringify(updated));
      await invoke(
        driver,
        "save-forecast",
        JSON.stringify({
          startYear: 2026,
          years: 5,
          variants: [],
          splitByVariant: {},
        }),
      );
      await invoke(
        driver,
        "save-history-groups",
        JSON.stringify([{ name: "Erhalten", banks: ["Migration Bank"] }]),
      );
      assert.deepEqual(
        JSON.parse(await readFile(path.join(legacy, "konten.json"), "utf8")),
        [account],
      );
      await app.close();
      app = await start("persistence", { reopen: true });
      assert.equal(
        JSON.parse(await invoke(app.driver, "load-data"))[0]
          .verbuchteRueckstellung,
        75,
      );
      assert.equal(
        JSON.parse(await invoke(app.driver, "load-history-groups"))[0].name,
        "Erhalten",
      );
      assert.equal(
        JSON.parse(await invoke(app.driver, "load-forecast")).years,
        5,
      );
    } finally {
      await app.close();
    }
  },
);

test(
  "native: PDF and SpreadsheetML exports are written through the real Rust bridge",
  { timeout: 90000 },
  async () => {
    const app = await start("exports");
    try {
      await app.driver.wait(
        until.elementLocated(By.xpath('//*[text()="E2E-001"]')),
        20000,
      );
      const rows = [
        {
          datum: "01.01.2025",
          bankName: "Migration Bank",
          menge: 10000,
          prozent: 4,
          ereignis: "Eröffnung",
          aenderung: "none",
        },
      ];
      const groups = [{ name: "Native Gruppe", banks: ["Migration Bank"] }];
      const pdf = await invoke(app.driver, "export-history-pdf", rows, groups);
      assert.equal(pdf.saved, true);
      const raw = await readFile(pdf.path);
      assert.equal(raw.subarray(0, 5).toString(), "%PDF-");
      assert.match(raw.toString("latin1"), /Migration Bank/);
      assert.match(raw.toString("latin1"), /Native Gruppe/);
      const excel = await invoke(
        app.driver,
        "export-history-excel",
        rows,
        groups,
      );
      assert.match(await readFile(excel.path, "utf8"), /<Workbook/);
      assert.match(await readFile(excel.path, "utf8"), /Migration Bank/);
    } finally {
      await app.close();
    }
  },
);

test(
  "native: forecast UI, charts, themes and resize work in the system webview",
  { timeout: 90000 },
  async () => {
    const app = await start("ui");
    try {
      const d = app.driver;
      await (await find(d, '[aria-label="Dunkles Theme"]')).click();
      await d.wait(
        async () =>
          (await d.findElement(By.css("html")).getAttribute("data-theme")) ===
          "dark",
        10000,
      );
      await d.navigate().refresh();
      await d.wait(
        async () =>
          (await d.findElement(By.css("html")).getAttribute("data-theme")) ===
          "dark",
        10000,
      );
      await d.wait(
        until.elementLocated(By.xpath('//*[text()="E2E-001"]')),
        20000,
      );
      await (await find(d, '[aria-label="Prognose öffnen"]')).click();
      await d.wait(
        until.elementLocated(
          By.xpath('//*[text()="Plan und Zinssätze je Jahr"]'),
        ),
        15000,
      );
      // Forecast starts in table mode; history exercises the real chart renderer.
      await (
        await find(
          d,
          '[aria-label="Chronologische Historie aller Banken öffnen"]',
        )
      ).click();
      await clickText(d, "Vorschau anzeigen");
      const toggle = await find(d, '[role="dialog"] [role="switch"]');
      await d.wait(until.elementIsVisible(toggle), 10000);
      // Native WebKit can return the modal before its entrance animation ends.
      await d.wait(async () => {
        if ((await toggle.getAttribute("aria-checked")) === "true") return true;
        await toggle.click();
        return (await toggle.getAttribute("aria-checked")) === "true";
      }, 10000);

      await d.wait(until.elementLocated(By.css("canvas")), 15000);
      await d.manage().window().setRect({ width: 1100, height: 800 });
      await mkdir(".jait/shots", { recursive: true });
      await writeFile(
        ".jait/shots/tauri-native.png",
        await d.takeScreenshot(),
        "base64",
      );
    } finally {
      await app.close();
    }
  },
);

test(
  "native: physical-print preview opens with report content and safe rendering",
  { timeout: 90000 },
  async () => {
    const app = await start("printing");
    try {
      const d = app.driver;
      const original = await d.getWindowHandle();
      await d.wait(
        until.elementLocated(By.xpath('//*[text()="E2E-001"]')),
        20000,
      );
      const quarter = await d.findElements(By.css(".quarter-range input"));
      await quarter[0].sendKeys("01.01.2025", Key.TAB);
      await quarter[1].sendKeys("31.03.2025", Key.TAB);
      await (
        await find(
          d,
          '[aria-label="Anlagenübersicht für den gewählten Quartalszeitraum drucken"]',
        )
      ).click();
      await d.wait(
        async () => (await d.getAllWindowHandles()).length === 2,
        15000,
      );
      const windows = await d.getAllWindowHandles();
      await d.switchTo().window(windows.find((w) => w !== original));
      await writeFile(
        path.join(app.dir, "print-preview.txt"),
        (await d.getCurrentUrl()) + "\n" + (await d.getPageSource()),
      );
      await d.wait(
        until.elementLocated(By.css(".print-toolbar button")),
        15000,
      );
      assert.match(
        await d.findElement(By.css("body")).getText(),
        /Migration Bank/,
      );
      assert.match(await d.findElement(By.css("body")).getText(), /E2E-001/);
      // OS print dialogs and hardware output remain a manual release check.
    } finally {
      await app.close();
    }
  },
);

test(
  "native: corrupt Electron data is reported and the original stays intact",
  { timeout: 90000 },
  async () => {
    const app = await start("corrupt", { corrupt: true });
    try {
      await assert.rejects(
        () => invoke(app.driver, "load-data"),
        /migration failed/,
      );
      await assert.rejects(() => invoke(app.driver, "save-data", "[]"));
      assert.equal(
        await readFile(path.join(app.legacy, "konten.json"), "utf8"),
        "{broken",
      );
    } finally {
      await app.close();
    }
  },
);

test(
  "native: published Store catalog controls update visibility",
  { timeout: 90000 },
  async () => {
    const app = await start("updates");
    try {
      assert.equal(
        (await invoke(app.driver, "check-update-available")).available,
        false,
      );
      const changed = structuredClone(fixture);
      changed.Product.DisplaySkuAvailabilities[0].Sku.Properties.Packages[0].PackageFullName =
        "Wideve.U.BBGZinsrechner_1.2.5.0_x64__svv3hhfbxqbc8";
      await writeFile(
        path.join(app.dir, "catalog.json"),
        JSON.stringify(changed),
      );
      assert.equal(
        (await invoke(app.driver, "check-update-available")).available,
        true,
      );
      await writeFile(path.join(app.dir, "catalog.json"), "{}");
      assert.equal(
        (await invoke(app.driver, "check-update-available")).available,
        false,
      );
    } finally {
      await app.close();
    }
  },
);
