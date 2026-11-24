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

/**
 * UX Phase 14 (14a-2) list reads for Kits. A kit's state is DERIVED (convex/lib/kitState.ts, D75);
 * the strip words are `All · Complete · Missing items · On a job`. Reads are `by_organizationId` +
 * `collectCapped` (no unbounded full-table read); the derived segments cap the kits examined and
 * say so with `truncated`.
 */

/** What the org paid: redacted for a `noFinancials` key, like every other cost field. */
const KIT_COST_FIELDS = ["purchasePrice"] as const;

/** Kits whose members are examined for a derived segment (members are read per kit). */
const KIT_DERIVE_CAP = 500;

const KIT_SEGMENT_KEYS = ["all", "complete", "missing", "onjob"] as const;
type KitSegmentKey = (typeof KIT_SEGMENT_KEYS)[number];
const parseKitSegment = (raw: string | undefined): KitSegmentKey => KIT_SEGMENT_KEYS.find((k) => k === raw) ?? "all";

/** Pure: does a kit with this derived state belong in the strip word? */
function kitInSegment(state: KitState, seg: KitSegmentKey): boolean {
  if (seg === "all") return true;
  if (seg === "missing") return state.key === "INCOMPLETE";
  if (seg === "onjob") return state.key === "RESERVED" || state.key === "CHECKED_OUT";
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
  states: Map<string, KitState> | null;
}

const KIT_SORT_KEYS: Record<string, (k: Doc<"kits">, c: KitSortCtx) => unknown> = {
  category: (k, c) => c.categoryById.get(k.categoryId ?? "")?.name,
  location: (k, c) => c.locationById.get(k.locationId ?? "")?.name,
  state: (k, c) => c.states?.get(k.id)?.key,
};

function kitSortKey(k: Doc<"kits">, sortBy: string, c: KitSortCtx): unknown {
  return (KIT_SORT_KEYS[sortBy] ?? ((x: Doc<"kits">) => (x as unknown as Record<string, unknown>)[sortBy]))(k, c);
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
    const sortBy = a.sortBy ?? "assetTag";
    const dir: 1 | -1 = a.sortOrder === "desc" ? -1 : 1;
    const [kits, categories, locations] = await Promise.all([
      collectCapped(ctx.db.query("kits").withIndex("by_organizationId", (q) => q.eq("organizationId", a.orgId))),
      collectCapped(ctx.db.query("categories").withIndex("by_organizationId", (q) => q.eq("organizationId", a.orgId))),
      collectCapped(ctx.db.query("locations").withIndex("by_organizationId", (q) => q.eq("organizationId", a.orgId))),
    ]);
    const live = kits.rows.filter((k) => k.isActive !== false && k.isPrep !== true && matchesKitFilters(k, a));
    // A derived segment or a state sort needs every candidate's state; otherwise only the page's.
    const needsAll = seg !== "all" || sortBy === "state";
    const { candidates, allStates } = await selectCandidates(ctx, a.orgId, live, needsAll ? seg : null, now);

    const sortCtx: KitSortCtx = {
      categoryById: new Map(categories.rows.map((c) => [c.id, c])),
      locationById: new Map(locations.rows.map((l) => [l.id, l])),
      states: allStates,
    };
    const sorted = [...candidates].sort((x, y) => compareValues(kitSortKey(x, sortBy, sortCtx), kitSortKey(y, sortBy, sortCtx), dir) || x.assetTag.localeCompare(y.assetTag));
    const paged = paginateItems(sorted, a.page ?? 1, clampPageSize(a.pageSize ?? 25));
    const pageStates = allStates ?? (await loadKitStates(ctx, a.orgId, paged.items, now));
    const redact = await isAgentNoFinancials(ctx, await getAuthContext(ctx));
    const members = await memberCounts(ctx, a.orgId, paged.items);

    const items = [];
    for (const k of paged.items) {
      items.push({
        ...(redact ? redactFields(k, KIT_COST_FIELDS) : k),
        ...kitRowFacts(k, sortCtx, pageStates.get(k.id)!, members.get(k.id) ?? 0),
        media: await primaryKitPhoto(ctx, a.orgId, k.id),
      });
    }
    return { ...paged, items, truncated: kits.truncated || (needsAll && live.length > KIT_DERIVE_CAP) };
  },
});

