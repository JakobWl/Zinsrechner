import React from "react";

/**
 * A small, unobtrusive keyboard-shortcut badge.
 *
 * - `variant="inline"` renders a tiny pill that sits inline next to a
 *   button label (e.g. inside an antd Button).
 * - `variant="corner"` renders an absolutely-positioned badge that floats
 *   in the top-right corner of its closest `.kbd-anchor` ancestor. This
 *   is used for inputs/selects where there is no room inside the control.
 *
 * Both variants are deliberately subtle (low opacity, small font) so they
 * never disturb the existing design.
 */
export function KbdHint({
  keys,
  variant = "inline",
  ariaLabel,
}: {
  /** The key combination to display, e.g. "Ctrl+P" or "N". */
  keys: string;
  variant?: "inline" | "corner";
  ariaLabel?: string;
}) {
  return (
    <kbd
      className={variant === "corner" ? "kbd-hint kbd-hint-corner" : "kbd-hint"}
      aria-label={ariaLabel ?? `Tastenkürzel: ${keys}`}
    >
      {keys}
    </kbd>
  );
}

/**
 * A tiny convenience wrapper that provides a positioning anchor for
 * `variant="corner"` hints. Wrap any control with it:
 *
 *   <KbdAnchor><Input ... /><KbdHint keys="N" variant="corner" /></KbdAnchor>
 */
export function KbdAnchor({
  children,
  className = "",
  style,
}: {
  children: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
}) {
  return (
    <div className={`kbd-anchor ${className}`.trim()} style={style}>
      {children}
    </div>
  );
}