import { v } from "convex/values";
import { query } from "./_generated/server";
import type { QueryCtx } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
import { requireOrgReadFor, getAuthContext, isAgentNoFinancials, redactFields } from "./lib/auth";
import type { AgentOpsAnnotations } from "./lib/agentOps";
import { dueAssetMap } from "./lib/assetAttention";
import { matchesSearch, compareValues, paginateItems } from "./lib/listQuery";
import { clampPageSize, collectCapped } from "./lib/pagination";
import { resolveNow } from "./lib/projectSegments";
import {
  SALE_STOCK_SEGMENT_KEYS,
  loadReservedByModel,
  parseSaleStockSegment,
  saleStockFacts,
  saleStockInSegment,
  type SaleStockSegmentKey,
} from "./lib/saleStockFacts";

/**
 * UX Phase 14 (14a-1) list reads for Models and Sales stock. Same shape as
 * `assets.listPage` / `projects.segmentCounts`: filter, derived segment, sort and paginate
 * on the server; every read is `by_organizationId` + `collectCapped` (never an unbounded
 * full-table read), with a `truncated` flag when a cap bites.
 */

/** Cost data (what the org paid / would pay): redacted for a `noFinancials` key, like `models.list`. */
const MODEL_COST_FIELDS = ["replacementCost", "defaultPurchasePrice"] as const;

const MODEL_SEGMENT_KEYS = ["all", "stock", "nostock", "due", "archived"] as const;
type ModelSegmentKey = (typeof MODEL_SEGMENT_KEYS)[number];
const parseModelSegment = (raw: string | undefined): ModelSegmentKey => MODEL_SEGMENT_KEYS.find((k) => k === raw) ?? "all";

interface ModelStock {
  owned: number;
  available: number;
}

/** modelId -> units owned / available NOW (active serialised units + bulk quantity). */
async function loadModelStock(ctx: QueryCtx, orgId: string): Promise<{ stock: Map<string, ModelStock>; truncated: boolean }> {
  const [assets, bulk] = await Promise.all([
    collectCapped(ctx.db.query("assets").withIndex("by_organizationId", (q) => q.eq("organizationId", orgId))),
    collectCapped(ctx.db.query("bulkAssets").withIndex("by_organizationId", (q) => q.eq("organizationId", orgId))),
  ]);
  const stock = new Map<string, ModelStock>();
  const entry = (id: string) => {
    let e = stock.get(id);
    if (!e) stock.set(id, (e = { owned: 0, available: 0 }));
    return e;
  };
  for (const a of assets.rows) {
    if (a.isActive === false) continue;
    const e = entry(a.modelId);
    e.owned++;
    if ((a.status ?? "AVAILABLE") === "AVAILABLE") e.available++;
  }
  for (const b of bulk.rows) {
    if (b.isActive === false) continue;
    const e = entry(b.modelId);
    e.owned += b.totalQuantity ?? 0;
    e.available += b.availableQuantity ?? 0;
  }
  return { stock, truncated: assets.truncated || bulk.truncated };
}

/** Models with at least one active asset due (or overdue) for T&T within the horizon: the Assets list's rule. */
async function modelsDueForTestTag(ctx: QueryCtx, orgId: string, now: number): Promise<{ ids: Set<string>; truncated: boolean }> {
  const { due, truncated } = await dueAssetMap(ctx, orgId, now);
  const ids = new Set<string>();
  for (const assetId of due.keys()) {
    const asset = await ctx.db.query("assets").withIndex("by_cuid", (q) => q.eq("id", assetId)).first();
    if (asset && asset.organizationId === orgId && asset.isActive !== false) ids.add(asset.modelId);
  }
  return { ids, truncated };
}

/** Pure: does the model belong in the strip segment? */
function modelInSegment(m: Pick<Doc<"models">, "id" | "isActive">, seg: ModelSegmentKey, owned: number, dueIds: Set<string>): boolean {
  const archived = m.isActive === false;
  if (seg === "archived") return archived;
  if (archived) return false;
  if (seg === "stock") return owned > 0;
  if (seg === "nostock") return owned === 0;
  if (seg === "due") return dueIds.has(m.id);
  return true;
}

