import { test, expect, type Page } from "@playwright/test";

const account = { bankName: "Migration Bank", kontoNumber: "E2E-001", startDatum: "2025-01-01", endDatum: "2025-12-31", zinssatz: 4, nominal: 10000, dayCountConvention: "actual" };
async function launch(page: Page, options: { empty?: boolean; corrupt?: boolean; update?: string } = {}) {
  await page.addInitScript(({ account, options }) => {
    const initial = { "konten.json": JSON.stringify(options.empty ? [] : [account]), "prognose.json": "null", "history-groups.json": JSON.stringify([{ name: "Testgruppe", banks: ["Migration Bank"] }]) };
    const files = () => JSON.parse(localStorage.getItem("__files") || JSON.stringify(initial));
    const calls = () => JSON.parse(localStorage.getItem("__calls") || "[]");
    (window as any).isTauri = true;
    (window as any).__TAURI_INTERNALS__ = {
      invoke: async (command: string, args: any = {}) => {
        const log = calls(); log.push({ command, args }); localStorage.setItem("__calls", JSON.stringify(log));
        switch (command) {
          case "read_document":
            if (options.corrupt && args.name === "konten.json") throw new Error("Invalid saved JSON");
            return files()[args.name];
          case "write_document": {
            const current = files(); current[args.name] = args.content;
            localStorage.setItem("__files", JSON.stringify(current)); return;
          }
          case "distribution_info": return { store: true, version: "1.2.4", updaterConfigured: false, market: "AT" };
          case "update_metadata": return { Product: { DisplaySkuAvailabilities: [{ Sku: { Properties: { Packages: [{ PackageFullName: `Wideve.U.BBGZinsrechner_${options.update || "1.2.4.0"}_x64__svv3hhfbxqbc8` }] } } }] } };
          case "open_store": return;
          case "save_export": {
            if ((window as any).__cancelExport) return { saved: false };
            const exports = (window as any).__exports ||= {};
            exports[args.name] = args.bytes;
            return { saved: true, path: args.name };
          }
          case "create_print_window": (window as any).__printHtml = args.html; return "print-1";
          case "open_external": return;
          default: throw new Error("Unexpected native command: " + command);
        }
      },
    };
  }, { account, options });
  await page.goto("/");
  await expect(page.getByRole("button", { name: "Prognose öffnen" })).toBeVisible();
  if (!options.empty && !options.corrupt) await expect(page.getByText("E2E-001", { exact: true })).toBeVisible();
}
async function history(page: Page) {
  await page.getByRole("button", { name: "Chronologische Historie aller Banken öffnen" }).click();
  await page.getByText("Vorschau anzeigen", { exact: true }).click();
  return page.getByRole("dialog");
}
test("accounts retain the baseline interest result, support editing and persist after reload", async ({ page }) => {
  await launch(page);
  await expect(page.locator(".stat-card").filter({ hasText: "Gesamtzinsen (€)" })).toContainText("400.00");
  const paid = page.getByRole("spinbutton", { name: "Bezahlte Zinsen für Migration Bank E2E-001" });
  await paid.fill("50"); await paid.press("Tab");
  await expect.poll(() => page.evaluate(() => JSON.parse(JSON.parse(localStorage.getItem("__files") || "{}")["konten.json"])[0].verbuchteRueckstellung)).toBe(50);
  await page.reload();
  await expect(paid).toHaveValue("50");
  await expect(page.getByText("E2E-001", { exact: true })).toBeVisible();
});
test("adding, validating and deleting an account survives reload", async ({ page }) => {
  await launch(page, { empty: true });
  await page.getByRole("button", { name: "Konto hinzufügen" }).click();
  await expect(page.getByText("Bitte geben Sie den Banknamen ein.")).toBeVisible();
  await page.getByRole("textbox", { name: "Bankname", exact: true }).fill("Neue Bank");
  await page.getByRole("textbox", { name: "Kontonummer", exact: true }).fill("NEW-002");
  const form = page.getByRole("complementary");
  await form.getByPlaceholder("Startdatum").fill("01.01.2025");
  await form.getByPlaceholder("Startdatum").press("Enter");
  await form.getByPlaceholder("Enddatum").fill("31.12.2025");
  await form.getByPlaceholder("Enddatum").press("Enter");
  await expect(form.getByPlaceholder("Startdatum")).toHaveValue("01.01.2025");
  await expect(form.getByPlaceholder("Enddatum")).toHaveValue("31.12.2025");
  await page.getByRole("spinbutton", { name: "Zinssatz in Prozent" }).fill("4");
  await page.getByRole("spinbutton", { name: "Nominalbetrag in Euro" }).fill("10000");
  await page.getByRole("button", { name: "Konto hinzufügen" }).click();
  await expect(page.getByText("NEW-002", { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByText("NEW-002", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Konto löschen", exact: true }).click();
  await page.getByRole("button", { name: "Ja", exact: true }).click();
  await expect(page.getByText("NEW-002", { exact: true })).toHaveCount(0);
  await page.reload();
  await expect(page.getByText("NEW-002", { exact: true })).toHaveCount(0);
});
test("forecast state, history groups and chart survive desktop integration", async ({ page }) => {
  await launch(page);
  await page.getByRole("button", { name: "Prognose öffnen" }).click();
  await expect(page.getByText("Jahreswerte aus den Konten", { exact: true })).toBeVisible();
  await page.getByText("10 Jahre", { exact: true }).click();
  await expect.poll(() => page.evaluate(() => JSON.parse(JSON.parse(localStorage.getItem("__files") || "{}")["prognose.json"]).horizonYears)).toBe(10);
  await page.reload();
  await page.getByRole("button", { name: "Prognose öffnen" }).click();
  await expect(page.getByText("Jahreswerte aus den Konten", { exact: true })).toBeVisible();
  await expect(page.locator(".ant-segmented-item-selected")).toContainText("10 Jahre");
  const modal = await history(page);
  await expect(modal.getByText("Testgruppe", { exact: true }).first()).toBeVisible();
  await modal.getByRole("switch").click();
  await expect(modal.locator("canvas")).toBeVisible();
});
test("PDF and spreadsheet exports contain report data; cancel does not claim success", async ({ page }) => {
  await launch(page); const modal = await history(page);
  await modal.getByRole("button", { name: /Als PDF/ }).click();
  await expect.poll(() => page.evaluate(() => String.fromCharCode(...((window as any).__exports?.["Veranlagungshistorie.pdf"] || []).slice(0, 5)))).toBe("%PDF-");
  const pdfText = await page.evaluate(() => String.fromCharCode(...(window as any).__exports["Veranlagungshistorie.pdf"]));
  expect(pdfText).toContain("Migration Bank"); expect(pdfText).toContain("Testgruppe");
  await modal.getByRole("button", { name: /Als Excel/ }).click();
  await expect.poll(() => page.evaluate(() => new TextDecoder().decode(new Uint8Array((window as any).__exports?.["Veranlagungshistorie.xls"] || [])))).toContain("Migration Bank");
  await page.evaluate(() => { (window as any).__cancelExport = true; (window as any).__exports = {}; });
  await modal.getByRole("button", { name: /Als PDF/ }).click();
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem("__calls") || "[]").filter((c: any) => c.command === "save_export").length)).toBe(3);
  expect(await page.evaluate(() => Object.keys((window as any).__exports))).toEqual([]);
});
test("light, dark and system themes retain selection after reload", async ({ page }) => {
  await launch(page);
  await page.getByRole("button", { name: "Dunkles Theme", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.reload(); await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.getByRole("button", { name: "Helles Theme", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await page.emulateMedia({ colorScheme: "dark" });
  await page.getByRole("button", { name: "System Theme", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
});
test("printing sends a complete report and the layout responds to resize", async ({ page }) => {
  await launch(page);
  await page.locator(".quarter-range input").nth(0).fill("01.01.2025");
  await page.locator(".quarter-range input").nth(0).press("Tab");
  await page.locator(".quarter-range input").nth(1).fill("31.03.2025");
  await page.locator(".quarter-range input").nth(1).press("Tab");
  await page.getByRole("button", { name: "Anlagenübersicht für den gewählten Quartalszeitraum drucken" }).click();
  await expect.poll(() => page.evaluate(() => (window as any).__printHtml || "")).toContain("Migration Bank");
  await page.setViewportSize({ width: 1050, height: 750 });
  await expect(page.getByText("E2E-001", { exact: true })).toBeVisible();
  await page.screenshot({ path: ".jait/shots/tauri-ui.png" });
});
test("Store availability uses the published catalog and routes to Store updates", async ({ page }) => {
  await launch(page, { update: "1.2.5.0" });
  await page.getByRole("button", { name: "Aktualisieren", exact: true }).click();
  await expect.poll(() => page.evaluate(() => localStorage.getItem("__calls"))).toContain("open_store");
});
test("an unpublished Store update stays hidden", async ({ page }) => {
  await launch(page);
  await expect(page.getByRole("button", { name: "Aktualisieren", exact: true })).toHaveCount(0);
});
test("load errors are visible and do not overwrite saved accounts", async ({ page }) => {
  await launch(page, { corrupt: true });
  await expect(page.locator(".ant-alert")).toContainText("Die Kontodaten konnten nicht geladen werden.");
  const saves = await page.evaluate(() => JSON.parse(localStorage.getItem("__calls") || "[]").filter((c: any) => c.command === "write_document" && c.args.name === "konten.json"));
  expect(saves).toEqual([]);
});


test("forecast tables keep their rows visible and scroll into view at different window sizes", async ({ page }) => {
  await page.clock.setFixedTime(new Date("2025-06-01T12:00:00Z"));
  await launch(page);
  await page.getByRole("button", { name: "Prognose öffnen" }).click();
  const cards = page.locator(".forecast-card");
  await expect(cards).toHaveCount(3);
  for (const viewport of [{ width: 1600, height: 1000 }, { width: 1280, height: 720 }, { width: 1024, height: 600 }]) {
    await page.setViewportSize(viewport);
    for (const horizon of [3, 10]) {
      await page.getByText(`${horizon} Jahre`, { exact: true }).click();
      for (const card of await cards.all()) {
        const row = card.locator(".ant-table-tbody > tr:not(.ant-table-measure-row)").first();
        await row.scrollIntoViewIfNeeded();
        // Visibility alone does not detect rows clipped by an overflow:hidden ancestor.
        await expect(row).toBeInViewport();
        await expect.poll(async () => {
          const rowBox = await row.boundingBox();
          const bodyBox = await card.locator(".ant-card-body").boundingBox();
          return !!rowBox && !!bodyBox && rowBox.y >= bodyBox.y && rowBox.y + rowBox.height <= bodyBox.y + bodyBox.height + 1;
        }).toBe(true);
      }
    }
  }
});
