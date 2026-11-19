"use client";

/**
 * Suppression rule shared by the Equipment list's row hotkeys
 * (`use-row-hotkeys.ts`: E / M / D on the hovered row). Do NOT fire a shortcut
 * when focus is inside an <input>, <textarea>, a contentEditable element, an
 * open dialog ([role="dialog"]) or a menu ([role="menu"]), including
 * portal-rendered ones.
 */
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
