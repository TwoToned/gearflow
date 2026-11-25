import { v } from "convex/values";
import { query } from "./_generated/server";
import type { QueryCtx } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
import { requireOrgReadFor, getAuthContext, isAgentNoFinancials, redactFields } from "./lib/auth";
import type { AgentOpsAnnotations } from "./lib/agentOps";
import { matchesSearch, compareValues, paginateItems } from "./lib/listQuery";
import { clampPageSize, collectCapped } from "./lib/pagination";
import { resolveNow } from "./lib/projectSegments";
import { loadKitBookingGate, loadKitStates, type KitState } from "./lib/kitState";
import { ReadBudget } from "./lib/readBudget";

/**
 * UX Phase 14 (14a-2) list reads for Kits. A kit's state is DERIVED (convex/lib/kitState.ts, D75);
 * the strip words are `All · Complete · Missing items · On a job`. Reads are `by_organizationId` +
 * `collectCapped` (no unbounded full-table read); the derived segments cap the kits examined and
 * say so with `truncated`.
 */

/** What the org paid: redacted for a `noFinancials` key, like every other cost field. */
const KIT_COST_FIELDS = ["purchasePrice"] as const;

/**
 * Documents ONE call may read for kit members, reserving lines and member counts (a TOTAL budget, not a
 * per-kit cap). A kit the budget cannot cover gets `state: null` and the response says `truncated`.
 */
const KIT_READ_BUDGET = 4000;

const KIT_SEGMENT_KEYS = ["all", "complete", "missing", "onjob", "maintenance", "retired"] as const;
type KitSegmentKey = (typeof KIT_SEGMENT_KEYS)[number];
const parseKitSegment = (raw: string | undefined): KitSegmentKey => KIT_SEGMENT_KEYS.find((k) => k === raw) ?? "all";

/** Retired kits are listed only under their own word; every other word is the live kits. */
const isRetiredKit = (k: Doc<"kits">): boolean => k.isActive === false || k.status === "RETIRED";
const inRetiredScope = (k: Doc<"kits">, seg: KitSegmentKey): boolean => (seg === "retired" ? isRetiredKit(k) : !isRetiredKit(k));

/** Pure: does a kit with this derived state belong in the strip word? (`retired` is decided by scope, not state.) */
function kitInSegment(state: KitState, seg: KitSegmentKey): boolean {
  if (seg === "all" || seg === "retired") return true;
  if (seg === "missing") return state.key === "INCOMPLETE";
  if (seg === "onjob") return state.key === "RESERVED" || state.key === "CHECKED_OUT";
  if (seg === "maintenance") return state.key === "IN_MAINTENANCE";
  return state.key !== "INCOMPLETE"; // complete
}

const inList = (list: string[] | undefined, value: string | undefined): boolean => !list?.length || (value != null && list.includes(value));

interface KitFilterArgs {
  search?: string;
  categoryIdIn?: string[];
  locationIdIn?: string[];
  tagsHasSome?: string[];
}

function matchesKitFilters(k: Doc<"kits">, f: KitFilterArgs): boolean {
  const tagOk = !f.tagsHasSome?.length || (k.tags ?? []).some((t) => f.tagsHasSome!.includes(t));
  const searchOk = !f.search || matchesSearch([k.assetTag, k.name, k.description], f.search);
  return inList(f.categoryIdIn, k.categoryId) && inList(f.locationIdIn, k.locationId) && tagOk && searchOk;
}

interface KitSortCtx {
  categoryById: Map<string, Doc<"categories">>;
  locationById: Map<string, Doc<"locations">>;
  states: Map<string, KitState | null> | null;
}

/**
 * The ONLY orderings the list offers: an explicit allow-list, no generic field fallback (a fallback
 * would let a caller order rows by any stored field, a cost among them, and read it back from the order).
 */
const KIT_SORT_KEYS: Record<string, (k: Doc<"kits">, c: KitSortCtx) => unknown> = {
  assetTag: (k) => k.assetTag,
  name: (k) => k.name,
  condition: (k) => k.condition,
  purchasePrice: (k) => k.purchasePrice,
  category: (k, c) => c.categoryById.get(k.categoryId ?? "")?.name,
  location: (k, c) => c.locationById.get(k.locationId ?? "")?.name,
  state: (k, c) => c.states?.get(k.id)?.key,
};

/** Sort keys that order by a cost field: a caller who cannot see the field gets the default order instead. */
const KIT_COST_SORT_KEYS: readonly string[] = KIT_COST_FIELDS;

/**
 * Pure: the sort actually applied. An unknown key, or a cost key for a caller who cannot see cost, falls
 * back to the default order in ASCENDING order whatever direction was asked (asc and desc must be
 * identical, or the direction itself would leak the ordering).
 */
