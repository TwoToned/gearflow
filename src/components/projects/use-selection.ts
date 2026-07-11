"use client";

import { useState, useCallback, useRef } from "react";

export function useSelection() {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const lastClickedIdRef = useRef<string | null>(null);

  const toggle = useCallback((id: string, _metaKey: boolean) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
    lastClickedIdRef.current = id;
  }, []);

  const selectTo = useCallback((id: string, allSortableIds: string[]) => {
    const lastId = lastClickedIdRef.current;
    if (!lastId) {
      setSelectedIds(new Set([id]));
      lastClickedIdRef.current = id;
      return;
    }

    const lastIndex = allSortableIds.indexOf(lastId);
    const currentIndex = allSortableIds.indexOf(id);
    if (lastIndex === -1 || currentIndex === -1) {
      setSelectedIds(new Set([id]));
      lastClickedIdRef.current = id;
      return;
    }

    const start = Math.min(lastIndex, currentIndex);
    const end = Math.max(lastIndex, currentIndex);
    const rangeIds = allSortableIds.slice(start, end + 1);

    setSelectedIds((prev) => {
      const next = new Set(prev);
      for (const rid of rangeIds) {
        next.add(rid);
      }
      return next;
    });
    lastClickedIdRef.current = id;
  }, []);

  const select = useCallback((id: string) => {
    setSelectedIds(new Set([id]));
    lastClickedIdRef.current = id;
  }, []);

  /** Replace the whole selection with exactly these ids (e.g. a select-all). */
  const selectAll = useCallback((ids: string[]) => {
    setSelectedIds(new Set(ids));
    lastClickedIdRef.current = ids.length > 0 ? ids[ids.length - 1] : null;
  }, []);

  const clearSelection = useCallback(() => {
    setSelectedIds(new Set());
    lastClickedIdRef.current = null;
  }, []);

  const isSelected = useCallback(
    (id: string) => selectedIds.has(id),
    [selectedIds],
  );

  return {
    selectedIds,
    lastClickedId: lastClickedIdRef.current,
    selectionSize: selectedIds.size,
    toggle,
    selectTo,
    select,
    selectAll,
    clearSelection,
    isSelected,
  };
}
