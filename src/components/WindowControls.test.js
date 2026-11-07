import { beforeEach, expect, test, vi } from "vitest";

const native = vi.hoisted(() => ({
  startDragging: vi.fn().mockResolvedValue(),
  toggleMaximize: vi.fn().mockResolvedValue(),
}));

vi.mock("@tauri-apps/api/core", () => ({ isTauri: () => true }));
vi.mock("@tauri-apps/api/window", () => ({ getCurrentWindow: () => native }));

import { handleWindowDrag } from "./WindowControls";

beforeEach(() => vi.clearAllMocks());

function mouseEvent({ inside = true, interactive = false, detail = 1 } = {}) {
  return {
    button: 0,
    detail,
    currentTarget: { contains: () => inside },
    target: { closest: () => interactive ? {} : null },
    preventDefault: vi.fn(),
  };
}

test("portal menu clicks do not start a window drag or prevent the click", () => {
  const event = mouseEvent({ inside: false });
  handleWindowDrag(event);
  expect(event.preventDefault).not.toHaveBeenCalled();
  expect(native.startDragging).not.toHaveBeenCalled();
  expect(native.toggleMaximize).not.toHaveBeenCalled();
});

test("header controls do not drag, but the header itself still does", () => {
  const control = mouseEvent({ interactive: true });
  handleWindowDrag(control);
  expect(control.preventDefault).not.toHaveBeenCalled();
  const drag = mouseEvent();
  handleWindowDrag(drag);
  expect(drag.preventDefault).toHaveBeenCalledOnce();
  expect(native.startDragging).toHaveBeenCalledOnce();
  handleWindowDrag(mouseEvent({ detail: 2 }));
  expect(native.toggleMaximize).toHaveBeenCalledOnce();
});