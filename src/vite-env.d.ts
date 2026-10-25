/// <reference types="vite/client" />
interface Window {
  desktop: import("./desktop/types").DesktopBridge;
  __TAURI_INTERNALS__?: unknown;
}
