/**
 * #1296 build plan phase 4 — the Packing tab's pure planning logic. Flattens
 * the Equipment tab's already-reconstructed tree (`CategoryData[]` +
 * top-level uncategorized lists — the SAME shape `useNativeEquipmentTab`
 * already builds for the Equipment tab, so this reuses its model/kit/group
 * attachment instead of re-deriving it) down to one list of plannable
 * top-level equipment lines, then buckets them by container the same way
 * `warehouse-types.ts`'s `buildContainerGroups` does for the warehouse tabs —
 * real/planned identity first, a "Loose" bucket last.
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
import { isPackedUnit } from "../../convex/lib/packedUnit";

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
  // "Packed" is `isPackedUnit` (the server's own predicate, `convex/lib/packedUnit.ts`):
  // ANY non-cancelled unit in a case, however many of its siblings are still loose.
  const counts = new Map<string, number>();
  for (const u of item.units ?? []) if (isPackedUnit(u)) counts.set(u.containerId!, (counts.get(u.containerId!) ?? 0) + 1);
  let best: string | null = null;
  let bestN = 0;
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

/** A plannable line's display name (kit, model, then free text). */
export function lineDisplayName(item: LineItemData): string {
  if (item.kitId) return item.kit?.name ?? item.description ?? "Kit";
  return item.model?.name ?? item.description ?? "—";
}

/** A line can be dragged / bulk-planned only while nothing of it is physically
 *  packed: packed wins over the plan and the office never moves physical gear
 *  (§7b.3). The server enforces the same rule (`skipped: PACKED`). */
export function canDragLine(item: LineItemData): boolean {
  return resolvePackingStatus(item).kind !== "packed";
}

/**
 * The glyph rule (§7b.3, fixes finding 2): `packed` is true when a unit is
 * physically in a case; `plannedElsewhere` is `Planned → LX-04` and appears
 * ONLY when the plan disagrees with reality (a plan exists and names a
 * different case than the one the gear is in). A line whose plan and reality
 * agree, or that is planned but not yet packed, carries no glyph: its card is
 * the statement.
 */
export function planGlyph(
  item: LineItemData,
  containerLabelById: ReadonlyMap<string, string>,
): { packed: boolean; plannedElsewhere: string | null } {
  const status = resolvePackingStatus(item);
  if (status.kind !== "packed") return { packed: false, plannedElsewhere: null };
  const planned = item.plannedContainerId;
  if (!planned || planned === status.containerId) return { packed: true, plannedElsewhere: null };
  return { packed: true, plannedElsewhere: `Planned → ${containerLabelById.get(planned) ?? "another case"}` };
}

/** The tab's `Packing n/m` count: planned-or-packed over plannable lines.
 *  The ONE derivation (Phase 7's tab slot calls this, R-3.1). */
export function packingCounts(lines: readonly PlannableLine[]): { planned: number; total: number } {
  let planned = 0;
  for (const { item } of lines) if (resolvePackingStatus(item).kind !== "unplanned") planned++;
  return { planned, total: lines.length };
}

export type PackingStatusFilter = "all" | "planned" | "packed" | "unplanned";

export interface PackingFilters {
  search: string;
  category: string | null;
  status: PackingStatusFilter;
}

export const NO_PACKING_FILTERS: PackingFilters = { search: "", category: null, status: "all" };

export const packingFiltersActive = (f: PackingFilters): boolean => f.search.trim() !== "" || f.category !== null || f.status !== "all";

/** Narrow the plannable lines for the toolbar's search / Category / Status. */
export function filterPlannableLines(lines: readonly PlannableLine[], f: PackingFilters): PlannableLine[] {
  const needle = f.search.trim().toLowerCase();
  return lines.filter(({ item, categoryName }) => {
    if (f.category && categoryName !== f.category) return false;
    if (needle && !`${lineDisplayName(item)} ${categoryName}`.toLowerCase().includes(needle)) return false;
    if (f.status === "all") return true;
    const kind = resolvePackingStatus(item).kind;
    return kind === f.status;
  });
}

/** What a drop does: which lines go, or why nothing does. A ticked row drags the
 *  whole selection; an unticked one drags only itself. Pure so the rule is tested. */
