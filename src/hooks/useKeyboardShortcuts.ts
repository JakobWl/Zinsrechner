import { useEffect } from "react";

/**
 * Global keyboard-shortcut handler.
 *
 * Each actionable element in the app carries a `data-kbd` attribute whose
 * value is the shortcut name (e.g. `data-kbd="history"`). This hook listens
 * for `keydown` events, builds a normalised combo string (`Alt+H`,
 * `Ctrl+P`, …) and dispatches to the matching element:
 *
 *   - buttons / clickable controls  → `.click()`
 *
 * Shortcuts are ignored while the user is typing inside a free-text field
 * (so that letters like "b" or "n" can still be entered). Modifier-based
 * combos (Ctrl/Alt) are always allowed because they never collide with
 * plain typing.
 */
const SHORTCUTS: Record<string, string> = {
  // Header
  "Alt+H": "history",
  "Alt+1": "theme-light",
  "Alt+2": "theme-system",
  "Alt+3": "theme-dark",
  // Form actions
  "Ctrl+Enter": "submit-konto",
  // Table / export
  "Ctrl+P": "print",
  // History modal
  "Alt+P": "history-pdf",
  "Alt+E": "history-excel",
  // Group config modal
  "Alt+G": "group-add",
};

function comboFor(e: KeyboardEvent): string {
  const parts: string[] = [];
  if (e.altKey) parts.push("Alt");
  if (e.ctrlKey || e.metaKey) parts.push("Ctrl");
  let key = e.key;
  if (key === " ") key = "Space";
  key = key.length === 1 ? key.toUpperCase() : key;
  // Ignore bare modifier presses
  if (key === "Alt" || key === "Control" || key === "Meta" || key === "Shift")
    return "";
  parts.push(key);
  return parts.join("+");
}

export function useKeyboardShortcuts() {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const combo = comboFor(e);
      if (!combo) return;

      // Don't hijack plain typing inside text fields. Modifier combos are
      // always safe and take precedence.
      const target = e.target as HTMLElement | null;
      const isTyping =
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable) &&
        !e.altKey &&
        !e.ctrlKey &&
        !e.metaKey;
      if (isTyping) return;

      const name = SHORTCUTS[combo];
      if (!name) return;

      const el = document.querySelector<HTMLElement>(`[data-kbd="${name}"]`);
      if (!el) return;

      // Skip disabled controls
      const closestBtn = el.closest(
        "button, .ant-btn, [role='button']",
      ) as HTMLElement | null;
      if (
        closestBtn &&
        (closestBtn as HTMLButtonElement).disabled
      )
        return;
      const ariaDisabled = el.getAttribute("aria-disabled");
      if (ariaDisabled === "true") return;

      e.preventDefault();

      const isClickable =
        el.tagName === "BUTTON" ||
        el.getAttribute("role") === "button" ||
        el.classList.contains("ant-btn");
      if (isClickable) {
        (el as HTMLElement).click();
      } else {
        (el as HTMLElement).focus();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);
}