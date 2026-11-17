"use client";

import * as React from "react";

import type { RowSelection } from "@/lib/primitives/types";

/**
 * Row selection for a list (playbook §3.5). `visibleIds` is the rows in DOM
 * order; Shift extends from the last-toggled row over that visible range.
 * Selection is by id, so it survives re-sorting; `togglePage` and `pageState`
 * speak only about the visible page.
 */
export function useRowSelection(visibleIds: readonly string[]): RowSelection {
  const [selected, setSelected] = React.useState<ReadonlySet<string>>(() => new Set());
  const anchor = React.useRef<string | null>(null);

  const toggle = React.useCallback(
    (id: string, opts?: { shift?: boolean }) => {
      setSelected((prev) => {
        const next = new Set(prev);
        const from = opts?.shift && anchor.current ? visibleIds.indexOf(anchor.current) : -1;
        const to = visibleIds.indexOf(id);
        if (from >= 0 && to >= 0) {
          const [a, b] = from < to ? [from, to] : [to, from];
          // The range takes the state the anchor row now has.
          const on = prev.has(anchor.current as string);
          for (const rid of visibleIds.slice(a, b + 1)) {
            if (on) next.add(rid);
            else next.delete(rid);
          }
        } else if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      });
      anchor.current = id;
    },
    [visibleIds],
  );

  const checked = visibleIds.filter((id) => selected.has(id)).length;
  const pageState: RowSelection["pageState"] =
    checked === 0 ? "none" : checked === visibleIds.length ? "all" : "some";

  const togglePage = React.useCallback(() => {
    setSelected((prev) => {
      const next = new Set(prev);
      const all = visibleIds.length > 0 && visibleIds.every((id) => prev.has(id));
      for (const id of visibleIds) {
        if (all) next.delete(id);
        else next.add(id);
      }
      return next;
    });
  }, [visibleIds]);

  const clear = React.useCallback(() => {
    anchor.current = null;
    setSelected(new Set());
  }, []);

  const isSelected = React.useCallback((id: string) => selected.has(id), [selected]);

  return { selected, isSelected, pageState, toggle, togglePage, clear, count: selected.size };
}