/** The model's primary PHOTO, file resolved org-scoped. */
async function primaryPhoto(ctx: QueryCtx, orgId: string, modelId: string) {
  const rows = await ctx.db.query("modelMedia").withIndex("by_modelId", (q) => q.eq("modelId", modelId)).take(20);
  const m = rows.find((r) => r.organizationId === orgId && r.type === "PHOTO" && r.isPrimary);
  if (!m) return null;
  const file = await ctx.db.query("fileUploads").withIndex("by_cuid", (q) => q.eq("id", m.fileId)).unique();
  return file && file.organizationId === orgId ? { url: file.url ?? null, thumbnailUrl: file.thumbnailUrl ?? null } : null;
}

interface ModelFilterArgs {
  search?: string;
  categoryIdIn?: string[];
  assetTypeIn?: string[];
  tagsHasSome?: string[];
}

/** No list chosen = no filter; otherwise `value` must be in it. */
const inList = (list: string[] | undefined, value: string | undefined): boolean => !list?.length || (value != null && list.includes(value));

/** The filter words and search (the segment is tested separately). */
function matchesModelFilters(m: Doc<"models">, f: ModelFilterArgs): boolean {
  const tagOk = !f.tagsHasSome?.length || (m.tags ?? []).some((t) => f.tagsHasSome!.includes(t));
  const searchOk = !f.search || matchesSearch([m.name, m.manufacturer, m.modelNumber, m.sku], f.search);
  return inList(f.categoryIdIn, m.categoryId) && inList(f.assetTypeIn, m.assetType ?? "SERIALIZED") && tagOk && searchOk;
}

interface SortCtx {
  categoryById: Map<string, Doc<"categories">>;
  stock: Map<string, ModelStock>;
}

/** The value each derived column orders by; any other key is a plain model field. */
const DERIVED_SORT_KEYS: Record<string, (m: Doc<"models">, c: SortCtx) => unknown> = {
  category: (m, c) => c.categoryById.get(m.categoryId ?? "")?.name,
  owned: (m, c) => c.stock.get(m.id)?.owned ?? 0,
  available: (m, c) => c.stock.get(m.id)?.available ?? 0,
  assetType: (m) => m.assetType ?? "SERIALIZED",
};

function modelSortKey(m: Doc<"models">, sortBy: string, c: SortCtx): unknown {
  return (DERIVED_SORT_KEYS[sortBy] ?? ((x: Doc<"models">) => (x as unknown as Record<string, unknown>)[sortBy]))(m, c);
}

/** The category with its parent's name (for `Lighting → Moving heads`), or null. */
function categoryOf(m: Doc<"models">, byId: Map<string, Doc<"categories">>) {
  const cat = m.categoryId ? byId.get(m.categoryId) : undefined;
  if (!cat) return null;
  return { id: cat.id, name: cat.name, parentName: (cat.parentId && byId.get(cat.parentId)?.name) || null };
}

/** One page row: the model (cost fields redacted for a noFinancials key) plus category, counts and photo. */
async function shapeModelRow(ctx: QueryCtx, orgId: string, m: Doc<"models">, c: SortCtx & { redact: boolean }) {
  return {
    ...(c.redact ? redactFields(m, MODEL_COST_FIELDS) : m),
    category: categoryOf(m, c.categoryById),
    owned: c.stock.get(m.id)?.owned ?? 0,
    available: c.stock.get(m.id)?.available ?? 0,
    media: await primaryPhoto(ctx, orgId, m.id),
  };
}

const sortDir = v.optional(v.union(v.literal("asc"), v.literal("desc")));

