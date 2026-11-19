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
const DUE_READ_CAP = 2000;

const ATTENTION_CONDITIONS: readonly string[] = ["POOR", "DAMAGED"];

export function parseAssetSegment(raw: string | undefined): AssetSegmentKey {
  return ASSET_SEGMENT_KEYS.find((k) => k === raw) ?? "all";
}

/**
 * assetId -> earliest next T&T date, for this org's active schedules due within the
 * horizon (overdue included). One indexed range read on `by_organizationId_nextDueDate`
 * (org-scoped by the index), capped.
 */
export async function dueAssetMap(ctx: QueryCtx, orgId: string, now: number): Promise<Map<string, number>> {
  const rows = await ctx.db
    .query("testTagAssets")
    .withIndex("by_organizationId_nextDueDate", (q) => q.eq("organizationId", orgId).lte("nextDueDate", now + DUE_HORIZON_MS))
    .take(DUE_READ_CAP);
  const due = new Map<string, number>();
  for (const r of rows) {
    if (!r.assetId || r.nextDueDate == null || r.isActive === false) continue;
    const prior = due.get(r.assetId);
    if (prior === undefined || r.nextDueDate < prior) due.set(r.assetId, r.nextDueDate);
  }
  return due;
}

interface SegmentRow {
  id: string;
  status?: string | null;
  condition?: string | null;
}

type SegmentTest = (r: SegmentRow, due: Map<string, number>, now: number) => boolean;

const statusIs = (...s: string[]): SegmentTest => (r) => s.includes(r.status ?? "AVAILABLE");

const SEGMENT_TESTS: Record<AssetSegmentKey, SegmentTest> = {
  all: () => true,
  available: statusIs("AVAILABLE"),
  "on-jobs": statusIs("CHECKED_OUT", "RESERVED"),
  maintenance: statusIs("IN_MAINTENANCE"),
  retired: statusIs("RETIRED"),
  due: (r, due) => due.has(r.id),
  attention: (r, due, now) =>
    ATTENTION_CONDITIONS.includes(r.condition ?? "GOOD") || statusIs("IN_MAINTENANCE")(r, due, now) || (due.get(r.id) ?? Infinity) < now,
};

/** Pure: does the asset belong in `segment`? `due` is `dueAssetMap`'s result. */
export function assetInSegment(r: SegmentRow, segment: AssetSegmentKey, due: Map<string, number>, now: number): boolean {
  return SEGMENT_TESTS[segment](r, due, now);
}
