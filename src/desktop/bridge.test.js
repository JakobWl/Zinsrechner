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
    throw new Error("Unexpected command: " + command);
  });
  bridge = (await import("./bridge")).desktopBridge;
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
