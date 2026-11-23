"use client";

import * as React from "react";

/**
 * Ticked ids with shift-click ranges (§9h.3): a plain click toggles one id; a
 * shift-click ticks every id between the last clicked one and this one, in
 * the order the surface shows them. `setAll` is the header's select-page.
 */
export function useRangeSelection() {
  const [ids, setIds] = React.useState<ReadonlySet<string>>(() => new Set());
  const last = React.useRef<string | null>(null);

  const toggle = React.useCallback((id: string, order: readonly string[], shift: boolean) => {
    setIds((prev) => {
      const next = new Set(prev);
      const from = last.current ? order.indexOf(last.current) : -1;
      const to = order.indexOf(id);
      if (shift && from >= 0 && to >= 0) {
        for (const k of order.slice(Math.min(from, to), Math.max(from, to) + 1)) next.add(k);
      } else if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    last.current = id;
  }, []);

  const setAll = React.useCallback((order: readonly string[], on: boolean) => {
    setIds(on ? new Set(order) : new Set());
    last.current = null;
  }, []);

  const clear = React.useCallback(() => {
    setIds(new Set());
    last.current = null;
  }, []);

  return { ids, toggle, setAll, clear, count: ids.size };
}