/** One page of the Models list. */
export const listPage = query({
  args: {
    orgId: v.string(),
    search: v.optional(v.string()),
    categoryIdIn: v.optional(v.array(v.string())),
    assetTypeIn: v.optional(v.array(v.string())),
    tagsHasSome: v.optional(v.array(v.string())),
    segment: v.optional(v.string()),
    /** Only read for the `due` segment. */
    now: v.optional(v.number()),
    page: v.optional(v.number()),
    pageSize: v.optional(v.number()),
    sortBy: v.optional(v.string()),
    sortOrder: sortDir,
  },
  handler: async (ctx, a) => {
    await requireOrgReadFor(ctx, a.orgId, "model");
    const seg = parseModelSegment(a.segment);
    const sortBy = a.sortBy ?? "name";
    const dir: 1 | -1 = a.sortOrder === "desc" ? -1 : 1;

    const [models, categories, { stock, truncated: stockTruncated }, due] = await Promise.all([
      collectCapped(ctx.db.query("models").withIndex("by_organizationId", (q) => q.eq("organizationId", a.orgId))),
      collectCapped(ctx.db.query("categories").withIndex("by_organizationId", (q) => q.eq("organizationId", a.orgId))),
      loadModelStock(ctx, a.orgId),
      seg === "due" ? modelsDueForTestTag(ctx, a.orgId, resolveNow(a.now)) : Promise.resolve({ ids: new Set<string>(), truncated: false }),
    ]);
    const categoryById = new Map(categories.rows.map((c) => [c.id, c]));
    const ownedOf = (m: Doc<"models">) => stock.get(m.id)?.owned ?? 0;

    const filtered = models.rows.filter((m) => modelInSegment(m, seg, ownedOf(m), due.ids) && matchesModelFilters(m, a));
    const sortCtx: SortCtx = { categoryById, stock };
    const sorted = [...filtered].sort((x, y) => compareValues(modelSortKey(x, sortBy, sortCtx), modelSortKey(y, sortBy, sortCtx), dir) || x.name.localeCompare(y.name));
    const paged = paginateItems(sorted, a.page ?? 1, clampPageSize(a.pageSize ?? 25));

    const redact = await isAgentNoFinancials(ctx, await getAuthContext(ctx));
    const items = [];
    for (const m of paged.items) items.push(await shapeModelRow(ctx, a.orgId, m, { redact, ...sortCtx }));
    return { ...paged, items, truncated: models.truncated || stockTruncated || due.truncated };
  },
});

/** Strip counts for the Models list. */
export const segmentCounts = query({
  args: { orgId: v.string(), now: v.optional(v.number()) },
  handler: async (ctx, { orgId, now }) => {
    await requireOrgReadFor(ctx, orgId, "model");
    const [models, { stock }, due] = await Promise.all([
      collectCapped(ctx.db.query("models").withIndex("by_organizationId", (q) => q.eq("organizationId", orgId))),
      loadModelStock(ctx, orgId),
      modelsDueForTestTag(ctx, orgId, resolveNow(now)),
    ]);
    const counts: Record<ModelSegmentKey, number> = { all: 0, stock: 0, nostock: 0, due: 0, archived: 0 };
    for (const m of models.rows) {
      const owned = stock.get(m.id)?.owned ?? 0;
      for (const key of MODEL_SEGMENT_KEYS) if (modelInSegment(m, key, owned, due.ids)) counts[key]++;
    }
    return counts;
  },
});

/**
 * One page of the Sales stock list: active models with the stored pool as `available` and the
 * derived `reserved` / `onHand` (convex/lib/saleStockFacts.ts is the ONE definition).
 */