function effectiveKitSort(sortBy: string | undefined, dir: 1 | -1, redacted: boolean): { sortBy: string; dir: 1 | -1 } {
  const s = sortBy ?? "assetTag";
  if (!Object.hasOwn(KIT_SORT_KEYS, s) || (redacted && KIT_COST_SORT_KEYS.includes(s))) return { sortBy: "assetTag", dir: 1 };
  return { sortBy: s, dir };
}

function kitSortKey(k: Doc<"kits">, sortBy: string, c: KitSortCtx): unknown {
  return KIT_SORT_KEYS[sortBy](k, c);
}

const sortDir = v.optional(v.union(v.literal("asc"), v.literal("desc")));

/** One page of the Kits list: filter, derived segment, sort and paginate on the server. */
export const listPage = query({
  args: {
    orgId: v.string(),
    search: v.optional(v.string()),
    categoryIdIn: v.optional(v.array(v.string())),
    locationIdIn: v.optional(v.array(v.string())),
    tagsHasSome: v.optional(v.array(v.string())),
    segment: v.optional(v.string()),
    /** The clock the reservation read uses (clamped to the server's). */
    now: v.optional(v.number()),
    page: v.optional(v.number()),
    pageSize: v.optional(v.number()),
    sortBy: v.optional(v.string()),
    sortOrder: sortDir,
  },
  handler: async (ctx, a) => {
    await requireOrgReadFor(ctx, a.orgId, "kit");
    const seg = parseKitSegment(a.segment);
    const now = resolveNow(a.now);
    const redacted = await isAgentNoFinancials(ctx, await getAuthContext(ctx));
    const { sortBy, dir } = effectiveKitSort(a.sortBy, a.sortOrder === "desc" ? -1 : 1, redacted);
    const [kits, categories, locations] = await Promise.all([
      collectCapped(ctx.db.query("kits").withIndex("by_organizationId", (q) => q.eq("organizationId", a.orgId))),
      collectCapped(ctx.db.query("categories").withIndex("by_organizationId", (q) => q.eq("organizationId", a.orgId))),
      collectCapped(ctx.db.query("locations").withIndex("by_organizationId", (q) => q.eq("organizationId", a.orgId))),
    ]);
    const live = kits.rows.filter((k) => inRetiredScope(k, seg) && k.isPrep !== true && matchesKitFilters(k, a));
    // A derived segment or a state sort needs every candidate's state; otherwise only the page's.
    const needsAll = seg !== "all" || sortBy === "state";
    const budget = new ReadBudget(KIT_READ_BUDGET);
    const { candidates, allStates } = await selectCandidates(ctx, a.orgId, live, needsAll ? seg : null, now, budget);

    const sortCtx: KitSortCtx = {
      categoryById: new Map(categories.rows.map((c) => [c.id, c])),
      locationById: new Map(locations.rows.map((l) => [l.id, l])),
      states: allStates,
    };
    const sorted = [...candidates].sort((x, y) => compareValues(kitSortKey(x, sortBy, sortCtx), kitSortKey(y, sortBy, sortCtx), dir) || x.assetTag.localeCompare(y.assetTag));
    const paged = paginateItems(sorted, a.page ?? 1, clampPageSize(a.pageSize ?? 25));
    const items = await shapeKitPage(ctx, a.orgId, paged.items, sortCtx, now, redacted, budget);
    return { ...paged, items, truncated: kits.truncated || budget.truncated };
  },
});

/** The page's rows: cost-redacted kit, derived state, member count and primary photo. */
async function shapeKitPage(ctx: QueryCtx, orgId: string, page: Doc<"kits">[], c: KitSortCtx, now: number, redact: boolean, budget: ReadBudget) {
  const pageStates = c.states ?? (await loadKitStates(ctx, orgId, page, now, budget));
  const members = await memberCounts(ctx, orgId, page, budget);
  const items = [];
  for (const k of page) {
    items.push({
      ...(redact ? redactFields(k, KIT_COST_FIELDS) : k),
      ...kitRowFacts(k, c, pageStates.get(k.id) ?? null, members.get(k.id) ?? null),
      media: await primaryKitPhoto(ctx, orgId, k.id),
    });
  }
  return items;
}

/**
 * The kits the list can show. With a derived word (`seg` not null) every candidate's state is needed
 * (drawn from the call's budget), so the segment filters on it and the states are kept for the page. A
 * kit whose state the budget could not cover is left out of a derived word (and `truncated` says so).
 */
async function selectCandidates(ctx: QueryCtx, orgId: string, live: Doc<"kits">[], seg: KitSegmentKey | null, now: number, budget: ReadBudget) {
  if (seg === null) return { candidates: live, allStates: null };
  const allStates = await loadKitStates(ctx, orgId, live, now, budget);
  return { candidates: live.filter((k) => { const s = allStates.get(k.id); return s != null && kitInSegment(s, seg); }), allStates };
}

