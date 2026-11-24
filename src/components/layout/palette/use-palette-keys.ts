"use client";

import type { KeyboardEvent } from "react";
import type { PaletteRow } from "@/lib/palette/model";

interface Keys {
  rows: readonly PaletteRow[];
  selectedIndex: number;
  setSelectedIndex: (i: number | ((i: number) => number)) => void;
  drilling: boolean;
  /** The drill filter box is empty (Backspace then steps back out). */
  drillEmpty: boolean;
  /** Plain search (not `/`, `@` or a drill): children can be shown/hidden. */
  plain: boolean;
  /** undefined = toggle. */
  toggleChildren: (on?: boolean) => void;
  exitDrill: () => void;
  enterDrill: () => void;
  activate: () => void;
}

/** The next selectable index; with Shift, the next PARENT (skips a parent's children). */
function step(rows: readonly PaletteRow[], from: number, dir: 1 | -1, skipChildren: boolean): number {
  let i = from + dir;
  while (skipChildren && i > 0 && i < rows.length && rows[i].isChild) i += dir;
  return Math.max(0, Math.min(i, rows.length - 1));
}

/** Esc / Backspace leave a drill first; Esc otherwise closes (the dialog does that). */
function stepOut(e: KeyboardEvent, k: Keys): boolean {
  const out = (e.key === "Escape" && k.drilling) || (e.key === "Backspace" && k.drilling && k.drillEmpty);
  if (!out) return false;
  e.preventDefault();
  e.stopPropagation();
  k.exitDrill();
  return true;
}

/** ⌘L toggles children; Shift+→ shows them, Shift+← hides them (plain search only). */
function childKeys(e: KeyboardEvent, k: Keys): boolean {
  if (!k.plain) return false;
  const mod = e.metaKey || e.ctrlKey;
  const on = mod && e.key === "l" ? undefined : e.shiftKey && e.key === "ArrowRight" ? true : e.shiftKey && e.key === "ArrowLeft" ? false : null;
  if (on === null) return false;
  e.preventDefault();
  k.toggleChildren(on);
  return true;
}

/** ↑ ↓ move (Shift skips children), Tab drills in (or opens, inside a drill), Enter opens. */
function moveKeys(e: KeyboardEvent, k: Keys): void {
  if (e.key === "ArrowDown" || e.key === "ArrowUp") {
    e.preventDefault();
    k.setSelectedIndex(step(k.rows, k.selectedIndex, e.key === "ArrowDown" ? 1 : -1, e.shiftKey && !k.drilling));
  } else if (e.key === "Tab") {
    e.preventDefault();
    if (k.drilling) k.activate();
    else k.enterDrill();
  } else if (e.key === "Enter" && k.rows[k.selectedIndex]) {
    e.preventDefault();
    k.activate();
  }
}

/** The palette input's keys (§6d.3: ↑ ↓ move, Enter opens, Esc closes; drill-down kept from live). */
export function usePaletteKeys(k: Keys) {
  return (e: KeyboardEvent) => {
    if (stepOut(e, k) || childKeys(e, k)) return;
    moveKeys(e, k);
  };
}
