import { useEffect, useMemo, useState, type MouseEvent } from "react";
import { isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";

function reportWindowError(error: unknown) {
  console.error(error);
  window.dispatchEvent(
    new CustomEvent("desktop-error", { detail: String(error) }),
  );
}

export function handleWindowDrag(event: MouseEvent<HTMLElement>) {
  if (!isTauri() || event.button !== 0) return;
  if (!event.currentTarget.contains(event.target as Node)) return;
  if (
    (event.target as Element).closest(
      "button, a, input, select, textarea, [role='button'], [role^='menuitem']",
    )
  )
    return;
  event.preventDefault();
  const appWindow = getCurrentWindow();
  const action =
    event.detail === 2 ? appWindow.toggleMaximize() : appWindow.startDragging();
  void action.catch(reportWindowError);
}

export function WindowControls() {
  const appWindow = useMemo(() => (isTauri() ? getCurrentWindow() : null), []);
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    if (!appWindow) return;
    let active = true;
    let timer: number | undefined;
    let unlisten: (() => void) | undefined;
    const refresh = () => {
      void appWindow
        .isMaximized()
        .then((value) => {
          if (active) setMaximized(value);
        })
        .catch(reportWindowError);
    };
    refresh();
    void appWindow
      .onResized(() => {
        window.clearTimeout(timer);
        timer = window.setTimeout(refresh, 150);
      })
      .then((stop) => {
        if (active) unlisten = stop;
        else stop();
      })
      .catch(reportWindowError);
    return () => {
      active = false;
      window.clearTimeout(timer);
      unlisten?.();
    };
  }, [appWindow]);

  if (!appWindow) return null;

  return (
    <div
      className="app-window-controls"
      role="group"
      aria-label="Fenstersteuerung"
    >
      <button
        type="button"
        aria-label="Fenster minimieren"
        title="Minimieren"
        onClick={() => void appWindow.minimize().catch(reportWindowError)}
      >
        <svg aria-hidden="true" width="12" height="12" viewBox="0 0 12 12">
          <path d="M1 6h10" fill="none" stroke="currentColor" />
        </svg>
      </button>
      <button
        type="button"
        aria-label={
          maximized ? "Fenster wiederherstellen" : "Fenster maximieren"
        }
        title={maximized ? "Wiederherstellen" : "Maximieren"}
        onClick={() => void appWindow.toggleMaximize().catch(reportWindowError)}
      >
        {maximized ? (
          <svg aria-hidden="true" width="12" height="12" viewBox="0 0 12 12">
            <path
              d="M3.5 2.5V1.5h7v7h-1M1.5 3.5h7v7h-7z"
              fill="none"
              stroke="currentColor"
            />
          </svg>
        ) : (
          <svg aria-hidden="true" width="12" height="12" viewBox="0 0 12 12">
            <path d="M1.5 1.5h9v9h-9z" fill="none" stroke="currentColor" />
          </svg>
        )}
      </button>
      <button
        type="button"
        className="app-window-close"
        aria-label="Fenster schließen"
        title="Schließen"
        onClick={() => void appWindow.close().catch(reportWindowError)}
      >
        <svg aria-hidden="true" width="12" height="12" viewBox="0 0 12 12">
          <path d="M1.5 1.5l9 9m0-9l-9 9" fill="none" stroke="currentColor" />
        </svg>
      </button>
    </div>
  );
}
