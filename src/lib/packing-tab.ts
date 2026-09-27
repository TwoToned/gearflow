/**
 * #1296 build plan phase 4 — the Packing tab's pure planning logic. Flattens
 * the Equipment tab's already-reconstructed tree (`CategoryData[]` +
 * top-level uncategorized lists — the SAME shape `useNativeEquipmentTab`
 * already builds for the Equipment tab, so this reuses its model/kit/group
 * attachment instead of re-deriving it) down to one list of plannable
 * top-level equipment lines, then buckets them by container the same way
 * `warehouse-types.ts`'s `buildContainerGroups` does for the warehouse tabs —
 * real/planned identity first, a "Not planned" bucket last.
 *
 * A line is "planned" once EITHER a PM has set `plannedContainerId` (intent)
 * OR any of its units has actually been packed (`containerId`, reality) —
 * actual overrides plan, matching `resolveItemContainerId` elsewhere. A kit
 * parent (or a Project Group's own member lines) is ONE plannable unit; kit
 * children are never separately listed (D3 — the whole kit moves together).
 *
 * Deliberately NOT implemented here: per-child override "split a kit across
 * containers at pack time" (D3 allows it, but only at physical pack time in
 * the warehouse — the Packing tab is the PLAN, always whole-kit, per D9).
 */
import type { CategoryData, GroupData, SubHireGroupData, LineItemData } from "@/components/projects/equipment-rows";

export interface PlannableLine {
  item: LineItemData;
  categoryName: string;
}

function isPlannableLine(item: LineItemData): boolean {
  if (item.type !== "EQUIPMENT") return false;
  if (item.isKitChild || item.isContainerLineItem) return false;
  return (item.status ?? "") !== "CANCELLED";
}

function collectFromGroup(g: GroupData, categoryName: string, into: PlannableLine[]): void {
  for (const item of g.lineItems ?? []) {
    if (isPlannableLine(item)) into.push({ item, categoryName });
  }
}

function collectFromSubHireGroup(sg: SubHireGroupData, categoryName: string, into: PlannableLine[]): void {
  for (const parent of sg.lineItems ?? []) {
    for (const child of parent.childLineItems ?? []) {
      if (isPlannableLine(child)) into.push({ item: child, categoryName });
    }
  }
}

function collectStandaloneLines(items: LineItemData[], categoryName: string, into: PlannableLine[]): void {
  for (const item of items) {
    if (isPlannableLine(item)) into.push({ item, categoryName });
  }
}

/** One category's own standalone lines + its groups' + sub-hire groups'
 *  member lines — split out of `collectPlannableLines` so that function's
 *  own branching stays under R-3.6; also reused for the "Uncategorized"
 *  pseudo-category. */
function collectFromCategoryLike(
  categoryName: string,
  lineItems: LineItemData[],
  groups: GroupData[],
  subHireGroups: SubHireGroupData[],
  into: PlannableLine[],
): void {
  collectStandaloneLines(lineItems, categoryName, into);
  for (const g of groups) collectFromGroup(g, categoryName, into);
  for (const sg of subHireGroups) collectFromSubHireGroup(sg, categoryName, into);
}

const UNCATEGORIZED_LABEL = "Uncategorized";

export function collectPlannableLines(
  categories: CategoryData[],
  uncategorizedItems: LineItemData[],
  uncategorizedProjectGroups: GroupData[],
  uncategorizedSubHireGroups: SubHireGroupData[],
): PlannableLine[] {
  const lines: PlannableLine[] = [];

  for (const cat of categories) {
    collectFromCategoryLike(cat.name, cat.lineItems ?? [], cat.groups ?? [], cat.subHireGroupTargets ?? [], lines);
  }
  collectFromCategoryLike(UNCATEGORIZED_LABEL, uncategorizedItems, uncategorizedProjectGroups, uncategorizedSubHireGroups, lines);

  return lines;
}

/** The real containerId a line's units are (majority) packed into, or `null`
 *  when none of its units carry one yet. Mirrors
 *  `warehouse-types.ts`'s `resolveItemContainerId` (independently
 *  reimplemented — that module reads the warehouse page's own `LineItem`
 *  shape, not `LineItemData`; same question, different input type). */
function resolvePackedContainerId(item: LineItemData): string | null {
  const units = item.units ?? [];
  if (units.length === 0) return null;
  const counts = new Map<string | null, number>();
  for (const u of units) {
    const key = u.containerId ?? null;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  let best: string | null = null;
  let bestN = -1;
  for (const [key, n] of counts) {
    if (n > bestN) {
      best = key;
      bestN = n;
    }
  }
  return best;
}

export type PackingStatus =
  | { kind: "packed"; containerId: string }
  | { kind: "planned"; containerId: string }
  | { kind: "unplanned" };

/** Actual overrides plan: a physically packed unit always wins over a stale
 *  or since-changed plan. */
export function resolvePackingStatus(item: LineItemData): PackingStatus {
  const packedId = resolvePackedContainerId(item);
  if (packedId) return { kind: "packed", containerId: packedId };
  if (item.plannedContainerId) return { kind: "planned", containerId: item.plannedContainerId };
  return { kind: "unplanned" };
}

export interface PackingContainerBucket {
  /** `null` = the "Not planned" bucket, always sorted last. */
  containerId: string | null;
  /** Resolved current label, or `null` for the Not-planned bucket. */
  label: string | null;
  lines: PlannableLine[];
}

/**
 * Bucket every plannable line by its resolved packing status, alphabetical
 * by container label with "Not planned" last — same ordering convention
 * `buildContainerGroups` uses for the warehouse tabs.
 */
export function buildPackingBuckets(
  lines: PlannableLine[],
  containerLabelById: Map<string, string>,
): PackingContainerBucket[] {
  const byContainerId = new Map<string | null, PlannableLine[]>();
  for (const line of lines) {
    const status = resolvePackingStatus(line.item);
    const key = status.kind === "unplanned" ? null : status.containerId;
    const arr = byContainerId.get(key) ?? [];
    arr.push(line);
    byContainerId.set(key, arr);
  }

  const sortedKeys = [...byContainerId.keys()].sort((a, b) => {
    if (a === null && b === null) return 0;
    if (a === null) return 1;
    if (b === null) return -1;
    const la = containerLabelById.get(a) ?? "";
    const lb = containerLabelById.get(b) ?? "";
    return la.localeCompare(lb);
  });

  return sortedKeys.map((containerId) => ({
    containerId,
    label: containerId ? (containerLabelById.get(containerId) ?? null) : null,
    lines: byContainerId.get(containerId)!,
  }));
}
