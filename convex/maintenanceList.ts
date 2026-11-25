import { v } from "convex/values";
import { query } from "./_generated/server";
import type { QueryCtx } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
import { requireOrgReadFor } from "./lib/auth";
import type { AgentOpsAnnotations } from "./lib/agentOps";
import { canSeeJobCost } from "./lib/crewPayVisibility";
import { matchesSearch, compareValues, paginateItems } from "./lib/listQuery";
import { isLinkRow } from "./lib/maintenanceRecordAssetKind";
import { isOpenMaintenance, isOverdueMaintenance } from "./lib/maintenanceOpen";
import { clampPageSize, collectCapped } from "./lib/pagination";
import { resolveNow } from "./lib/projectSegments";
import { ReadBudget, unlimitedBudget } from "./lib/readBudget";

/**
 * UX Phase 14 (14a-3) list reads for Maintenance. The strip is `Open · Overdue · Scheduled · Done · All`; Open
 * and Overdue are THE definitions in convex/lib/maintenanceOpen.ts (the same ones Home and the More sheet
 * count by). `cost` is a job-cost field: it is ABSENT from the payload (never zeroed) for a caller who fails
 * `canSeeJobCost` (`invoice:read` and not a `noFinancials` key), and ordering by it falls back to the default
 * order. Reads are `by_organizationId` + `collectCapped`; asset-tag search draws from one read budget.
 */

const SEGMENT_KEYS = ["open", "overdue", "scheduled", "done", "all"] as const;
type SegmentKey = (typeof SEGMENT_KEYS)[number];
const parseSegment = (raw: string | undefined): SegmentKey => SEGMENT_KEYS.find((k) => k === raw) ?? "open";

/** Documents ONE call may read to search by linked asset tag / model name (a TOTAL budget over the call). */
const SEARCH_JOIN_BUDGET = 3000;

/** Pure: does a record belong in the strip word at `now`? */
function inSegment(r: Doc<"maintenanceRecords">, seg: SegmentKey, now: number): boolean {
  const status = r.status ?? "SCHEDULED";
  if (seg === "all") return true;
  if (seg === "open") return isOpenMaintenance(status);
  if (seg === "overdue") return isOverdueMaintenance({ status, scheduledDate: r.scheduledDate }, now);
  return seg === "scheduled" ? status === "SCHEDULED" : status === "COMPLETED";
}

const inList = (list: string[] | undefined, value: string | undefined): boolean => !list?.length || (value != null && list.includes(value));

interface FilterArgs {
  typeIn?: string[];
  statusIn?: string[];
  resultIn?: string[];
}

function matchesFilters(r: Doc<"maintenanceRecords">, f: FilterArgs): boolean {
  return inList(f.typeIn, r.type) && inList(f.statusIn, r.status ?? "SCHEDULED") && inList(f.resultIn, r.result ?? undefined);
}

const STATUS_RANK: Record<string, number> = { SCHEDULED: 0, AWAITING_PARTS: 1, IN_PROGRESS: 2, QA: 3, COMPLETED: 4, CANCELLED: 5 };

/** The ONLY orderings the list offers: an explicit allow-list, no generic field fallback. */
const SORT_KEYS: Record<string, (r: Doc<"maintenanceRecords">) => unknown> = {
  title: (r) => r.title,
  type: (r) => r.type,
  status: (r) => STATUS_RANK[r.status ?? "SCHEDULED"],
  scheduledDate: (r) => r.scheduledDate,
  completedDate: (r) => r.completedDate,
  cost: (r) => r.cost,
};
const COST_SORT_KEYS: readonly string[] = ["cost"];

/**
 * Pure: the sort actually applied. An unknown key, or a cost key for a caller who cannot see cost, falls back
 * to the default order ASCENDING whatever direction was asked (asc and desc must be identical).
 */
function effectiveSort(sortBy: string | undefined, dir: 1 | -1, seesCost: boolean): { sortBy: string; dir: 1 | -1 } {
  const s = sortBy ?? "scheduledDate";
  if (!(s in SORT_KEYS) || (!seesCost && COST_SORT_KEYS.includes(s))) return { sortBy: "scheduledDate", dir: 1 };
  return { sortBy: s, dir };
}

const sortDir = v.optional(v.union(v.literal("asc"), v.literal("desc")));

