import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { describe, expect, it, vi } from "vitest";

const script = readFileSync(new URL("../../public/startup.js", import.meta.url), "utf8");

function start({ hash = "", tauri = true, theme = "light" } = {}) {
  const handlers = {};
  const controls = {
    addEventListener: (type, handler) => { handlers[type] = handler; },
    contains: () => true,
    remove: vi.fn(),
  };
  const header = { addEventListener: (type, handler) => { handlers[type] = handler; } };
  const startup = {
    dataset: {},
    remove: vi.fn(),
    querySelector: (selector) => selector === ".startup-controls" ? controls : header,
  };
  const appWindow = {
    minimize: vi.fn().mockResolvedValue(),
    toggleMaximize: vi.fn().mockResolvedValue(),
    close: vi.fn().mockResolvedValue(),
    startDragging: vi.fn().mockResolvedValue(),
  };
  runInNewContext(script, {
    document: { getElementById: () => startup },
    window: {
      location: { hash },
      matchMedia: () => ({ matches: false }),
      __TAURI__: tauri ? { window: { getCurrentWindow: () => appWindow } } : undefined,
    },
    localStorage: { getItem: () => theme },
    console,
  });
  return { startup, controls, handlers, appWindow };
}

describe("startup window controls", () => {
  it("works before React loads", () => {
    const { startup, handlers, appWindow } = start({ theme: "dark" });
    expect(startup.dataset.theme).toBe("dark");
    for (const action of ["minimize", "toggleMaximize", "close"]) {
      const button = { dataset: { action } };
      handlers.click({ target: { closest: () => button } });
      expect(appWindow[action]).toHaveBeenCalledOnce();
    }
    const event = { button: 0, detail: 1, target: { closest: () => null }, preventDefault: vi.fn() };
    handlers.mousedown(event);
    expect(appWindow.startDragging).toHaveBeenCalledOnce();
    handlers.mousedown({ ...event, detail: 2 });
    expect(appWindow.toggleMaximize).toHaveBeenCalledTimes(2);
  });

  it("does not show window controls in a browser or print preview", () => {
    expect(start({ tauri: false }).controls.remove).toHaveBeenCalledOnce();
    expect(start({ hash: "#print" }).startup.remove).toHaveBeenCalledOnce();
  });
});