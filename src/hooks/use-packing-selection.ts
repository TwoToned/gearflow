"use client";

import { useCallback, useMemo, useRef, useState } from "react";

/**
 * Which Packing lines are ticked. `orderedIds` is every line in the order the
 * tab shows them (Unplanned first, then each case), so shift-tick selects a
 * range. A ticked id that is no longer on the tab (filtered out, deleted) is
 * dropped on read rather than carried silently into a bulk write.
 */
export function usePackingSelection(orderedIds: readonly string[]) {
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set());
  const anchor = useRef<string | null>(null);

  const visible = useMemo(() => new Set(orderedIds), [orderedIds]);
  const selected = useMemo(() => new Set([...picked].filter((id) => visible.has(id))), [picked, visible]);

  const toggle = useCallback(
    (id: string, opts: { range?: boolean } = {}) => {
      setPicked((prev) => {
        const next = new Set(prev);
        const from = anchor.current ? orderedIds.indexOf(anchor.current) : -1;
        const to = orderedIds.indexOf(id);
        if (opts.range && from >= 0 && to >= 0) {
          const [a, b] = from < to ? [from, to] : [to, from];
          for (const rangeId of orderedIds.slice(a, b + 1)) next.add(rangeId);
        } else if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      });
      anchor.current = id;
    },
    [orderedIds],
  );

  /** Tick or untick a whole group (a case card's header checkbox). */
  const setGroup = useCallback((ids: readonly string[], on: boolean) => {
    setPicked((prev) => {
      const next = new Set(prev);
      for (const id of ids) {
      if (on) next.add(id);
      else next.delete(id);
    }
      return next;
    });
  }, []);

  const replace = useCallback((ids: readonly string[]) => setPicked(new Set(ids)), []);
  const clear = useCallback(() => {
    setPicked(new Set());
    anchor.current = null;
  }, []);

  return { selected, count: selected.size, toggle, setGroup, replace, clear };
}
