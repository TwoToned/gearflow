"use client";

import { useEffect, useRef } from "react";

/**
 * Test & tag mode's keyboard shortcuts (restored from the old quick-test page):
 *   Ctrl/⌘ + Enter      — save (the primary), even from inside a reading or a note
 *   Esc                 — go back: clear this scan (asks first over unsaved answers)
 *   Ctrl/⌘ + Shift + P  — Pass all visual checks
 * Only while a test card is open, never while a dialog or menu is open, and — apart
 * from Ctrl/⌘ + Enter — never while a text field has focus (Esc there leaves the field
 * alone; the field is the user's).
 */
export interface TtHotkeyActions {
  save: () => void;
  back: () => void;
  passAllVisual: () => void;
}

function isTypingTarget(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  const tag = el.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el.isContentEditable;
}

/** A dialog, sheet or open menu owns the keyboard (its own Esc closes it). */
function overlayOpen(): boolean {
  return !!document.querySelector("[role='dialog'], [role='menu'], [role='alertdialog']");
}

type KeyPress = Pick<KeyboardEvent, "key" | "ctrlKey" | "metaKey" | "shiftKey" | "altKey" | "target">;

/** `ctrl+shift+p`, `ctrl+enter`, `escape` — the press as one comparable word. */
function chord(e: KeyPress): string {
  const parts = [e.ctrlKey || e.metaKey ? "ctrl" : "", e.shiftKey ? "shift" : "", e.altKey ? "alt" : "", e.key.toLowerCase()];
  return parts.filter(Boolean).join("+");
}

const ANYWHERE: Record<string, keyof TtHotkeyActions> = { "ctrl+enter": "save" };
const OUTSIDE_FIELDS: Record<string, keyof TtHotkeyActions> = { "ctrl+shift+p": "passAllVisual", escape: "back" };

/** The action a key press asks for, or `null` when the page should leave it alone. */
export function ttHotkeyFor(e: KeyPress): keyof TtHotkeyActions | null {
  const c = chord(e);
  return ANYWHERE[c] ?? (isTypingTarget(e.target) ? null : (OUTSIDE_FIELDS[c] ?? null));
}

export function useTtHotkeys(open: boolean, actions: TtHotkeyActions) {
  const ref = useRef(actions);
  useEffect(() => {
    ref.current = actions;
  });
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.defaultPrevented || overlayOpen()) return;
      const action = ttHotkeyFor(e);
      if (!action) return;
      e.preventDefault();
      ref.current[action]();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);
}
