import { useEffect, useCallback } from "react";

type KeyCombo = {
  key: string;
  ctrl?: boolean;
  meta?: boolean;
  shift?: boolean;
  alt?: boolean;
};

/**
 * Register a keyboard shortcut.
 *
 * Per DESIGN.md:
 * - Single-key shortcuts disabled when input/textarea is focused
 * - Single-key shortcuts disabled when dialog/modal is open
 * - `?` opens shortcuts overlay
 *
 * @param combo - Key combination to listen for
 * @param callback - Function to call when shortcut is triggered
 * @param enabled - Whether the shortcut is active (default: true)
 */
export function useKeyboardShortcut(
  combo: KeyCombo | string,
  callback: () => void,
  enabled = true,
) {
  const parsed: KeyCombo = typeof combo === "string"
    ? { key: combo }
    : combo;

  const isModified = parsed.ctrl || parsed.meta || parsed.shift || parsed.alt;

  const handler = useCallback(
    (e: KeyboardEvent) => {
      if (!enabled) return;

      // Skip single-key shortcuts in inputs or when a dialog is open
      if (!isModified) {
        const target = e.target as HTMLElement;
        const tagName = target.tagName.toLowerCase();
        if (
          tagName === "input" ||
          tagName === "textarea" ||
          tagName === "select" ||
          target.isContentEditable
        ) {
          return;
        }

        // Check for open dialog/modal
        if (document.querySelector("[role='dialog']")) {
          return;
        }
      }

      // Match the key
      if (e.key.toLowerCase() !== parsed.key.toLowerCase()) return;
      if (parsed.ctrl && !e.ctrlKey) return;
      if (parsed.meta && !e.metaKey) return;
      if (parsed.shift && !e.shiftKey) return;
      if (parsed.alt && !e.altKey) return;

      e.preventDefault();
      callback();
    },
    [enabled, isModified, parsed.key, parsed.ctrl, parsed.meta, parsed.shift, parsed.alt, callback],
  );

  useEffect(() => {
    if (!enabled) return;
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [enabled, handler]);
}

/** Format a key combo for display in tooltips */
export function formatShortcut(combo: KeyCombo | string): string {
  const parsed: KeyCombo = typeof combo === "string" ? { key: combo } : combo;
  const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.userAgent);

  const parts: string[] = [];
  if (parsed.ctrl) parts.push(isMac ? "^" : "Ctrl");
  if (parsed.meta) parts.push(isMac ? "⌘" : "Ctrl");
  if (parsed.shift) parts.push(isMac ? "⇧" : "Shift");
  if (parsed.alt) parts.push(isMac ? "⌥" : "Alt");
  parts.push(parsed.key.length === 1 ? parsed.key.toUpperCase() : parsed.key);

  return isMac ? parts.join("") : parts.join("+");
}
