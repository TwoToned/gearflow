import { v, ConvexError } from "convex/values";
import { query } from "./_generated/server";
import type { QueryCtx } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
import { requireOrgReadFor } from "./lib/auth";
import type { AgentOpsAnnotations } from "./lib/agentOps";
import { matchesSearch, compareValues, paginateItems } from "./lib/listQuery";
import { clampPageSize, collectCapped } from "./lib/pagination";
import { resolveNow } from "./lib/projectSegments";
import {
  TEST_TAG_SEGMENT_KEYS,
  clampDueSoonDays,
  deriveTestTagState,
  parseTestTagSegment,
  testTagInSegment,
  type TestTagListState,
  type TestTagSegmentKey,
} from "./lib/testTagListState";

/**
 * UX Phase 14 (14a-3) list reads for Test and tag. `/test-and-tag` IS the list now. Due / Overdue / Passed /
 * Failed are DERIVED from the dates (convex/lib/testTagListState.ts), never from the stored DUE_SOON /
 * OVERDUE word the cron writes. Reads are `by_organizationId` + `collectCapped`, and say `truncated`.
 */

const sortDir = v.optional(v.union(v.literal("asc"), v.literal("desc")));

const inList = (list: string[] | undefined, value: string | undefined): boolean => !list?.length || (value != null && list.includes(value));

interface TtFilterArgs {
  search?: string;
  classIn?: string[];
  typeIn?: string[];
  profileIn?: string[];
  linkIn?: string[];
}

/** The link word of an item: serialised asset, bulk line or standalone. */
function linkOf(i: Doc<"testTagAssets">): "serialized" | "bulk" | "standalone" {
  if (i.assetId != null) return "serialized";
  return i.bulkAssetId != null ? "bulk" : "standalone";
}

function matchesFilters(i: Doc<"testTagAssets">, f: TtFilterArgs): boolean {
  const searchOk = !f.search || matchesSearch([i.testTagId, i.description, i.serialNumber, i.make, i.modelName], f.search);
  return inList(f.classIn, i.equipmentClass) && inList(f.typeIn, i.applianceType) && inList(f.profileIn, i.testProfileId) && inList(f.linkIn, linkOf(i)) && searchOk;
}

const STATE_RANK: Record<TestTagListState, number> = { OVERDUE: 0, FAILED: 1, DUE: 2, PASSED: 3, RETIRED: 4 };

/** The ONLY orderings the list offers: an explicit allow-list, no generic field fallback. */
const SORT_KEYS: Record<string, (i: Doc<"testTagAssets">, state: TestTagListState) => unknown> = {
  testTagId: (i) => i.testTagId,
  description: (i) => i.description,
  lastTest: (i) => i.lastTestDate,
  nextDue: (i) => i.nextDueDate,
  state: (_i, s) => STATE_RANK[s],
  equipmentClass: (i) => i.equipmentClass,
  applianceType: (i) => i.applianceType,
};

/** One page of the Test and tag list: filter, derived segment, sort and paginate on the server. */
export const listPage = query({
  args: {
    orgId: v.string(),
    search: v.optional(v.string()),
    classIn: v.optional(v.array(v.string())),
    typeIn: v.optional(v.array(v.string())),
    profileIn: v.optional(v.array(v.string())),
    linkIn: v.optional(v.array(v.string())),
    segment: v.optional(v.string()),
    /** The org's due-soon horizon in days (clamped 1..90; default 14). */
    dueSoonDays: v.optional(v.number()),
    now: v.optional(v.number()),
    page: v.optional(v.number()),
    pageSize: v.optional(v.number()),
    sortBy: v.optional(v.string()),
    sortOrder: sortDir,
  },
  handler: async (ctx, a) => {
    await requireOrgReadFor(ctx, a.orgId, "testTag");
    const seg = parseTestTagSegment(a.segment);
    const now = resolveNow(a.now);
    const days = clampDueSoonDays(a.dueSoonDays);
    const sortBy = a.sortBy && Object.hasOwn(SORT_KEYS, a.sortBy) ? a.sortBy : "nextDue";
    const dir: 1 | -1 = a.sortOrder === "desc" ? -1 : 1;
    const [items, profiles] = await Promise.all([
      collectCapped(ctx.db.query("testTagAssets").withIndex("by_organizationId", (q) => q.eq("organizationId", a.orgId))),
      collectCapped(ctx.db.query("testProfiles").withIndex("by_organizationId", (q) => q.eq("organizationId", a.orgId)), 500),
    ]);
    const stateOf = new Map(items.rows.map((i) => [i.id, deriveTestTagState(i, now, days)]));
    const scoped = items.rows.filter((i) => testTagInSegment(stateOf.get(i.id)!, seg) && matchesFilters(i, a));
    const key = SORT_KEYS[sortBy];
    const sorted = [...scoped].sort((x, y) => compareValues(key(x, stateOf.get(x.id)!), key(y, stateOf.get(y.id)!), dir) || x.testTagId.localeCompare(y.testTagId));
    const paged = paginateItems(sorted, a.page ?? 1, clampPageSize(a.pageSize ?? 25));
    const profileById = new Map(profiles.rows.map((p) => [p.id, p.name]));
    const rows = [];
    for (const i of paged.items) rows.push(await shapeRow(ctx, a.orgId, i, stateOf.get(i.id)!, profileById));
    return { ...paged, items: rows, truncated: items.truncated || profiles.truncated };
  },
});