export const saleStockPage = query({
  args: {
    orgId: v.string(),
    search: v.optional(v.string()),
    categoryIdIn: v.optional(v.array(v.string())),
    segment: v.optional(v.string()),
    page: v.optional(v.number()),
    pageSize: v.optional(v.number()),
    sortBy: v.optional(v.string()),
    sortOrder: sortDir,
  },
  handler: async (ctx, a) => {
    await requireOrgReadFor(ctx, a.orgId, "model");
    const seg = parseSaleStockSegment(a.segment);
    const sortBy = a.sortBy ?? "available";
    const dir: 1 | -1 = a.sortOrder === "desc" ? -1 : 1;
    const [models, categories] = await Promise.all([
      collectCapped(ctx.db.query("models").withIndex("by_organizationId", (q) => q.eq("organizationId", a.orgId))),
      collectCapped(ctx.db.query("categories").withIndex("by_organizationId", (q) => q.eq("organizationId", a.orgId))),
    ]);
    const categoryById = new Map(categories.rows.map((c) => [c.id, c]));
    // The strip state needs only the pool and the reorder level, never the line reads.
    const stateOf = (m: Doc<"models">) => saleStockFacts({ pool: m.saleStockQuantity, reserved: 0, reorderLevel: m.reorderLevel }).state;

    const filtered = models.rows.filter((m) => {
      if (m.isActive === false) return false;
      if (!saleStockInSegment(stateOf(m), seg)) return false;
      if (a.categoryIdIn?.length && !(m.categoryId && a.categoryIdIn.includes(m.categoryId))) return false;
      return !a.search || matchesSearch([m.name, m.manufacturer, m.modelNumber, m.sku], a.search);
    });
    const keyOf = (m: Doc<"models">): unknown => {
      if (sortBy === "category") return categoryById.get(m.categoryId ?? "")?.name;
      if (sortBy === "available") return m.saleStockQuantity ?? 0;
      return (m as unknown as Record<string, unknown>)[sortBy];
    };
    const sorted = [...filtered].sort((x, y) => compareValues(keyOf(x), keyOf(y), dir) || x.name.localeCompare(y.name));
    const paged = paginateItems(sorted, a.page ?? 1, clampPageSize(a.pageSize ?? 25));
    const { reserved, truncated: linesTruncated } = await loadReservedByModel(ctx, a.orgId, paged.items.map((m) => m.id));
    const items = paged.items.map((m) => {
      const cat = m.categoryId ? categoryById.get(m.categoryId) : undefined;
      return {
        id: m.id,
        name: m.name,
        manufacturer: m.manufacturer ?? null,
        sku: m.sku ?? null,
        salePrice: m.salePrice ?? null,
        reorderLevel: m.reorderLevel ?? null,
        category: cat ? { id: cat.id, name: cat.name } : null,
        ...saleStockFacts({ pool: m.saleStockQuantity, reserved: reserved.get(m.id) ?? 0, reorderLevel: m.reorderLevel }),
      };
    });
    return { ...paged, items, truncated: models.truncated || linesTruncated };
  },
});

export const saleStockSegmentCounts = query({
  args: { orgId: v.string() },
  handler: async (ctx, { orgId }) => {
    await requireOrgReadFor(ctx, orgId, "model");
    const { rows } = await collectCapped(ctx.db.query("models").withIndex("by_organizationId", (q) => q.eq("organizationId", orgId)));
    const counts: Record<SaleStockSegmentKey, number> = { all: 0, low: 0, out: 0 };
    for (const m of rows) {
      if (m.isActive === false) continue;
      const state = saleStockFacts({ pool: m.saleStockQuantity, reserved: 0, reorderLevel: m.reorderLevel }).state;
      for (const key of SALE_STOCK_SEGMENT_KEYS) if (saleStockInSegment(state, key)) counts[key]++;
    }
    return counts;
  },
});

export const agentOps: AgentOpsAnnotations = {
  listPage: { summary: "One page of the Models list with owned/available counts, derived segment and filters." },
  segmentCounts: { summary: "Strip counts for the Models list (all, with stock, no stock, due for T&T, archived)." },
  saleStockPage: { summary: "One page of the Sales stock list: available, derived reserved and on hand, reorder level." },
  saleStockSegmentCounts: { summary: "Strip counts for the Sales stock list (all, low, out)." },
};
