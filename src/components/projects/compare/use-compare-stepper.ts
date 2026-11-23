"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { stepDirectionForKey, type BridgeSegment, type CompareRow } from "@/components/projects/compare/compare-model";

function hasModifierKey(e: KeyboardEvent): boolean {
  return e.metaKey || e.ctrlKey || e.altKey || e.shiftKey;
}

function isTypingTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  const tag = el?.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || !!el?.isContentEditable;
}

/** Any open dialog or menu OTHER than the Compare sheet itself (which is a dialog too:
 *  it is, or contains, the `[data-compare-sheet]` marker). */
function isOtherOverlayOpen(): boolean {
  const marker = document.querySelector("[data-compare-sheet]");
  const open = document.querySelectorAll('[data-state="open"][role="dialog"], [data-state="open"][role="menu"]');
  return Array.from(open).some((el) => el !== marker && !(marker && el.contains(marker)));
}

/**
 * The Compare sheet's change stepper (D52, kept per overseer Q9): `n`/`p` and
 * the ‹ › buttons step through the changed rows and move keyboard FOCUS (not
 * just scroll); a bridge segment jumps to its first row. Keys are ignored
 * while typing or while another dialog/menu is open. Mount it under a `key`
 * that changes with the compared pair so the index resets by remount.
 */
export function useCompareStepper(changedRows: CompareRow[]) {
  const [activeIndex, setActiveIndex] = useState(0);
  const rowElsRef = useRef(new Map<string, HTMLTableRowElement>());

  const registerRow = useCallback((key: string, el: HTMLTableRowElement | null) => {
    if (el) rowElsRef.current.set(key, el);
    else rowElsRef.current.delete(key);
  }, []);

  const focusRowByKey = useCallback((key: string) => {
    const el = rowElsRef.current.get(key);
    if (!el) return;
    el.focus();
    el.scrollIntoView({ block: "center", behavior: "smooth" });
  }, []);

  const stepTo = useCallback(
    (delta: number) => {
      if (changedRows.length === 0) return;
      setActiveIndex((i) => {
        const next = Math.min(Math.max(i + delta, 0), changedRows.length - 1);
        focusRowByKey(changedRows[next].key);
        return next;
      });
    },
    [changedRows, focusRowByKey],
  );

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (hasModifierKey(e)) return;
      const dir = stepDirectionForKey(e.key);
      if (!dir || isTypingTarget(e.target) || isOtherOverlayOpen()) return;
      e.preventDefault();
      stepTo(dir);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [stepTo]);

  const jumpToSegment = useCallback(
    (seg: BridgeSegment) => {
      const key = seg.rowKeys[0];
      const idx = key ? changedRows.findIndex((r) => r.key === key) : -1;
      if (idx < 0) return;
      setActiveIndex(idx);
      focusRowByKey(key);
    },
    [changedRows, focusRowByKey],
  );

  return { activeIndex, stepTo, registerRow, jumpToSegment };
}
