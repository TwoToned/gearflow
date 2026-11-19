import type { QueryCtx } from "../_generated/server";

/**
 * The Assets list's derived segments (UX unification §9b, D13): "Due for T&T" and
 * "Needs attention". Derived on read from rows that already exist (test-tag
 * schedules, condition, status); nothing here is stored.
 */

export const ASSET_SEGMENT_KEYS = ["all", "available", "on-jobs", "maintenance", "retired", "due", "attention"] as const;
export type AssetSegmentKey = (typeof ASSET_SEGMENT_KEYS)[number];

const DAY_MS = 24 * 60 * 60 * 1000;
/** An asset is "due" when its next T&T date is within this window (or already past). */
export const DUE_HORIZON_MS = 30 * DAY_MS;
/** Upper bound on test-tag schedules read for the due set. */
export const DUE_READ_CAP = 2000;

const ATTENTION_CONDITIONS: readonly string[] = ["POOR", "DAMAGED"];

export function parseAssetSegment(raw: string | undefined): AssetSegmentKey {
  return ASSET_SEGMENT_KEYS.find((k) => k === raw) ?? "all";
}

/**
 * assetId -> earliest next T&T date, for this org's active schedules due within the
 * horizon (overdue included). One indexed range read on `by_organizationId_nextDueDate`
 * (org-scoped by the index), capped.
 */
export async function dueAssetMap(
  ctx: QueryCtx,
  orgId: string,
  now: number,
  cap: number = DUE_READ_CAP,
): Promise<{ due: Map<string, number>; truncated: boolean; cap: number }> {
  // Inactive schedules are filtered BEFORE the cap, so they cannot use it up.
  // One extra row is read to know whether the cap was hit.
  const rows = await ctx.db
    .query("testTagAssets")
    .withIndex("by_organizationId_nextDueDate", (q) => q.eq("organizationId", orgId).lte("nextDueDate", now + DUE_HORIZON_MS))
    .filter((q) => q.neq(q.field("isActive"), false))
    .take(cap + 1);
  const truncated = rows.length > cap;
  const due = new Map<string, number>();
  for (const r of rows.slice(0, cap)) {
    if (!r.assetId || r.nextDueDate == null) continue;
    const prior = due.get(r.assetId);
    if (prior === undefined || r.nextDueDate < prior) due.set(r.assetId, r.nextDueDate);
  }
  return { due, truncated, cap };
}

interface SegmentRow {
  id: string;
  status?: string | null;
  condition?: string | null;
}

type SegmentTest = (r: SegmentRow, due: Map<string, number>, now: number) => boolean;

const statusIs = (...s: string[]) => (r: SegmentRow): boolean => s.includes(r.status ?? "AVAILABLE");

const SEGMENT_TESTS: Record<AssetSegmentKey, SegmentTest> = {
  all: () => true,
  available: statusIs("AVAILABLE"),
  "on-jobs": statusIs("CHECKED_OUT", "RESERVED"),
  maintenance: statusIs("IN_MAINTENANCE"),
  retired: statusIs("RETIRED"),
  due: (r, due) => due.has(r.id),
  attention: (r, due, now) =>
    ATTENTION_CONDITIONS.includes(r.condition ?? "GOOD") || statusIs("IN_MAINTENANCE")(r) || (due.get(r.id) ?? Infinity) < now,
};

/** Pure: does the asset belong in `segment`? `due` is `dueAssetMap`'s result. */
export function assetInSegment(r: SegmentRow, segment: AssetSegmentKey, due: Map<string, number>, now: number): boolean {
  return SEGMENT_TESTS[segment](r, due, now);
}
