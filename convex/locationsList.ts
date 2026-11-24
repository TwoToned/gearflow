import { v } from "convex/values";
import { query } from "./_generated/server";
import type { QueryCtx } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
import { requireOrgReadFor } from "./lib/auth";
import type { AgentOpsAnnotations } from "./lib/agentOps";
import { matchesSearch, compareValues, paginateItems } from "./lib/listQuery";
import { clampPageSize, collectCapped } from "./lib/pagination";
import {
  LOCATION_SEGMENT_KEYS,
  binLabelState,
  locationFill,
  locationInSegment,
  parseLocationSegment,
  subtreeTotals,
  type LocationSegmentKey,
} from "./lib/locationFacts";

/**
 * UX Phase 14 (14a-2) list reads for Locations. Fill, bin-label state and the strip words are
 * derived (convex/lib/locationFacts.ts); `lastMovementAt` is stamped by convex/lib/locationMovement.ts
 * and printed `—` when absent. Reads are `by_organizationId` + `collectCapped`.
 */

/** Stored count per location: assets + bulk-asset lines + kits (the same figure `locations.counts` returns). */
async function loadStoredCounts(ctx: QueryCtx, orgId: string): Promise<{ stored: Map<string, number>; truncated: boolean }> {
  const [assets, bulk, kits] = await Promise.all([
    collectCapped(ctx.db.query("assets").withIndex("by_organizationId", (q) => q.eq("organizationId", orgId))),
    collectCapped(ctx.db.query("bulkAssets").withIndex("by_organizationId", (q) => q.eq("organizationId", orgId))),
    collectCapped(ctx.db.query("kits").withIndex("by_organizationId", (q) => q.eq("organizationId", orgId))),
  ]);
  const stored = new Map<string, number>();
  const bump = (id: string | undefined) => id && stored.set(id, (stored.get(id) ?? 0) + 1);
  for (const a of assets.rows) if (a.isActive !== false) bump(a.locationId);
  for (const b of bulk.rows) if (b.isActive !== false) bump(b.locationId);
  for (const k of kits.rows) if (k.isActive !== false) bump(k.locationId);
  return { stored, truncated: assets.truncated || bulk.truncated || kits.truncated };
}

const inList = (list: string[] | undefined, value: string | undefined): boolean => !list?.length || (value != null && list.includes(value));

function matchesLocationFilters(l: Doc<"locations">, f: { search?: string; typeIn?: string[]; tagsHasSome?: string[] }): boolean {
  const tagOk = !f.tagsHasSome?.length || (l.tags ?? []).some((t) => f.tagsHasSome!.includes(t));
  return inList(f.typeIn, l.type ?? "OFFSITE") && tagOk && (!f.search || matchesSearch([l.name, l.address], f.search));
}

interface SortCtx {
  stored: Map<string, number>;
}

const SORT_KEYS: Record<string, (l: Doc<"locations">, c: SortCtx) => unknown> = {
  assets: (l, c) => c.stored.get(l.id) ?? 0,
  capacity: (l) => l.capacity,
  lastMovement: (l) => l.lastMovementAt,
};

function sortKey(l: Doc<"locations">, sortBy: string, c: SortCtx): unknown {
  return (SORT_KEYS[sortBy] ?? ((x: Doc<"locations">) => (x as unknown as Record<string, unknown>)[sortBy]))(l, c);
}

/** One page row: the location plus its derived figures (fill, label state) and a dash-able last movement. */
function shapeLocationRow(l: Doc<"locations">, c: { stored: number; nameById: Map<string, string>; binCount: number }) {
  return {
    id: l.id,
    name: l.name,
    type: l.type ?? "OFFSITE",
    address: l.address ?? null,
    tags: l.tags ?? [],
    parentName: (l.parentId && c.nameById.get(l.parentId)) || null,
    stored: c.stored,
    binCount: c.binCount,
    capacity: l.capacity ?? null,
    fill: locationFill(c.stored, l.capacity),
    lastMovement: l.lastMovementAt ?? null,
    labelState: binLabelState(l.labelPrintedAt),
    labelPrintedAt: l.labelPrintedAt ?? null,
  };
}

const sortDir = v.optional(v.union(v.literal("asc"), v.literal("desc")));

/** One page of the Locations list. */
export const listPage = query({
  args: {
    orgId: v.string(),
    search: v.optional(v.string()),
    typeIn: v.optional(v.array(v.string())),
    tagsHasSome: v.optional(v.array(v.string())),
    segment: v.optional(v.string()),
    page: v.optional(v.number()),
    pageSize: v.optional(v.number()),
    sortBy: v.optional(v.string()),
    sortOrder: sortDir,
  },
  handler: async (ctx, a) => {
    await requireOrgReadFor(ctx, a.orgId, "location");
    const seg = parseLocationSegment(a.segment);
    const dir: 1 | -1 = a.sortOrder === "desc" ? -1 : 1;
    const [locs, { stored, truncated: storedTruncated }] = await Promise.all([
      collectCapped(ctx.db.query("locations").withIndex("by_organizationId", (q) => q.eq("organizationId", a.orgId))),
      loadStoredCounts(ctx, a.orgId),
    ]);
    const subtree = subtreeTotals(locs.rows, stored);
    const nameById = new Map(locs.rows.map((l) => [l.id, l.name]));
    const childCount = new Map<string, number>();
    for (const l of locs.rows) if (l.parentId) childCount.set(l.parentId, (childCount.get(l.parentId) ?? 0) + 1);

    const filtered = locs.rows.filter((l) => locationInSegment(l, seg, subtree.get(l.id) ?? 0) && matchesLocationFilters(l, a));
    const sortBy = a.sortBy ?? "name";
    const sorted = [...filtered].sort((x, y) => compareValues(sortKey(x, sortBy, { stored }), sortKey(y, sortBy, { stored }), dir) || x.name.localeCompare(y.name));
    const paged = paginateItems(sorted, a.page ?? 1, clampPageSize(a.pageSize ?? 25));

    const items = paged.items.map((l) => shapeLocationRow(l, { stored: stored.get(l.id) ?? 0, nameById, binCount: childCount.get(l.id) ?? 0 }));
    return { ...paged, items, truncated: locs.truncated || storedTruncated };
  },
});

/** Strip counts for the Locations list. */
export const segmentCounts = query({
  args: { orgId: v.string() },
  handler: async (ctx, { orgId }) => {
    await requireOrgReadFor(ctx, orgId, "location");
    const [locs, { stored }] = await Promise.all([
      collectCapped(ctx.db.query("locations").withIndex("by_organizationId", (q) => q.eq("organizationId", orgId))),
      loadStoredCounts(ctx, orgId),
    ]);
    const subtree = subtreeTotals(locs.rows, stored);
    const counts: Record<LocationSegmentKey, number> = { all: 0, warehouses: 0, vehicles: 0, sites: 0, empty: 0 };
    for (const l of locs.rows) for (const key of LOCATION_SEGMENT_KEYS) if (locationInSegment(l, key, subtree.get(l.id) ?? 0)) counts[key]++;
    return counts;
  },
});

export const agentOps: AgentOpsAnnotations = {
  listPage: { summary: "One page of the Locations list with stored count, capacity and fill, bin-label state and last movement." },
  segmentCounts: { summary: "Strip counts for the Locations list (all, warehouses, vehicles, sites, empty)." },
};
