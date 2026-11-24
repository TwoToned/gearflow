"use client";

import { useEffect, useState } from "react";
import type { GlobalSearchResponse } from "@/hooks/use-global-search";

const EMPTY: GlobalSearchResponse = { results: [], groups: [] };
const DEBOUNCE_MS = 250;

/**
 * The server search behind plain typing (2+ characters), debounced. The last
 * rows stay up while the next query runs (no flicker); `settled` is true only
 * once the rows belong to what is in the box, so "Nothing matches" is never
 * shown for a query that hasn't answered yet.
 */
export function useSearchMode(search: (q: string) => Promise<GlobalSearchResponse>, query: string, enabled: boolean) {
  const [data, setData] = useState<{ q: string; res: GlobalSearchResponse }>({ q: "", res: EMPTY });
  const [loading, setLoading] = useState(false);
  const q = enabled ? query.trim() : "";

  useEffect(() => {
    if (q.length < 2) {
      setLoading(false);
      return;
    }
    setLoading(true);
    let aborted = false;
    const timer = setTimeout(() => {
      search(q)
        .then((res) => !aborted && setData({ q, res }))
        .catch(() => !aborted && setData({ q, res: EMPTY }))
        .finally(() => !aborted && setLoading(false));
    }, DEBOUNCE_MS);
    return () => {
      aborted = true;
      clearTimeout(timer);
    };
  }, [search, q]);

  const current = q.length >= 2 ? data.res : EMPTY;
  return { ...current, loading, settled: q.length >= 2 && data.q === q && !loading };
}
