import { CheckCheck, ClipboardList, ExternalLink, Package, RotateCcw, ScanLine, Settings2, Trash2, Volume2, VolumeX, X } from "lucide-react";

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
}

export function buildScanCardMenu(c: ScanCardMenuCtx): ActionMenuSpec {
  return spec([
    c.assetId && { key: "open", label: "Open asset", group: "edit", icon: ExternalLink, onSelect: () => c.onOpen(`/assets/registry/${c.assetId}`) },
    c.canPassAll && { key: "pass-all", label: "Pass all", group: "edit", icon: CheckCheck, onSelect: c.onPassAll },
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

export interface ScanRowMenuCtx {
  assetId: string | null;
  tag: string;
  onOpen: (href: string) => void;
  onRescan: (tag: string) => void;
}

export function buildScanRowMenu(c: ScanRowMenuCtx): ActionMenuSpec {
  return spec([
    c.assetId && { key: "open", label: "Open asset", group: "edit", icon: ExternalLink, onSelect: () => c.onOpen(`/assets/registry/${c.assetId}`) },
    { key: "rescan", label: "Scan it again", group: "edit", icon: c.assetId ? RotateCcw : ScanLine, onSelect: () => c.onRescan(c.tag) },
  ]);
}