/** The derived parts of one page row: category, location, item count and state (`null` = the budget ran out). */
function kitRowFacts(k: Doc<"kits">, c: KitSortCtx, state: KitState | null, itemCount: number | null) {
  const cat = k.categoryId ? c.categoryById.get(k.categoryId) : undefined;
  const loc = k.locationId ? c.locationById.get(k.locationId) : undefined;
  return {
    category: cat ? { id: cat.id, name: cat.name } : null,
    location: loc ? { id: loc.id, name: loc.name } : null,
    itemCount,
    state: state ? { key: state.key, missing: state.missing, booking: state.booking, reportedMissing: state.reportedMissing } : null,
  };
}

/** The kit's primary PHOTO, file resolved org-scoped. */
async function primaryKitPhoto(ctx: QueryCtx, orgId: string, kitId: string) {
  const rows = await ctx.db.query("kitMedia").withIndex("by_kitId", (q) => q.eq("kitId", kitId)).take(20);
  const m = rows.find((r) => r.organizationId === orgId && r.type === "PHOTO" && r.isPrimary);
  if (!m) return null;
  const file = await ctx.db.query("fileUploads").withIndex("by_cuid", (q) => q.eq("id", m.fileId)).unique();
  return file && file.organizationId === orgId ? { url: file.url ?? null, thumbnailUrl: file.thumbnailUrl ?? null } : null;
}

/** Items per kit: serialised members plus bulk quantity (the "Items" column). */
async function memberCounts(ctx: QueryCtx, orgId: string, kits: readonly Doc<"kits">[], budget: ReadBudget): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  for (const k of kits) {
    if (!budget.hasRoom) {
      budget.truncated = true; // the rest stay absent: the row shows no count
      break;
    }
    const room = Math.min(500, budget.left);
    const [ser, blk] = await Promise.all([
      collectCapped(ctx.db.query("kitSerializedItems").withIndex("by_kitId", (q) => q.eq("kitId", k.id)), room),
      collectCapped(ctx.db.query("kitBulkItems").withIndex("by_kitId", (q) => q.eq("kitId", k.id)), room),
    ]);
    budget.take(ser.rows.length + blk.rows.length);
    if ((ser.truncated || blk.truncated) && room < 500) {
      budget.truncated = true;
      continue;
    }
    out.set(k.id, ser.rows.filter((r) => r.organizationId === orgId).length + blk.rows.filter((r) => r.organizationId === orgId).reduce((n, r) => n + r.quantity, 0));
  }
  return out;
}

/** Strip counts for the Kits list. */
export const segmentCounts = query({
  args: { orgId: v.string(), now: v.optional(v.number()) },
  handler: async (ctx, { orgId, now }) => {
    await requireOrgReadFor(ctx, orgId, "kit");
    const kits = await collectCapped(ctx.db.query("kits").withIndex("by_organizationId", (q) => q.eq("organizationId", orgId)));
    const real = kits.rows.filter((k) => k.isPrep !== true);
    const live = real.filter((k) => !isRetiredKit(k));
    const budget = new ReadBudget(KIT_READ_BUDGET);
    const states = await loadKitStates(ctx, orgId, live, resolveNow(now), budget);
    const counts: Record<KitSegmentKey, number> = { all: live.length, complete: 0, missing: 0, onjob: 0, maintenance: 0, retired: real.length - live.length };
    for (const k of live) {
      const s = states.get(k.id);
      if (s) for (const key of KIT_SEGMENT_KEYS) if (key !== "all" && key !== "retired" && kitInSegment(s, key)) counts[key]++;
    }
    return { ...counts, truncated: kits.truncated || budget.truncated };
  },
});

/**
 * One kit's derived booking state for the server actions that gate adding a kit to a job
 * (`src/server/line-items.ts`). Same helper the Convex gates use.
 */
export const bookingGate = query({
  args: { orgId: v.string(), id: v.string() },
  handler: async (ctx, { orgId, id }) => {
    await requireOrgReadFor(ctx, orgId, "kit");
    const kit = await ctx.db.query("kits").withIndex("by_cuid", (q) => q.eq("id", id)).first();
    if (!kit || kit.organizationId !== orgId) return null;
    const s = await loadKitBookingGate(ctx, orgId, kit);
    return { key: s.key, blocksBooking: s.blocksBooking, missing: s.missing };
  },
});

export const agentOps: AgentOpsAnnotations = {
  listPage: { summary: "One page of the Kits list with derived state (Incomplete / Reserved / Available), item count and filters." },
  segmentCounts: { summary: "Strip counts for the Kits list (all, complete, missing items, on a job, in maintenance, retired) and whether the read budget cut them short." },
  bookingGate: { summary: "A kit's derived booking state: whether it can be added to a job, and what is missing." },};
