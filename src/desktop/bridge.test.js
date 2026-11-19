import { beforeEach, expect, test, vi } from "vitest";

const native = vi.hoisted(() => ({
  invoke: vi.fn(),
  check: vi.fn(),
  relaunch: vi.fn(),
}));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: native.invoke,
  isTauri: () => true,
}));
vi.mock("@tauri-apps/plugin-updater", () => ({ check: native.check }));
vi.mock("@tauri-apps/plugin-process", () => ({ relaunch: native.relaunch }));
let bridge;
beforeEach(async () => {
  vi.resetModules();
  vi.resetAllMocks();
  native.invoke.mockImplementation(async (command) => {
    if (command === "distribution_info")
      return { store: false, version: "1.2.4", updaterConfigured: true };
    if (command === "update_metadata") return { tag_name: "v1.2.5" };
    if (command === "backup_before_update") return "backup.bak";
    throw new Error("Unexpected command: " + command);
  });
  bridge = (await import("./bridge")).desktopBridge;
});

test("a failed backup aborts the installation", async () => {
  const update = { version: "1.2.5", download: vi.fn(), install: vi.fn() };
  native.check.mockResolvedValue(update);
  await bridge.invoke("check-for-updates");
  const original = native.invoke.getMockImplementation();
  native.invoke.mockImplementation(async (command, args) => {
    if (command === "backup_before_update") throw new Error("disk full");
    return original(command, args);
  });
  expect(await bridge.invoke("install-update")).toEqual({ ok: false });
  expect(update.install).not.toHaveBeenCalled();
  expect(native.relaunch).not.toHaveBeenCalled();
});

test("standalone builds without signing configuration hide updates and cannot install", async () => {
  native.invoke.mockImplementation(async (command) =>
    command === "distribution_info"
      ? { store: false, version: "1.2.4", updaterConfigured: false }
      : { tag_name: "v1.2.5" },
  );
  expect(await bridge.invoke("check-update-available")).toEqual({
    available: false,
  });
  expect(await bridge.invoke("check-for-updates")).toMatchObject({
    status: "error",
  });
  expect(await bridge.invoke("install-update")).toEqual({ ok: false });
  expect(native.check).not.toHaveBeenCalled();
  expect(native.relaunch).not.toHaveBeenCalled();
});

test("concurrent update requests download once and restart only after installation", async () => {
  const update = {
    version: "1.2.5",
    close: vi.fn(),
    install: vi.fn().mockResolvedValue(undefined),
    download: vi.fn(async (progress) => {
      progress({ event: "Started", data: { contentLength: 100 } });
      progress({ event: "Progress", data: { chunkLength: 50 } });
      progress({ event: "Finished" });
    }),
  };
  native.check.mockResolvedValue(update);
  const statuses = [];
  bridge.on("update-status", (_event, value) => statuses.push(value));
  const results = await Promise.all([
    bridge.invoke("check-for-updates"),
    bridge.invoke("check-for-updates"),
  ]);
  expect(results.every((result) => result.status === "downloaded")).toBe(true);
  expect(update.download).toHaveBeenCalledTimes(1);
  expect(statuses).toContainEqual({ status: "downloading", percent: 50 });
  expect(native.relaunch).not.toHaveBeenCalled();
  expect(await bridge.invoke("install-update")).toEqual({ ok: true });
  expect(update.install.mock.invocationCallOrder[0]).toBeLessThan(
    native.relaunch.mock.invocationCallOrder[0],
  );
});

test("a rejected download cannot be installed or trigger restart", async () => {
  const update = {
    version: "1.2.5",
    download: vi.fn().mockRejectedValue(new Error("Invalid signature")),
    install: vi.fn(),
  };
  native.check.mockResolvedValue(update);
  expect(await bridge.invoke("check-for-updates")).toMatchObject({
    status: "error",
    message: expect.stringContaining("Invalid signature"),
  });
  expect(await bridge.invoke("install-update")).toEqual({ ok: false });
  expect(update.install).not.toHaveBeenCalled();
  expect(native.relaunch).not.toHaveBeenCalled();
});

test("rapid saves are written in order and coalesced to the newest content", async () => {
  const writes = [];
  let release;
  native.invoke.mockImplementation(async (command, args) => {
    if (command !== "write_document") throw new Error("Unexpected command: " + command);
    writes.push(args);
    if (writes.length === 1) await new Promise((resolve) => (release = resolve));
  });
  const first = bridge.invoke("save-data", "[1]");
  const second = bridge.invoke("save-data", "[2]");
  const third = bridge.invoke("save-data", "[3]");
  const other = bridge.invoke("save-forecast", "{}");
  await Promise.resolve();
  release();
  await Promise.all([first, second, third, other]);
  const konten = writes.filter((w) => w.name === "konten.json").map((w) => w.content);
  expect(konten).toEqual(["[1]", "[3]"]);
  expect(writes).toContainEqual({ name: "prognose.json", content: "{}" });
});

test("a failed save is reported but later saves still go through", async () => {
  let fail = true;
  native.invoke.mockImplementation(async (command) => {
    if (command !== "write_document") throw new Error("Unexpected command: " + command);
    if (fail) { fail = false; throw new Error("disk full"); }
  });
  await expect(bridge.invoke("save-data", "[1]")).rejects.toThrow("disk full");
  await expect(bridge.invoke("save-data", "[2]")).resolves.toBeUndefined();
});

test("installation failure is reported without restarting the app", async () => {
  const update = {
    version: "1.2.5",
    download: vi.fn(),
    install: vi.fn().mockRejectedValue(new Error("Access denied")),
  };
  native.check.mockResolvedValue(update);
  await bridge.invoke("check-for-updates");
  expect(await bridge.invoke("install-update")).toEqual({ ok: false });
  expect(native.relaunch).not.toHaveBeenCalled();
});