/**
 * The kits the list can show. With a derived word (`seg` not null) every candidate's state is needed
 * (capped at KIT_DERIVE_CAP kits), so the segment filters on it and the states are kept for the page.
 */
async function selectCandidates(ctx: QueryCtx, orgId: string, live: Doc<"kits">[], seg: KitSegmentKey | null, now: number) {
  if (seg === null) return { candidates: live, allStates: null };
  const examined = live.slice(0, KIT_DERIVE_CAP);
  const allStates = await loadKitStates(ctx, orgId, examined, now);
  return { candidates: examined.filter((k) => kitInSegment(allStates.get(k.id)!, seg)), allStates };
}

/** The derived parts of one page row: category, location, item count and state. */
function kitRowFacts(k: Doc<"kits">, c: KitSortCtx, state: KitState, itemCount: number) {
  const cat = k.categoryId ? c.categoryById.get(k.categoryId) : undefined;
  const loc = k.locationId ? c.locationById.get(k.locationId) : undefined;
  return {
    category: cat ? { id: cat.id, name: cat.name } : null,
    location: loc ? { id: loc.id, name: loc.name } : null,
    itemCount,
    state: { key: state.key, missing: state.missing, booking: state.booking },
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
async function memberCounts(ctx: QueryCtx, orgId: string, kits: readonly Doc<"kits">[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  for (const k of kits) {
    const [ser, blk] = await Promise.all([
      collectCapped(ctx.db.query("kitSerializedItems").withIndex("by_kitId", (q) => q.eq("kitId", k.id)), 500),
      collectCapped(ctx.db.query("kitBulkItems").withIndex("by_kitId", (q) => q.eq("kitId", k.id)), 500),
    ]);
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
    const live = kits.rows.filter((k) => k.isActive !== false && k.isPrep !== true).slice(0, KIT_DERIVE_CAP);
    const states = await loadKitStates(ctx, orgId, live, resolveNow(now));
    const counts: Record<KitSegmentKey, number> = { all: 0, complete: 0, missing: 0, onjob: 0 };
    for (const k of live) for (const key of KIT_SEGMENT_KEYS) if (kitInSegment(states.get(k.id)!, key)) counts[key]++;
    return counts;
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

/**
 * Read-only report (no backfill, no writes): kits that still STORE `INCOMPLETE` but have no missing
 * member, so they now read Available. Lets the owner see which ones changed meaning.
 */
export const legacyIncompleteReport = query({
  args: { orgId: v.string() },
  handler: async (ctx, { orgId }) => {
    await requireOrgReadFor(ctx, orgId, "kit");
    const { rows, truncated } = await collectCapped(ctx.db.query("kits").withIndex("by_organizationId", (q) => q.eq("organizationId", orgId)));
    const legacy = rows.filter((k) => k.status === "INCOMPLETE").slice(0, KIT_DERIVE_CAP);
    const states = await loadKitStates(ctx, orgId, legacy, Date.now());
    return {
      truncated,
      kits: legacy.filter((k) => states.get(k.id)!.legacyIncomplete).map((k) => ({ id: k.id, assetTag: k.assetTag, name: k.name })),
    };
  },
});

export const agentOps: AgentOpsAnnotations = {
  listPage: { summary: "One page of the Kits list with derived state (Incomplete / Reserved / Available), item count and filters." },
  segmentCounts: { summary: "Strip counts for the Kits list (all, complete, missing items, on a job)." },
  bookingGate: { summary: "A kit's derived booking state: whether it can be added to a job, and what is missing." },
  legacyIncompleteReport: { summary: "Kits that store the old INCOMPLETE status but have no missing member (they now read Available)." },
};
