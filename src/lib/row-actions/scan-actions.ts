import { CheckCheck, ClipboardList, ExternalLink, Package, RotateCcw, ScanLine, Settings2, Trash2, Volume2, VolumeX, Wrench, X } from "lucide-react";

import type { ActionItem, ActionMenuSpec } from "@/lib/primitives/types";

/**
 * The Scan page's three menus (spec §9i.2, §9i.4): page ⋯, card ⋯ and the Last scans
 * row ⋯. An action that does not apply is ABSENT, never disabled; danger goes last
 * with a confirm. Test & tag mode's card items (Quick pass, Print label, Retire…)
 * join the card builder with that mode.
 */
type Entry = ActionItem | false | null | undefined | "";
const spec = (entries: Entry[]): ActionMenuSpec => ({ items: entries.filter((e): e is ActionItem => !!e) });

export interface ScanPageMenuCtx {
  soundsOn: boolean;
  hasLoaded: boolean;
  lastScanCount: number;
  canTestTag: boolean;
  canAssets: boolean;
  canCheckItemSettings: boolean;
  onToggleSounds: () => void;
  onClearScan: () => void;
  onOpen: (href: string) => void;
  onClearLastScans: () => void;
}

export function buildScanPageMenu(c: ScanPageMenuCtx): ActionMenuSpec {
  return spec([
    {
      key: "sounds",
      label: c.soundsOn ? "Scan sounds: On" : "Scan sounds: Off",
      group: "edit",
      icon: c.soundsOn ? Volume2 : VolumeX,
      onSelect: c.onToggleSounds,
    },
    c.hasLoaded && { key: "clear", label: "Clear this scan", group: "edit", icon: X, onSelect: c.onClearScan },
    c.canTestTag && { key: "tt-list", label: "Test & tag list", group: "organise", icon: ClipboardList, onSelect: () => c.onOpen("/test-and-tag") },
    c.canAssets && { key: "assets", label: "Assets", group: "organise", icon: Package, onSelect: () => c.onOpen("/assets/registry") },
    c.canCheckItemSettings && {
      key: "check-items",
      label: "Check items (settings)",
      group: "organise",
      icon: Settings2,
      onSelect: () => c.onOpen("/settings/check-items"),
    },
    c.lastScanCount > 0 && {
      key: "clear-last",
      label: "Clear last scans",
      group: "danger",
      icon: Trash2,
      danger: true,
      onSelect: c.onClearLastScans,
      confirm: {
        title: `Clear ${c.lastScanCount} last scan${c.lastScanCount === 1 ? "" : "s"}?`,
        body: "Only this list is cleared. Every saved check stays saved on its asset, and its Undo goes with the row.",
        confirmLabel: "Clear",
      },
    },
  ]);
}

export interface ScanCardMenuCtx {
  assetId: string | null;
  ttId: string | null;
  canTestTag: boolean;
  /** Unanswered pass/fail items remain. */
  canPassAll: boolean;
  onOpen: (href: string) => void;
  onPassAll: () => void;
  onClearScan: () => void;
  /** Absent without `maintenance:create`. */
  onCreateMaintenance?: () => void;
}

/** `Create maintenance job…` — present only when the caller may create one. */
function maintenanceItem(on: (() => void) | undefined): ActionItem | false {
  return !!on && { key: "maintenance", label: "Create maintenance job…", group: "edit", icon: Wrench, onSelect: on };
}

export function buildScanCardMenu(c: ScanCardMenuCtx): ActionMenuSpec {
  return spec([
    c.assetId && { key: "open", label: "Open asset", group: "edit", icon: ExternalLink, onSelect: () => c.onOpen(`/assets/registry/${c.assetId}`) },
    c.canPassAll && { key: "pass-all", label: "Pass all", group: "edit", icon: CheckCheck, onSelect: c.onPassAll },
    maintenanceItem(c.onCreateMaintenance),
    c.canTestTag && c.ttId && {
      key: "tt",
      label: "Open in test & tag list",
      group: "organise",
      icon: ClipboardList,
      onSelect: () => c.onOpen(`/test-and-tag/${c.ttId}`),
    },
    { key: "clear", label: "Clear this scan", group: "organise", icon: X, onSelect: c.onClearScan },
  ]);
}

export interface TtCardMenuCtx {
  assetId: string | null;
  ttId: string;
  testTagId: string;
  onOpen: (href: string) => void;
  /** Absent when the item has never been tested: there is no last test to repeat. */
  onQuickPass?: () => void;
  onClearScan: () => void;
  onRetire: () => void;
  /** Absent without `maintenance:create`, or for an item with no inventory asset. */
  onCreateMaintenance?: () => void;
}

/** Test & tag mode's card ⋯. Retire has no exact Undo, so it confirms and names what follows. */
export function buildTtCardMenu(c: TtCardMenuCtx): ActionMenuSpec {
  return spec([
    c.assetId && { key: "open", label: "Open asset", group: "edit", icon: ExternalLink, onSelect: () => c.onOpen(`/assets/registry/${c.assetId}`) },
    c.onQuickPass && { key: "quick-pass", label: "Quick pass: repeat the last test", group: "edit", icon: RotateCcw, onSelect: c.onQuickPass },
    maintenanceItem(c.onCreateMaintenance),
    { key: "tt", label: "Open in test & tag list", group: "organise", icon: ClipboardList, onSelect: () => c.onOpen(`/test-and-tag/${c.ttId}`) },
    { key: "clear", label: "Clear this scan", group: "organise", icon: X, onSelect: c.onClearScan },
    {
      key: "retire",
      label: "Retire from test & tag…",
      group: "danger",
      icon: Trash2,
      danger: true,
      onSelect: c.onRetire,
      confirm: {
        title: `Retire ${c.testTagId}?`,
        body: "It leaves the test & tag register: no more due reminders, and it can't be tested until it is reactivated (which starts it again as not yet tested). Its test history stays.",
        confirmLabel: "Retire",
      },
    },
  ]);
}

export interface ScanRowMenuCtx {
  assetId: string | null;
  tag: string;
  onOpen: (href: string) => void;
  onRescan: (tag: string) => void;
  /** A failed saved row only, and only with `maintenance:create`. */
  onCreateMaintenance?: () => void;
}

export function buildScanRowMenu(c: ScanRowMenuCtx): ActionMenuSpec {
  return spec([
    c.assetId && { key: "open", label: "Open asset", group: "edit", icon: ExternalLink, onSelect: () => c.onOpen(`/assets/registry/${c.assetId}`) },
    { key: "rescan", label: "Scan it again", group: "edit", icon: c.assetId ? RotateCcw : ScanLine, onSelect: () => c.onRescan(c.tag) },
    maintenanceItem(c.onCreateMaintenance),
  ]);
}
