"use client";

import { useEffect } from "react";

import type { CheckItemData, CheckStates } from "@/lib/check-item-state";

/**
 * The warehouse check sheet's keyboard shortcuts (`ItemCheckForm`):
 *   P / F         — pass or fail the focused PASS_FAIL row
 *   A             — pass all remaining PASS_FAIL rows (same as the button)
 *   ArrowUp/Down  — move the focused row cursor, skipping non-PASS_FAIL rows
 *   Enter         — submit if all complete
 * Ignored while a text input/textarea/select/contenteditable has focus, and while the
 * form is submitting or loading. The listener reads latest-value refs, so it binds
 * once per open.
 */
export interface CheckHotkeyState {
  items: CheckItemData[];
  focusedRowIndex: number;
  isSubmitting: boolean;
  isLoading: boolean;
}

function isTypingTarget(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  const tag = el.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el.isContentEditable;
}

/** Modifier keys → let the browser handle them (e.g. Cmd+R); typing → leave it alone. */
function isIgnoredKey(e: KeyboardEvent): boolean {
  return e.metaKey || e.ctrlKey || e.altKey || isTypingTarget(e.target);
}

function passFailIndices(items: CheckItemData[]): number[] {
  return items.map((mci, i) => (mci.checkItem.type === "PASS_FAIL" ? i : -1)).filter((i) => i >= 0);
}

function nextCursor(indices: number[], focused: number, down: boolean): number {
  const pos = indices.indexOf(focused);
  if (down) return indices[pos < 0 ? 0 : Math.min(pos + 1, indices.length - 1)];
  return indices[pos < 0 ? indices.length - 1 : Math.max(pos - 1, 0)];
}

export function useCheckHotkeys({
  open,
  stateRef,
  setCheckStates,
  setFocusedRowIndex,
  handlePassAllRef,
  handleSubmitRef,
}: {
  open: boolean;
  stateRef: React.RefObject<CheckHotkeyState>;
  setCheckStates: React.Dispatch<React.SetStateAction<CheckStates>>;
  setFocusedRowIndex: (i: number) => void;
  handlePassAllRef: React.RefObject<() => void>;
  handleSubmitRef: React.RefObject<() => void>;
}) {
  useEffect(() => {
    if (!open) return;

    function onPassFailKey(e: KeyboardEvent, s: CheckHotkeyState, indices: number[]) {
      const focusedItem = s.items[s.focusedRowIndex];
      if (!focusedItem || focusedItem.checkItem.type !== "PASS_FAIL") return;
      const result = e.key.toLowerCase() === "p" ? "PASS" : "FAIL";
      e.preventDefault();
      const id = focusedItem.checkItem.id;
      setCheckStates((prev) => ({ ...prev, [id]: { ...prev[id], result } }));
      // Auto-advance to next PASS_FAIL row
      const pos = indices.indexOf(s.focusedRowIndex);
      if (pos >= 0 && pos + 1 < indices.length) setFocusedRowIndex(indices[pos + 1]);
    }

    /** A, ↑ and ↓ — only meaningful when the list has pass/fail rows. */
    function onListKey(e: KeyboardEvent, key: string, s: CheckHotkeyState, indices: number[]) {
      if (indices.length === 0) return;
      if (key === "a") {
        e.preventDefault();
        handlePassAllRef.current();
      } else if (key === "arrowdown" || key === "arrowup") {
        e.preventDefault();
        setFocusedRowIndex(nextCursor(indices, s.focusedRowIndex, key === "arrowdown"));
      }
    }

    function onKey(e: KeyboardEvent) {
      const s = stateRef.current;
      if (s.isSubmitting || s.isLoading || isIgnoredKey(e)) return;
      const key = e.key.toLowerCase();
      const indices = passFailIndices(s.items);
      if (key === "p" || key === "f") return onPassFailKey(e, s, indices);
      if (key !== "enter") return onListKey(e, key, s, indices);
      e.preventDefault();
      handleSubmitRef.current();
    }

    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, stateRef, setCheckStates, setFocusedRowIndex, handlePassAllRef, handleSubmitRef]);
}
