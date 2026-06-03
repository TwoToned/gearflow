"use client";

/**
 * Per-row keyboard shortcuts for the project equipment table (Decision 8J
 * from the cross-type unification plan). While the mouse is over a row,
 * pressing a single key fires the matching action:
 *
 *   e → edit       (onEdit)
 *   m → move       (onMove)
 *   d → delete     (onDelete)
 *
 * Returns a small object of handlers to spread onto the row's
 * <TableRow>: onMouseEnter, onMouseLeave. The hook only attaches a
 * window keydown listener while the row is hovered, so at most one
 * listener is active across the whole table at any moment.
 *
 * Skip rules (do NOT fire shortcut):
 *   - focus is inside an <input>, <textarea>, or contentEditable element
 *   - focus is inside an open dialog ([role="dialog"]) or menu
 *     ([role="menu"]) — including portal-rendered ones
 *   - modifier key is held (cmd/ctrl/alt)
 *
 * Each callback is optional — undefined slots simply don't bind. So a
 * row that has no Move action just doesn't react to `m`.
 */

import { useEffect, useState } from "react";

export interface RowShortcutCallbacks {
  e?: () => void;
  m?: () => void;
  d?: () => void;
}

export function isShortcutSuppressed(): boolean {
  if (typeof document === "undefined") return true;
  const active = document.activeElement;
  if (!active) return false;
  if (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement) return true;
  if (active instanceof HTMLElement) {
    // `isContentEditable` is the spec-correct check but jsdom is unreliable
    // about it. Fall back to the attribute string for robustness.
    if (active.isContentEditable) return true;
    const ce = active.getAttribute("contenteditable");
    if (ce === "" || ce === "true" || ce === "plaintext-only") return true;
  }
  // Portal-rendered dialogs / menus — focus lands inside them so the
  // closest() lookup catches both rendered-in-place and portal cases.
  if (active.closest?.('[role="dialog"]')) return true;
  if (active.closest?.('[role="menu"]')) return true;
  return false;
}

export function useRowShortcuts(callbacks: RowShortcutCallbacks) {
  const [hovered, setHovered] = useState(false);
  const { e, m, d } = callbacks;

  useEffect(() => {
    if (!hovered) return;
    function handler(event: KeyboardEvent) {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (isShortcutSuppressed()) return;
      if (event.key === "e" && e) {
        event.preventDefault();
        e();
      } else if (event.key === "m" && m) {
        event.preventDefault();
        m();
      } else if (event.key === "d" && d) {
        event.preventDefault();
        d();
      }
    }
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [hovered, e, m, d]);

  return {
    onMouseEnter: () => setHovered(true),
    onMouseLeave: () => setHovered(false),
  };
}
