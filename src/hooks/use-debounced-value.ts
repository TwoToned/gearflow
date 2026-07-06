"use client";

import { useEffect, useState } from "react";

/**
 * Debounce a rapidly-changing value (e.g. a search box) so downstream effects /
 * queries only run after the value settles. Used to throttle native indexed
 * search subscriptions (`api.search.*`) as the user types.
 */
export function useDebouncedValue<T>(value: T, delayMs = 200): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(id);
  }, [value, delayMs]);
  return debounced;
}
