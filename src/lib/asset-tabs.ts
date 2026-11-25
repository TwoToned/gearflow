/**
 * The asset page's tabs (`/assets/registry/[id]`): the keys a `?tab=` deep link can
 * name, and the labels with their counts (UX Phase 12, §9d.2, D30). The page's tab
 * strip is CONTROLLED, so a key with no panel is unavailable and falls back to
 * Overview, like the job page's `JOB_TAB_KEYS`.
 */
import type { TabStripItem } from "@/components/ui/tab-strip";

export const ASSET_TAB_KEYS = ["overview", "availability", "checks", "maintenance", "history", "notes", "files"] as const;
export type AssetTabKey = (typeof ASSET_TAB_KEYS)[number];

const LABELS: Record<AssetTabKey, string> = {
  overview: "Overview",
  availability: "Availability",
  checks: "Checks",
  maintenance: "Maintenance",
  history: "History",
  notes: "Notes",
  files: "Files",
};

/** The tab a `?tab=` value names; anything unknown or not offered lands on Overview. */
export function resolveAssetTab(raw: string | null | undefined, available: readonly AssetTabKey[] = ASSET_TAB_KEYS): AssetTabKey {
  const key = (raw ?? "").toLowerCase();
  return (ASSET_TAB_KEYS as readonly string[]).includes(key) && available.includes(key as AssetTabKey) ? (key as AssetTabKey) : "overview";
}

export interface AssetTabCounts {
  maintenance?: number;
  history?: number;
  /** Photos + model documents. */
  files?: number;
}

/** The tab strip's items: counts in the count slot, never in the label. */
export function assetTabItems(counts: AssetTabCounts): TabStripItem[] {
  const count = (n: number | undefined) => (n && n > 0 ? n : undefined);
  const counted: Partial<Record<AssetTabKey, number | undefined>> = {
    maintenance: count(counts.maintenance),
    history: count(counts.history),
    files: count(counts.files),
  };
  return ASSET_TAB_KEYS.map((value) => ({ value, label: LABELS[value], count: counted[value] }));
}