/** One row: the item, its derived state, its newest test (tester and result) and its linked asset's tag. */
async function shapeRow(ctx: QueryCtx, orgId: string, i: Doc<"testTagAssets">, state: TestTagListState, profileById: Map<string, string>) {
  const last = await ctx.db
    .query("testTagRecords")
    .withIndex("by_organizationId_testTagAssetId", (q) => q.eq("organizationId", orgId).eq("testTagAssetId", i.id))
    .order("desc")
    .first();
  const asset = await linkedAssetOf(ctx, orgId, i);
  return {
    id: i.id,
    testTagId: i.testTagId,
    description: i.description,
    equipmentClass: i.equipmentClass ?? null,
    applianceType: i.applianceType ?? null,
    profile: i.testProfileId ? (profileById.get(i.testProfileId) ?? null) : null,
    state,
    lastTestDate: i.lastTestDate ?? null,
    nextDueDate: i.nextDueDate ?? null,
    tester: last?.testerName ?? null,
    linkedAsset: asset,
    link: linkOf(i),
  };
}

/** The item's serialised asset (`by_cuid` is global: the org is re-checked), as the list prints it. */
async function linkedAssetOf(ctx: QueryCtx, orgId: string, i: Doc<"testTagAssets">): Promise<{ id: string; assetTag: string } | null> {
  if (!i.assetId) return null;
  const asset = await ctx.db.query("assets").withIndex("by_cuid", (q) => q.eq("id", i.assetId!)).first();
  return asset && asset.organizationId === orgId ? { id: asset.id, assetTag: asset.assetTag } : null;
}

/** Strip counts for the Test and tag list. */
export const segmentCounts = query({
  args: { orgId: v.string(), dueSoonDays: v.optional(v.number()), now: v.optional(v.number()) },
  handler: async (ctx, a) => {
    await requireOrgReadFor(ctx, a.orgId, "testTag");
    const now = resolveNow(a.now);
    const days = clampDueSoonDays(a.dueSoonDays);
    const items = await collectCapped(ctx.db.query("testTagAssets").withIndex("by_organizationId", (q) => q.eq("organizationId", a.orgId)));
    const counts = Object.fromEntries(TEST_TAG_SEGMENT_KEYS.map((k) => [k, 0])) as Record<TestTagSegmentKey, number>;
    for (const i of items.rows) {
      const s = deriveTestTagState(i, now, days);
      for (const k of TEST_TAG_SEGMENT_KEYS) if (testTagInSegment(s, k)) counts[k]++;
    }
    return { ...counts, truncated: items.truncated };
  },
});

/** The most items one `Print tags` run covers (a sheet of labels, not a bulk job). */
const MAX_LABELS = 100;
/** The most test records read per item to find its latest. */
const MAX_RECORDS_PER_ITEM = 500;

/**
 * The data of the printed tag for each item (UX Phase 14, 14a-3b, `Print tags`): the LATEST test's result, date and tester
 * and the item's next due date, i.e. exactly what the single `Print label` prints. An item that has never been tested has
 * no label (it is named in `skipped`, never printed blank); an id that is not this org's item is ignored. Bounded: at most
 * 100 ids, and each item's own records are read capped.
 */
export const labelsFor = query({
  args: { orgId: v.string(), ids: v.array(v.string()) },
  handler: async (ctx, { orgId, ids }) => {
    await requireOrgReadFor(ctx, orgId, "testTag");
    if (ids.length > MAX_LABELS) throw new ConvexError({ code: "TOO_MANY", message: `Print at most ${MAX_LABELS} tags at a time.` });
    const labels: { id: string; testTagId: string; result: "PASS" | "FAIL"; testDate: number; nextDueDate: number; testerName: string }[] = [];
    const skipped: { id: string; testTagId: string }[] = [];
    for (const id of [...new Set(ids)]) {
      const item = await ctx.db.query("testTagAssets").withIndex("by_cuid", (q) => q.eq("id", id)).first();
      if (!item || item.organizationId !== orgId) continue; // by_cuid is global: another org's item is simply not there
      const { rows } = await collectCapped(ctx.db.query("testTagRecords").withIndex("by_organizationId_testTagAssetId", (q) => q.eq("organizationId", orgId).eq("testTagAssetId", id)), MAX_RECORDS_PER_ITEM);
      const last = rows.reduce<Doc<"testTagRecords"> | null>((best, r) => (!best || r.testDate > best.testDate ? r : best), null);
      if (!last) { skipped.push({ id, testTagId: item.testTagId }); continue; }
      labels.push({ id, testTagId: item.testTagId, result: last.result === "PASS" ? "PASS" : "FAIL", testDate: last.testDate, nextDueDate: item.nextDueDate ?? last.testDate, testerName: last.testerName || "\u2014" });
    }
    return { labels, skipped };
  },
});

export const agentOps: AgentOpsAnnotations = {
  listPage: { summary: "One page of the Test and tag list with derived Due / Overdue / Passed / Failed state, last test and tester." },
  segmentCounts: { summary: "Strip counts for the Test and tag list (due, overdue, passed, failed, all, retired)." },
  labelsFor: { summary: "The printed tag data (latest test result, date, tester, next due) for up to 100 test and tag items; never-tested items are listed as skipped." },
};