/** One page of the Maintenance list: filter, derived segment, sort and paginate on the server. */
export const listPage = query({
  args: {
    orgId: v.string(),
    search: v.optional(v.string()),
    typeIn: v.optional(v.array(v.string())),
    statusIn: v.optional(v.array(v.string())),
    resultIn: v.optional(v.array(v.string())),
    segment: v.optional(v.string()),
    now: v.optional(v.number()),
    page: v.optional(v.number()),
    pageSize: v.optional(v.number()),
    sortBy: v.optional(v.string()),
    sortOrder: sortDir,
  },
  handler: async (ctx, a) => {
    await requireOrgReadFor(ctx, a.orgId, "maintenance");
    const seg = parseSegment(a.segment);
    const now = resolveNow(a.now);
    const seesCost = await canSeeJobCost(ctx, a.orgId);
    const { sortBy, dir } = effectiveSort(a.sortBy, a.sortOrder === "desc" ? -1 : 1, seesCost);
    const records = await collectCapped(ctx.db.query("maintenanceRecords").withIndex("by_organizationId", (q) => q.eq("organizationId", a.orgId)));
    const budget = new ReadBudget(SEARCH_JOIN_BUDGET);
    const scoped: Doc<"maintenanceRecords">[] = [];
    for (const r of records.rows) {
      if (!inSegment(r, seg, now) || !matchesFilters(r, a)) continue;
      if (!a.search || (await matchesSearchTerm(ctx, a.orgId, r, a.search, budget))) scoped.push(r);
    }
    const key = SORT_KEYS[sortBy];
    const sorted = [...scoped].sort((x, y) => compareValues(key(x), key(y), dir) || x.title.localeCompare(y.title));
    const paged = paginateItems(sorted, a.page ?? 1, clampPageSize(a.pageSize ?? 25));
    const names = new Map<string, string | null>();
    const items = [];
    for (const r of paged.items) items.push(await shapeRow(ctx, a.orgId, r, now, seesCost, names));
    return { ...paged, items, truncated: records.truncated || budget.truncated };
  },
});

/** Title, description and tags always; the linked asset tags and model names while the read budget lasts. */
async function matchesSearchTerm(ctx: QueryCtx, orgId: string, r: Doc<"maintenanceRecords">, search: string, budget: ReadBudget): Promise<boolean> {
  if (matchesSearch([r.title, r.description, ...(r.tags ?? [])], search)) return true;
  if (!budget.hasRoom) {
    budget.truncated = true;
    return false;
  }
  const links = await linkedAssets(ctx, orgId, r.id, 5, budget);
  return links.some((l) => matchesSearch([l.assetTag, l.model], search));
}

interface LinkedAsset {
  id: string;
  assetTag: string;
  model: string;
}

/** The record's linked assets (LINK rows only, asset org re-checked), up to `limit`, charged to the budget. */
async function linkedAssets(ctx: QueryCtx, orgId: string, recordId: string, limit: number, budget: ReadBudget): Promise<LinkedAsset[]> {
  const rows = await ctx.db.query("maintenanceRecordAssets").withIndex("by_maintenanceRecordId", (q) => q.eq("maintenanceRecordId", recordId)).take(50);
  budget.take(rows.length);
  const out: LinkedAsset[] = [];
  for (const l of rows.filter(isLinkRow).slice(0, limit)) {
    if (budget.take(2) < 2) break;
    const asset = await ctx.db.query("assets").withIndex("by_cuid", (q) => q.eq("id", l.assetId!)).first();
    if (!asset || asset.organizationId !== orgId) continue;
    const model = await ctx.db.query("models").withIndex("by_cuid", (q) => q.eq("id", asset.modelId)).first();
    out.push({ id: asset.id, assetTag: asset.assetTag, model: model && model.organizationId === orgId ? model.name : "" });
  }
  return out;
}

async function userName(ctx: QueryCtx, id: string | undefined, cache: Map<string, string | null>): Promise<string | null> {
  if (!id) return null;
  if (!cache.has(id)) cache.set(id, (await ctx.db.query("users").withIndex("by_cuid", (q) => q.eq("id", id)).first())?.name ?? null);
  return cache.get(id) ?? null;
}

/** One page row. `cost` is present ONLY for a caller who sees job cost. */
async function shapeRow(ctx: QueryCtx, orgId: string, r: Doc<"maintenanceRecords">, now: number, seesCost: boolean, names: Map<string, string | null>) {
  const status = r.status ?? "SCHEDULED";
  return {
    id: r.id,
    title: r.title,
    type: r.type,
    status,
    result: r.result ?? null,
    overdue: isOverdueMaintenance({ status, scheduledDate: r.scheduledDate }, now),
    scheduledDate: r.scheduledDate ?? null,
    completedDate: r.completedDate ?? null,
    tags: r.tags ?? [],
    reportedBy: await userName(ctx, r.reportedById, names),
    assignedTo: await userName(ctx, r.assignedToId, names),
    assets: await linkedAssets(ctx, orgId, r.id, 3, unlimitedBudget()),
    ...(seesCost ? { cost: r.cost ?? null } : {}),
  };
}

/** Strip counts for the Maintenance list (the same Open / Overdue the pages count by). */
export const segmentCounts = query({
  args: { orgId: v.string(), now: v.optional(v.number()) },
  handler: async (ctx, a) => {
    await requireOrgReadFor(ctx, a.orgId, "maintenance");
    const now = resolveNow(a.now);
    const records = await collectCapped(ctx.db.query("maintenanceRecords").withIndex("by_organizationId", (q) => q.eq("organizationId", a.orgId)));
    const counts = Object.fromEntries(SEGMENT_KEYS.map((k) => [k, 0])) as Record<SegmentKey, number>;
    for (const r of records.rows) for (const k of SEGMENT_KEYS) if (inSegment(r, k, now)) counts[k]++;
    return { ...counts, truncated: records.truncated };
  },
});

export const agentOps: AgentOpsAnnotations = {
  listPage: { summary: "One page of the Maintenance list with derived Open / Overdue / Scheduled / Done segments, linked assets and assignee. Cost only for callers who can see job cost." },
  segmentCounts: { summary: "Strip counts for the Maintenance list (open, overdue, scheduled, done, all)." },
};