export type DropPlan =
  | { kind: "plan"; ids: string[]; target: { id: string; label: string } | null }
  | { kind: "refused"; message: string };

export function resolveDrop(args: {
  activeId: string;
  selected: ReadonlySet<string>;
  /** The card dropped on: `null` target = Unplanned. */
  target: { id: string; label: string; sealed: boolean } | null;
  /** Lines the user may drag (not packed, not in a sealed case). */
  canDrag: (id: string) => boolean;
}): DropPlan {
  if (args.target?.sealed) {
    return { kind: "refused", message: `${args.target.label} is sealed. Unseal it to plan lines into it.` };
  }
  const wanted = args.selected.has(args.activeId) ? [...args.selected] : [args.activeId];
  const ids = wanted.filter(args.canDrag);
  if (ids.length === 0) return { kind: "refused", message: "Packed lines stay where the warehouse put them." };
  return { kind: "plan", ids, target: args.target ? { id: args.target.id, label: args.target.label } : null };
}

/** Footer facts (§7b.2): `44 lines · 249 units · 3 packed in the warehouse`. */
export function packingFooterFacts(lines: readonly PlannableLine[]): { lines: number; units: number; packed: number } {
  let units = 0;
  let packed = 0;
  for (const { item } of lines) {
    units += item.quantity ?? 0;
    if (resolvePackingStatus(item).kind === "packed") packed++;
  }
  return { lines: lines.length, units, packed };
}

/** Row subtitle (§7b.2): `Category · Kit moves whole · Sub-hire · Custom`. */
export function lineSubtitle(item: LineItemData, categoryName: string): string {
  const parts = [categoryName];
  if (item.kitId) parts.push("Kit · moves whole");
  if (item.subHireId || item.subHireGroupId) parts.push("Sub-hire");
  if (item.isCustomItem) parts.push("Custom");
  return parts.join(" · ");
}

export interface PackingContainerBucket {
  /** `null` = the "Loose" bucket, always sorted last. */
  containerId: string | null;
  /** Resolved current label, or `null` for the Not-planned bucket. */
  label: string | null;
  lines: PlannableLine[];
}

/**
 * Bucket every plannable line by its resolved packing status, alphabetical
 * by container label with "Loose" last — same ordering convention
 * `buildContainerGroups` uses for the warehouse tabs.
 */
export function buildPackingBuckets(
  lines: PlannableLine[],
  containerLabelById: Map<string, string>,
  /** Every container on the job. Each gets a bucket even with no lines, so an
   *  empty case is visible (and can be renamed or nested) on the Packing tab. */
  allContainerIds: readonly string[] = [],
): PackingContainerBucket[] {
  const byContainerId = new Map<string | null, PlannableLine[]>(allContainerIds.map((id) => [id, []]));
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

/** The muted kind word on a case card, by `projectContainers.kind` (the same
 *  words the New container sheet's tabs use). */
export const CONTAINER_KIND_WORDS = { ASSET: "Case", BULK_ASSET: "Bulk tub", CUSTOM: "Custom" } as const;

/** A case card's header facts (§7b.2): `n lines · m packed`, and the lines
 *  that are only PLANNED into it — the ones "Unpack" can send loose. A packed
 *  line stays: packed wins, and the office never moves physical gear (§7b.3). */
export function caseCardFacts(bucket: PackingContainerBucket): { lineCount: number; packedCount: number; plannedOnlyIds: string[] } {
  let packedCount = 0;
  const plannedOnlyIds: string[] = [];
  for (const { item } of bucket.lines) {
    if (resolvePackingStatus(item).kind === "packed") packedCount++;
    else plannedOnlyIds.push(item.id);
  }
  return { lineCount: bucket.lines.length, packedCount, plannedOnlyIds };
}

/** `id` and every container nested (at any depth) inside it — the cases a
 *  "Move into" list must not offer, since that would nest a case in itself.
 *  UX filter only: the server's cycle check is the authority. */
export function caseAndDescendantIds(
  containers: ReadonlyArray<{ id: string; parentContainerId?: string | null }>,
  id: string,
): Set<string> {
  const out = new Set([id]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const c of containers) {
      if (c.parentContainerId && out.has(c.parentContainerId) && !out.has(c.id)) {
        out.add(c.id);
        grew = true;
      }
    }
  }
  return out;
}
