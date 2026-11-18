"use client";

import { useEffect, useState } from "react";

import type { LineRowListSection } from "@/components/ui/line-row";
import type { ActionItem } from "@/lib/primitives/types";
import { isShortcutSuppressed } from "./use-row-shortcuts";

/**
 * E / M / D on the row under the pointer (spec §5.2: the shortcuts stay),
 * driven by the row's own `ActionMenu` spec: whatever item carries that `kbd`
 * is what the key runs, so the menu and the hotkey can never disagree. One
 * delegated pointer listener + one window keydown listener for the whole list
 * (a per-row hover hook cannot sit inside the primitive's `wrapRow`, which is
 * not a component). Skip rules are `isShortcutSuppressed`'s:
 * inputs, dialogs, menus and modifier keys are ignored.
 *
 * Spread the returned handlers on the list's wrapper element.
 */
export function useRowHotkeys(sections: LineRowListSection[], scope = "equipment") {
  const [hoverId, setHoverId] = useState<string | null>(null);
  const [pending, setPending] = useState<ActionItem | null>(null);

  useEffect(() => {
    if (!hoverId) return;
    const row = sections.flatMap((s) => s.rows).find((r) => r.id === hoverId);
    const items = row?.menu?.items ?? [];
    function onKey(event: KeyboardEvent) {
      if (event.metaKey || event.ctrlKey || event.altKey || isShortcutSuppressed()) return;
      if (!document.querySelector(`[data-shortcut-scope="${scope}"]`)) return;
      const item = items.find((i) => i.kbd?.toLowerCase() === event.key.toLowerCase());
      if (!item) return;
      event.preventDefault();
      // A confirm item (Delete) goes through the same confirm dialog as the menu.
      if (item.confirm) setPending(item);
      else void item.onSelect();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [hoverId, sections, scope]);

  return {
    /** Render `<ConfirmDialog item={pending} onClose={clearPending} />` next to the list. */
    pending,
    clearPending: () => setPending(null),
    handlers: hoverHandlers(setHoverId),
  };
}

function hoverHandlers(setHoverId: React.Dispatch<React.SetStateAction<string | null>>) {
  return {
    onMouseOver: (e: React.MouseEvent) => {
      const id = (e.target as HTMLElement).closest?.("[data-row-id]")?.getAttribute("data-row-id") ?? null;
      setHoverId((prev) => (prev === id ? prev : id));
    },
    onMouseLeave: () => setHoverId(null),
  };
}
