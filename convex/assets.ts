import { v, ConvexError } from "convex/values";
import { query, mutation, type QueryCtx } from "./_generated/server";
import { requireOrgReadFor, requireOrgReadDocFor, requireOrgPermission, requireService } from "./lib/auth";
import { bumpCountersForTable } from "./lib/counters";
import { LocationMovements, stampLocationMovement } from "./lib/locationMovement";
import { matchesSearch, compareValues, paginateItems } from "./lib/listQuery";
import * as enums from "./lib/validators";
import type { AgentOpsAnnotations } from "./lib/agentOps";
import { assetInSegment, dueAssetMap, parseAssetSegment } from "./lib/assetAttention";
import { resolveNow } from "./lib/projectSegments";
import { assetCostGuard } from "./lib/gearCostRedact";

/**
 * Thin CRUD for Asset (Convex table "assets"). GENERATED — Phase 2/5.
 *
 * AUTH (Phase 5, convex/lib/auth.ts): mutations require the trusted backend
 * SERVICE token (service-only mirror/read helpers; the browser-direct write path with RBAC +
 * validation + audit enforced inside Convex lives in the *Writes.ts mutations — see FEATUREDOCS/54). Org-scoped reads
 * accept the service token OR a user token scoped to the same org. Lookups use the
 * cuid (`id`) via by_cuid. See FEATUREDOCS/54.
 *
 * COUNTER MAINTENANCE (§3.6): the mutating funcs keep the dashboardCounters row in
 * sync in-transaction via bumpCountersForTable (convex/lib/counters.ts). Emitted by
 * the generator for the five counted tables — re-add on regen. See FEATUREDOCS/54.
 */

export const list = query({
  args: { orgId: v.string() },
  handler: async (ctx, { orgId }) => {
    await requireOrgReadFor(ctx, orgId, "asset"); // Phase 2 read bootstrap (#998)
    const cost = await assetCostGuard(ctx);
    const rows = await ctx.db
      .query("assets")
      .withIndex("by_organizationId", (q) => q.eq("organizationId", orgId)) // r9.8-ok: cross-domain server-read helper (getAssetsByOrg/getMappedAssetsByOrg), not a browser subscription — see docs/exceptions.md R-8.3.3
      .collect();
    return rows.map(cost.row);
  },
});

const A_STATUS_RANK: Record<string, number> = { AVAILABLE: 0, CHECKED_OUT: 1, IN_MAINTENANCE: 2, RETIRED: 3, LOST: 4, RESERVED: 5, SOLD: 6 };
const A_CONDITION_RANK: Record<string, number> = { NEW: 0, GOOD: 1, FAIR: 2, POOR: 3, DAMAGED: 4 };

/**
 * Paginated ASSET list — browser-native replacement for the getAssets server action.
 * Fetches the org's assets + model(with category)/location maps, then filters/sorts/
 * paginates in JS (parity with filterAssets/sortAssets/paginate). Two consumers: the
 * T&T-new picker (one-shot, non-reactive) and AssetTable (live, via useAuthedQuery —
 * see docs/designs/perf-convex-efficiency-2026-06.md Finding #1).
 */
export const listPage = query({
  args: {
    orgId: v.string(),
    search: v.optional(v.string()),
    categoryId: v.optional(v.string()),
    status: v.optional(v.string()),
    condition: v.optional(v.string()),
    locationId: v.optional(v.string()),
    modelId: v.optional(v.string()),
    isActive: v.optional(v.boolean()),
    statusIn: v.optional(v.array(v.string())),
    conditionIn: v.optional(v.array(v.string())),
    locationIdIn: v.optional(v.array(v.string())),
    categoryIdIn: v.optional(v.array(v.string())),
    tagsHasSome: v.optional(v.array(v.string())),
    modelIdIn: v.optional(v.array(v.string())),
    /** Derived segment (assetAttention.ts): available | on-jobs | maintenance | retired | due | attention. */
    segment: v.optional(v.string()),
    /** Only read for the `due`/`attention` segments; clamped to the server clock. */
    now: v.optional(v.number()),
    page: v.optional(v.number()),
    pageSize: v.optional(v.number()),
    sortBy: v.optional(v.string()),
    sortOrder: v.optional(v.union(v.literal("asc"), v.literal("desc"))),
  },
  handler: async (ctx, a) => {
    await requireOrgReadFor(ctx, a.orgId, "asset"); // Phase 5 domain slice (#1001)
    const segment = parseAssetSegment(a.segment);
    const now = resolveNow(a.now);
    const needsDue = segment === "due" || segment === "attention";
    const dueRead = needsDue ? await dueAssetMap(ctx, a.orgId, now) : { due: new Map<string, number>(), truncated: false, cap: 0 };
    const due = dueRead.due;
    // The Retired segment looks at retired rows, which the default listing hides (isActive).
    const isActive = segment === "retired" ? false : (a.isActive ?? true);
    const page = a.page ?? 1;
    const pageSize = a.pageSize ?? 25;
    const cost = await assetCostGuard(ctx);
    const sortBy = cost.sort(a.sortBy); // an allow-list; a hidden cost column is not a sort key
    const dir: 1 | -1 = a.sortOrder === "desc" ? -1 : 1;

    const [rows, models, categories, locations] = await Promise.all([
      ctx.db.query("assets").withIndex("by_organizationId", (q) => q.eq("organizationId", a.orgId)).collect(), // r9.8-ok: T3 (denormalize+searchIndex) approved but unshipped — see docs/exceptions.md R-8.3.3
      ctx.db.query("models").withIndex("by_organizationId", (q) => q.eq("organizationId", a.orgId)).collect(), // r9.8-ok: bounded per-org catalog/config map (list enrichment) — see docs/exceptions.md R-8.3.3
      ctx.db.query("categories").withIndex("by_organizationId", (q) => q.eq("organizationId", a.orgId)).collect(), // r9.8-ok: bounded per-org catalog/config map (list enrichment) — see docs/exceptions.md R-8.3.3
      ctx.db.query("locations").withIndex("by_organizationId", (q) => q.eq("organizationId", a.orgId)).collect(), // r9.8-ok: bounded per-org catalog/config map (list enrichment) — see docs/exceptions.md R-8.3.3
    ]);
    const modelMap = new Map(models.map((m) => [m.id, m]));
    const categoryMap = new Map(categories.map((c) => [c.id, c]));
    const locationMap = new Map(locations.map((l) => [l.id, l]));
    const modelNameFor = (id: string) => modelMap.get(id)?.name;
    const categoryFor = (id: string) => modelMap.get(id)?.categoryId;
    const locationNameFor = (id: string | null) => (id ? locationMap.get(id)?.name : null);

    const filtered = rows.filter((r) => {
      const status = r.status ?? "AVAILABLE";
      const condition = r.condition ?? "GOOD";
      if ((r.isActive ?? true) !== isActive) return false;
      if (a.status && status !== a.status) return false;
      if (a.condition && condition !== a.condition) return false;
      if (a.locationId && (r.locationId ?? null) !== a.locationId) return false;
      if (a.modelId && r.modelId !== a.modelId) return false;
      if (a.categoryId && categoryFor(r.modelId) !== a.categoryId) return false;
      if (a.statusIn && a.statusIn.length > 0 && !a.statusIn.includes(status)) return false;
      if (a.conditionIn && a.conditionIn.length > 0 && !a.conditionIn.includes(condition)) return false;
      if (a.locationIdIn && a.locationIdIn.length > 0 && !(r.locationId != null && a.locationIdIn.includes(r.locationId))) return false;
      if (a.categoryIdIn && a.categoryIdIn.length > 0) { const cat = categoryFor(r.modelId); if (!(cat != null && a.categoryIdIn.includes(cat))) return false; }
      if (a.tagsHasSome && a.tagsHasSome.length > 0 && !(r.tags ?? []).some((t) => a.tagsHasSome!.includes(t))) return false;
      if (a.modelIdIn && a.modelIdIn.length > 0 && !a.modelIdIn.includes(r.modelId)) return false;
      if (!assetInSegment(r, segment, due, now)) return false;
      if (a.search && !matchesSearch([r.assetTag, r.serialNumber, r.customName, modelNameFor(r.modelId)], a.search)) return false;
      return true;
    });
    const keyFn = (r: typeof rows[number]): unknown => {
      if (sortBy === "model") return modelNameFor(r.modelId);
      if (sortBy === "location") return locationNameFor(r.locationId ?? null);
      if (sortBy === "status") return A_STATUS_RANK[r.status ?? "AVAILABLE"];
      if (sortBy === "condition") return A_CONDITION_RANK[r.condition ?? "GOOD"];
      return (r as unknown as Record<string, unknown>)[sortBy];
    };
    const sorted = [...filtered].sort((x, y) => compareValues(keyFn(x), keyFn(y), dir));
    const { items: pageRows, total, totalPages } = paginateItems(sorted, page, pageSize);

    const assets = pageRows.map((r) => {
      const model = modelMap.get(r.modelId) ?? null;
      return {
        ...cost.row(r),
        model: model ? { ...cost.model(model), category: model.categoryId ? categoryMap.get(model.categoryId) ?? null : null } : null,
        location: r.locationId ? locationMap.get(r.locationId) ?? null : null,
      };
    });
    // `dueCap` is set only when the due set was cut short: the segment is then "the first n", not complete.
    return { assets, total, page, pageSize, totalPages, dueCap: dueRead.truncated ? dueRead.cap : null };
  },
});

const ROW_EXTRAS_MAX_IDS = 100;
const TT_SCHEDULES_PER_ASSET = 5;

/**
 * The Assets list's two derived columns for ONE page of rows (UX unification §9b):
 * `nextDue` (earliest active T&T date) and `job` (the project a CHECKED_OUT unit is on).
 * Derived on read, never stored. Bounded: at most ROW_EXTRAS_MAX_IDS assets, each a
 * handful of indexed reads; every by_cuid read is org-checked, so an id from another
 * org yields no entry.
 */
export const rowExtras = query({
  args: { orgId: v.string(), ids: v.array(v.string()) },
  handler: async (ctx, { orgId, ids }) => {
    await requireOrgReadFor(ctx, orgId, "asset");
    // Each sub-field is gated on its OWN resource (RBAC + agent scope): a caller who cannot
    // read projects / test-and-tag simply gets that field omitted, never an error.
    const canJob = await canRead(ctx, orgId, "project");
    const canDue = await canRead(ctx, orgId, "testTag");
    const out: Record<string, { nextDue?: number | null; job?: { id: string; name: string; number: string } | null }> = {};
    for (const id of new Set(ids.slice(0, ROW_EXTRAS_MAX_IDS))) {
      const asset = await ctx.db.query("assets").withIndex("by_cuid", (q) => q.eq("id", id)).first();
      if (!asset || asset.organizationId !== orgId) continue;
      out[id] = {
        ...(canDue ? { nextDue: await nextDueFor(ctx, orgId, id) } : {}),
        ...(canJob ? { job: await jobFor(ctx, orgId, id) } : {}),
      };
    }
    return out;
  },
});

/**
 * Non-throwing read check. `requireOrgReadFor` is the agent-aware read guard (an agent's key
 * must carry `<resource>:read`); `requireOrgPermission` then applies the member's live RBAC.
 * Only a ConvexError (the auth failure itself) means "cannot read": anything else is a real
 * fault and propagates.
 */
async function canRead(ctx: QueryCtx, orgId: string, resource: "project" | "testTag"): Promise<boolean> {
  try {
    await requireOrgReadFor(ctx, orgId, resource);
    await requireOrgPermission(ctx, orgId, resource, "read");
    return true;
  } catch (e) {
    if (e instanceof ConvexError) return false;
    throw e;
  }
}

async function nextDueFor(ctx: QueryCtx, orgId: string, assetId: string): Promise<number | null> {
  // Org-scoped index; foreign/inactive/undated schedules are filtered BEFORE the cap.
  const schedules = await ctx.db
    .query("testTagAssets")
    .withIndex("by_organizationId_assetId", (q) => q.eq("organizationId", orgId).eq("assetId", assetId))
    .filter((q) => q.and(q.neq(q.field("isActive"), false), q.neq(q.field("nextDueDate"), undefined)))
    .take(TT_SCHEDULES_PER_ASSET);
  const dates = schedules.map((s) => s.nextDueDate as number);
  return dates.length > 0 ? Math.min(...dates) : null;
}

async function jobFor(ctx: QueryCtx, orgId: string, assetId: string) {
  const unit = await ctx.db
    .query("projectLineItemUnits")
    .withIndex("by_organizationId_assetId_status", (q) => q.eq("organizationId", orgId).eq("assetId", assetId).eq("status", "CHECKED_OUT"))
    .first();
  if (!unit) return null;
  const line = await ctx.db.query("projectLineItems").withIndex("by_cuid", (q) => q.eq("id", unit.lineItemId)).first();
  if (!line || line.organizationId !== orgId) return null;
  const project = await ctx.db.query("projects").withIndex("by_cuid", (q) => q.eq("id", line.projectId)).first();
  if (!project || project.organizationId !== orgId) return null;
  return { id: project.id, name: project.name, number: project.projectNumber };
}

/**
 * ALL of an org's active serialized assets (NOT paginated), sorted by model
 * name — browser-native backend for the asset gallery's "browse the whole
 * catalogue" view (`asset-gallery.tsx`). Unlike `listPage`, this returns every
 * matching row in one shot: the gallery groups everything by category on one
 * scroll, which doesn't fit a paginated contract (see docs/designs/
 * perf-convex-efficiency-2026-06.md Finding #1 — "Option A" decision). Read
 * shape is still O(org's active assets), since "show everything" is the
 * feature, but it's now ONE query with joins + search done server-side,
 * replacing the 4 whole-org live subscriptions (assets/models/categories/
 * locations) the gallery used to mount and filter/join client-side.
 */
export const listGallery = query({
  args: { orgId: v.string(), search: v.optional(v.string()) },
  handler: async (ctx, { orgId, search }) => {
    await requireOrgReadFor(ctx, orgId, "asset"); // Phase 5 domain slice (#1001)
    const [rows, models, categories, locations] = await Promise.all([
      ctx.db.query("assets").withIndex("by_organizationId", (q) => q.eq("organizationId", orgId)).collect(), // r9.8-ok: "browse everything" gallery view, Option A (perf design) — see docs/exceptions.md R-8.3.3
      ctx.db.query("models").withIndex("by_organizationId", (q) => q.eq("organizationId", orgId)).collect(), // r9.8-ok: bounded per-org catalog/config map (list enrichment) — see docs/exceptions.md R-8.3.3
      ctx.db.query("categories").withIndex("by_organizationId", (q) => q.eq("organizationId", orgId)).collect(), // r9.8-ok: bounded per-org catalog/config map (list enrichment) — see docs/exceptions.md R-8.3.3
      ctx.db.query("locations").withIndex("by_organizationId", (q) => q.eq("organizationId", orgId)).collect(), // r9.8-ok: bounded per-org catalog/config map (list enrichment) — see docs/exceptions.md R-8.3.3
    ]);
    const modelMap = new Map(models.map((m) => [m.id, m]));
    const categoryMap = new Map(categories.map((c) => [c.id, c]));
    const locationMap = new Map(locations.map((l) => [l.id, l]));
    const modelNameFor = (id: string) => modelMap.get(id)?.name;

    const filtered = rows.filter((r) => {
      if ((r.isActive ?? true) !== true) return false;
      if (search && !matchesSearch([r.assetTag, r.serialNumber, r.customName, modelNameFor(r.modelId)], search)) return false;
      return true;
    });

    const sorted = [...filtered].sort((x, y) =>
      String(modelNameFor(x.modelId) ?? "").localeCompare(String(modelNameFor(y.modelId) ?? ""), undefined, { sensitivity: "base" }),
    );

    const cost = await assetCostGuard(ctx);
    return sorted.map((r) => {
      const model = modelMap.get(r.modelId) ?? null;
      return {
        ...cost.row(r),
        model: model ? { ...cost.model(model), category: model.categoryId ? categoryMap.get(model.categoryId) ?? null : null } : null,
        location: r.locationId ? locationMap.get(r.locationId) ?? null : null,
      };
    });
  },
});

/**
 * Primary-photo maps for the asset registry table + gallery — browser-native
 * replacement for getAssetRegistryPhotos. Returns { assetPhotos, modelPhotos }:
 * each id → { url, thumbnailUrl } of its PHOTO+isPrimary media row's file (org-scoped).
 */
export const registryPhotos = query({
  args: { orgId: v.string() },
  handler: async (ctx, { orgId }) => {
    await requireOrgReadFor(ctx, orgId, "asset"); // Phase 5 domain slice (#1001)
    type Photo = { url: string | null; thumbnailUrl: string | null };
    const resolveFile = async (fileId: string): Promise<Photo> => {
      const file = await ctx.db.query("fileUploads").withIndex("by_cuid", (q) => q.eq("id", fileId)).unique();
      const resolved = file && file.organizationId === orgId ? file : null;
      return { url: resolved?.url ?? null, thumbnailUrl: resolved?.thumbnailUrl ?? null };
    };

    // assetMedia is fleet-scale (grows with the org's asset count) — narrowed via
    // the isPrimary index instead of an org-wide collect (R-9.8/#901). isPrimary is
    // a plain boolean with no "default when absent" semantics, so an exact-match
    // index is safe (unlike status/date fields elsewhere in this codebase).
    const assetPhotos: Record<string, Photo> = {};
    const primaryAssetMedia = await ctx.db
      .query("assetMedia")
      .withIndex("by_organizationId_isPrimary", (q) => q.eq("organizationId", orgId).eq("isPrimary", true))
      .collect();
    for (const m of primaryAssetMedia) {
      if (m.type !== "PHOTO") continue;
      assetPhotos[m.assetId] = await resolveFile(m.fileId);
    }

    // modelMedia stays a full org collect — catalog-scale (a handful of media rows
    // per model), same table/reasoning as the registered modelMedia.ts:list() row.
    const modelPhotos: Record<string, Photo> = {};
    const allModelMedia = await ctx.db.query("modelMedia").withIndex("by_organizationId", (q) => q.eq("organizationId", orgId)).collect(); // r9.8-ok: aggregation — org-wide primary-photo map — see docs/exceptions.md R-8.3.3
    for (const m of allModelMedia) {
      if (m.type !== "PHOTO" || !m.isPrimary) continue;
      modelPhotos[m.modelId] = await resolveFile(m.fileId);
    }

    return { assetPhotos, modelPhotos };
  },
});

export const getById = query({
  args: { id: v.string() },
  handler: async (ctx, { id }) => {
    const doc = await ctx.db.query("assets").withIndex("by_cuid", (q) => q.eq("id", id)).unique();
    await requireOrgReadDocFor(ctx, doc, "asset"); // Phase 2 read bootstrap (#998)
    return doc ? (await assetCostGuard(ctx)).row(doc) : doc;
  },
});

export const getByAssetTag = query({
  args: { organizationId: v.string(), assetTag: v.string() },
  handler: async (ctx, { organizationId, assetTag }) => {
    await requireOrgReadFor(ctx, organizationId, "asset"); // Phase 5 domain slice (#1001)
    const doc = await ctx.db
      .query("assets")
      .withIndex("by_organizationId_assetTag", (q) => q.eq("organizationId", organizationId).eq("assetTag", assetTag))
      .unique();
    return doc ? (await assetCostGuard(ctx)).row(doc) : doc;
  },
});

export const listByModel = query({
  args: { modelId: v.string(), orgId: v.string() },
  handler: async (ctx, { modelId, orgId }) => {
    await requireOrgReadFor(ctx, orgId, "asset"); // Phase 2 read bootstrap (#998)
    // by_modelId is a GLOBAL index — filter to the caller's org (cross-tenant guard).
    const cost = await assetCostGuard(ctx);
    return (await ctx.db
      .query("assets")
      .withIndex("by_modelId", (q) => q.eq("modelId", modelId))
      .collect()).filter((r) => r.organizationId === orgId).map(cost.row);
  },
});

/**
 * Batch the per-model `by_modelId` scans for MANY models into ONE round-trip.
 * Replaces an N+1 of N separate `listByModel` calls (e.g. availability computes
 * stock per model across a projects view). Deduped + capped; org-filtered.
 */
export const listByModelIds = query({
  args: { orgId: v.string(), modelIds: v.array(v.string()) },
  handler: async (ctx, { orgId, modelIds }) => {
    await requireOrgReadFor(ctx, orgId, "asset"); // Phase 5 domain slice (#1001)
    const unique = [...new Set(modelIds)];
    if (unique.length > 1000) throw new ConvexError("assets.listByModelIds: too many modelIds (max 1000)");
    const groups = await Promise.all(
      unique.map((mid) => ctx.db.query("assets").withIndex("by_modelId", (q) => q.eq("modelId", mid)).collect()),
    );
    const cost = await assetCostGuard(ctx);
    return groups.flat().filter((a) => a.organizationId === orgId).map(cost.row);
  },
});

/**
 * Batch point-read assets by cuid, scoped to one org. Lets a detail composite
 * (e.g. getKit) read only its member assets by id instead of collecting the whole
 * org registry (getAssetsByOrg) and filtering in JS. Cross-org ids are dropped,
 * never returned. Order is NOT guaranteed (callers key by id).
 */
export const listByIds = query({
  args: { orgId: v.string(), ids: v.array(v.string()) },
  handler: async (ctx, { orgId, ids }) => {
    await requireOrgReadFor(ctx, orgId, "asset"); // Phase 5 domain slice (#1001)
    // Dedupe + cap: this is user-callable, so an unbounded id array would fan out
    // arbitrarily many point-reads. 1000 is comfortable headroom over any real
    // detail composite's member count.
    const unique = [...new Set(ids)];
    if (unique.length > 1000) throw new ConvexError("assets.listByIds: too many ids (max 1000)");
    const docs = await Promise.all(
      unique.map((id) => ctx.db.query("assets").withIndex("by_cuid", (q) => q.eq("id", id)).unique()),
    );
    const cost = await assetCostGuard(ctx);
    return docs.filter((d): d is NonNullable<typeof d> => d !== null && d.organizationId === orgId).map(cost.row);
  },
});

export const create = mutation({
  args: {
    id: v.string(),
    organizationId: v.string(),
    modelId: v.string(),
    assetTag: v.string(),
    serialNumber: v.optional(v.string()),
    customName: v.optional(v.string()),
    status: v.optional(enums.AssetStatus),
    condition: v.optional(enums.AssetCondition),
    purchaseDate: v.optional(v.number()),
    purchasePrice: v.optional(v.number()),
    purchaseSupplier: v.optional(v.string()),
    supplierId: v.optional(v.string()),
    purchaseOrderNumber: v.optional(v.string()),
    supplierOrderId: v.optional(v.string()),
    warrantyExpiry: v.optional(v.number()),
    notes: v.optional(v.string()),
    locationId: v.optional(v.string()),
    customFieldValues: v.optional(v.any()),
    lastTestAndTagDate: v.optional(v.number()),
    nextTestAndTagDate: v.optional(v.number()),
    barcode: v.optional(v.string()),
    qrCode: v.optional(v.string()),
    images: v.optional(v.array(v.string())),
    tags: v.optional(v.array(v.string())),
    isActive: v.optional(v.boolean()),
    createdAt: v.optional(v.number()),
    updatedAt: v.optional(v.number()),
    kitId: v.optional(v.string()),
    parentAssetId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await requireService(ctx);
    const _id = await ctx.db.insert("assets", args);
    await stampLocationMovement(ctx, args.organizationId, null, args.locationId ?? null, args.updatedAt ?? Date.now());
    await bumpCountersForTable(ctx, "assets", null, args);
    return _id;
  },
});

/**
 * Insert many assets in ONE atomic mutation with an in-transaction duplicate-tag
 * guard — collapses createAssets' per-asset loop (dup-guard read + create +
 * read-back = 3 round-trips per asset). The guard uses the by_organizationId_
 * assetTag index and also catches duplicates WITHIN the batch (a prior insert in
 * the same transaction is visible). On a dup it throws a structured ConvexError
 * the server action maps to its DUPLICATE_ASSET_TAG UserFacingError.
 */
export const createMany = mutation({
  args: {
    assets: v.array(
      v.object({
        id: v.string(),
        organizationId: v.string(),
        modelId: v.string(),
        assetTag: v.string(),
        serialNumber: v.optional(v.string()),
        customName: v.optional(v.string()),
        status: v.optional(enums.AssetStatus),
        condition: v.optional(enums.AssetCondition),
        purchaseDate: v.optional(v.number()),
        purchasePrice: v.optional(v.number()),
        purchaseSupplier: v.optional(v.string()),
        supplierId: v.optional(v.string()),
        purchaseOrderNumber: v.optional(v.string()),
        supplierOrderId: v.optional(v.string()),
        warrantyExpiry: v.optional(v.number()),
        notes: v.optional(v.string()),
        locationId: v.optional(v.string()),
        customFieldValues: v.optional(v.any()),
        lastTestAndTagDate: v.optional(v.number()),
        nextTestAndTagDate: v.optional(v.number()),
        barcode: v.optional(v.string()),
        qrCode: v.optional(v.string()),
        images: v.optional(v.array(v.string())),
        tags: v.optional(v.array(v.string())),
        isActive: v.optional(v.boolean()),
        createdAt: v.optional(v.number()),
        updatedAt: v.optional(v.number()),
        kitId: v.optional(v.string()),
        parentAssetId: v.optional(v.string()),
      }),
    ),
  },
  handler: async (ctx, { assets }) => {
    await requireService(ctx);
    const ids: string[] = [];
    for (const a of assets) {
      const dup = await ctx.db
        .query("assets")
        .withIndex("by_organizationId_assetTag", (q) => q.eq("organizationId", a.organizationId).eq("assetTag", a.assetTag))
        .first();
      if (dup) throw new ConvexError({ code: "DUPLICATE_ASSET_TAG", tag: a.assetTag });
      await ctx.db.insert("assets", a);
      await stampLocationMovement(ctx, a.organizationId, null, a.locationId ?? null, a.updatedAt ?? Date.now());
      await bumpCountersForTable(ctx, "assets", null, a);
      ids.push(a.id);
    }
    return { ids };
  },
});

export const createIfMissing = mutation({
  args: {
    id: v.string(),
    organizationId: v.string(),
    modelId: v.string(),
    assetTag: v.string(),
    serialNumber: v.optional(v.string()),
    customName: v.optional(v.string()),
    status: v.optional(enums.AssetStatus),
    condition: v.optional(enums.AssetCondition),
    purchaseDate: v.optional(v.number()),
    purchasePrice: v.optional(v.number()),
    purchaseSupplier: v.optional(v.string()),
    supplierId: v.optional(v.string()),
    purchaseOrderNumber: v.optional(v.string()),
    supplierOrderId: v.optional(v.string()),
    warrantyExpiry: v.optional(v.number()),
    notes: v.optional(v.string()),
    locationId: v.optional(v.string()),
    customFieldValues: v.optional(v.any()),
    lastTestAndTagDate: v.optional(v.number()),
    nextTestAndTagDate: v.optional(v.number()),
    barcode: v.optional(v.string()),
    qrCode: v.optional(v.string()),
    images: v.optional(v.array(v.string())),
    tags: v.optional(v.array(v.string())),
    isActive: v.optional(v.boolean()),
    createdAt: v.optional(v.number()),
    updatedAt: v.optional(v.number()),
    kitId: v.optional(v.string()),
    parentAssetId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await requireService(ctx);
    const existing = await ctx.db.query("assets").withIndex("by_cuid", (q) => q.eq("id", args.id)).unique();
    if (existing) return { _id: existing._id, created: false };
    const _id = await ctx.db.insert("assets", args);
    await stampLocationMovement(ctx, args.organizationId, null, args.locationId ?? null, args.updatedAt ?? Date.now());
    await bumpCountersForTable(ctx, "assets", null, args);
    return { _id, created: true };
  },
});

export const update = mutation({
  args: {
    id: v.string(),
    patch: v.object({
      organizationId: v.optional(v.string()),
      modelId: v.optional(v.string()),
      assetTag: v.optional(v.string()),
      serialNumber: v.optional(v.string()),
      customName: v.optional(v.string()),
      status: v.optional(enums.AssetStatus),
      condition: v.optional(enums.AssetCondition),
      purchaseDate: v.optional(v.number()),
      purchasePrice: v.optional(v.number()),
      purchaseSupplier: v.optional(v.string()),
      supplierId: v.optional(v.string()),
      purchaseOrderNumber: v.optional(v.string()),
      supplierOrderId: v.optional(v.string()),
      warrantyExpiry: v.optional(v.number()),
      notes: v.optional(v.string()),
      locationId: v.optional(v.string()),
      customFieldValues: v.optional(v.any()),
      lastTestAndTagDate: v.optional(v.number()),
      nextTestAndTagDate: v.optional(v.number()),
      barcode: v.optional(v.string()),
      qrCode: v.optional(v.string()),
      images: v.optional(v.array(v.string())),
      tags: v.optional(v.array(v.string())),
      isActive: v.optional(v.boolean()),
      createdAt: v.optional(v.number()),
      updatedAt: v.optional(v.number()),
      kitId: v.optional(v.string()),
      parentAssetId: v.optional(v.string()),
    }),
  },
  handler: async (ctx, { id, patch }) => {
    await requireService(ctx);
    const doc = await ctx.db.query("assets").withIndex("by_cuid", (q) => q.eq("id", id)).unique();
    if (!doc) throw new ConvexError("assets not found: " + id);
    const safePatch = { ...patch };
    delete safePatch.organizationId;
    await ctx.db.patch(doc._id, safePatch);
    await stampLocationMovement(ctx, doc.organizationId, doc.locationId, safePatch.locationId, safePatch.updatedAt ?? Date.now());
    await bumpCountersForTable(ctx, "assets", doc, { ...doc, ...safePatch });
    return doc._id;
  },
});

export const remove = mutation({
  args: { id: v.string() },
  handler: async (ctx, { id }) => {
    await requireService(ctx);
    const doc = await ctx.db.query("assets").withIndex("by_cuid", (q) => q.eq("id", id)).unique();
    if (!doc) throw new ConvexError("assets not found: " + id);
    await ctx.db.delete(doc._id);
    await bumpCountersForTable(ctx, "assets", doc, null);
  },
});

// ─────────────────────────────────────────────────────────────────────────────
// ── CUSTOM (Phase C — core mega-flip) — re-add on regen ──────────────────────
// ─────────────────────────────────────────────────────────────────────────────

const ASSET_NEVER_CLEAR = new Set(["id", "organizationId", "modelId", "assetTag"]);

// Patchable asset fields (= update.patch minus organizationId). Reused by
// patchAsset + bulkUpdate so the clear-to-null pattern stays consistent.
const assetSet = v.object({
  modelId: v.optional(v.string()),
  assetTag: v.optional(v.string()),
  serialNumber: v.optional(v.string()),
  customName: v.optional(v.string()),
  status: v.optional(enums.AssetStatus),
  condition: v.optional(enums.AssetCondition),
  purchaseDate: v.optional(v.number()),
  purchasePrice: v.optional(v.number()),
  purchaseSupplier: v.optional(v.string()),
  supplierId: v.optional(v.string()),
  purchaseOrderNumber: v.optional(v.string()),
  supplierOrderId: v.optional(v.string()),
  warrantyExpiry: v.optional(v.number()),
  notes: v.optional(v.string()),
  locationId: v.optional(v.string()),
  customFieldValues: v.optional(v.any()),
  lastTestAndTagDate: v.optional(v.number()),
  nextTestAndTagDate: v.optional(v.number()),
  barcode: v.optional(v.string()),
  qrCode: v.optional(v.string()),
  images: v.optional(v.array(v.string())),
  tags: v.optional(v.array(v.string())),
  isActive: v.optional(v.boolean()),
  createdAt: v.optional(v.number()),
  updatedAt: v.optional(v.number()),
  kitId: v.optional(v.string()),
  parentAssetId: v.optional(v.string()),
});

/**
 * Clear-to-null patch (crewMembers.patchMember pattern): `set` applies values,
 * every name in `clear[]` is removed from the doc. Needed because the generated
 * `update` can't unset an optional field (e.g. clear kitId on kit removal, clear
 * locationId, unlink parentAssetId/supplierId).
 */
export const patchAsset = mutation({
  args: { id: v.string(), set: assetSet, clear: v.array(v.string()) },
  handler: async (ctx, { id, set, clear }) => {
    await requireService(ctx);
    const doc = await ctx.db.query("assets").withIndex("by_cuid", (q) => q.eq("id", id)).unique();
    if (!doc) throw new ConvexError("assets not found: " + id);
    await stampLocationMovement(ctx, doc.organizationId, doc.locationId, clear.includes("locationId") ? null : set.locationId, set.updatedAt ?? Date.now());
    if (clear.length === 0) {
      await ctx.db.patch(doc._id, set);
      await bumpCountersForTable(ctx, "assets", doc, { ...doc, ...set });
      return doc._id;
    }
    const { _id, _creationTime, ...rest } = doc;
    const merged: Record<string, unknown> = { ...rest, ...set };
    for (const k of clear) {
      if (ASSET_NEVER_CLEAR.has(k)) continue;
      delete merged[k];
    }
    await ctx.db.replace(doc._id, merged as typeof rest);
    await bumpCountersForTable(ctx, "assets", doc, merged);
    return doc._id;
  },
});

/**
 * Apply the same `set` (+ optional `clear`) to many assets in one transaction —
 * the Convex equivalent of `asset.updateMany` (bulk edit, warehouse force-return
 * → AVAILABLE + location, maintenance hold/release). Cross-org / missing ids are
 * skipped. Returns the count updated.
 */
export const bulkUpdate = mutation({
  args: {
    organizationId: v.string(),
    ids: v.array(v.string()),
    set: assetSet,
    clear: v.optional(v.array(v.string())),
  },
  handler: async (ctx, { organizationId, ids, set, clear }) => {
    await requireService(ctx);
    const cl = clear ?? [];
    let n = 0;
    const moves = new LocationMovements();
    for (const id of ids) {
      const doc = await ctx.db.query("assets").withIndex("by_cuid", (q) => q.eq("id", id)).unique();
      if (!doc || doc.organizationId !== organizationId) continue;
      moves.record(doc.locationId, cl.includes("locationId") ? null : set.locationId);
      if (cl.length === 0) {
        await ctx.db.patch(doc._id, set);
        await bumpCountersForTable(ctx, "assets", doc, { ...doc, ...set });
      } else {
        const { _id, _creationTime, ...rest } = doc;
        const merged: Record<string, unknown> = { ...rest, ...set };
        for (const k of cl) {
          if (ASSET_NEVER_CLEAR.has(k)) continue;
          delete merged[k];
        }
        await ctx.db.replace(doc._id, merged as typeof rest);
        await bumpCountersForTable(ctx, "assets", doc, merged);
      }
      n++;
    }
    await moves.flush(ctx, organizationId, set.updatedAt ?? Date.now());
    return n;
  },
});

/**
 * Bulk APPEND tags to N assets in a SINGLE call (Appendix A invariant — powers
 * the assets bulk-bar "Add tags"). Unlike bulkUpdate (which replaces a field),
 * this unions the supplied tags into each asset's existing `tags` array. Per-row
 * org re-check (by_cuid is GLOBAL). Idempotent: a tag already present is a no-op.
 * Tags don't feed any counter, so no counter bump. Returns the count of
 * org-matched assets processed.
 */
export const bulkAddTags = mutation({
  args: {
    organizationId: v.string(),
    ids: v.array(v.string()),
    tags: v.array(v.string()),
  },
  returns: v.number(),
  handler: async (ctx, { organizationId, ids, tags }) => {
    await requireService(ctx);
    const add = [...new Set(tags.map((t) => t.trim()).filter(Boolean))];
    if (add.length === 0) return 0;
    let n = 0;
    for (const id of ids) {
      const doc = await ctx.db.query("assets").withIndex("by_cuid", (q) => q.eq("id", id)).unique();
      if (!doc || doc.organizationId !== organizationId) continue;
      n++;
      const existing = doc.tags ?? [];
      const merged = [...new Set([...existing, ...add])];
      if (merged.length === existing.length) continue; // all already present
      await ctx.db.patch(doc._id, { tags: merged, updatedAt: Date.now() });
    }
    return n;
  },
});

// ── CUSTOM (Phase C H) — child-asset lookup ──
export const listByParentAssetId = query({
  args: { parentAssetId: v.string(), orgId: v.string() },
  handler: async (ctx, { parentAssetId, orgId }) => {
    await requireOrgReadFor(ctx, orgId, "asset"); // Phase 5 domain slice (#1001)
    const cost = await assetCostGuard(ctx);
    return (await ctx.db.query("assets").withIndex("by_parentAssetId", (q) => q.eq("parentAssetId", parentAssetId)).collect())
      .filter((r) => r.organizationId === orgId).map(cost.row);
  },
});

// ─── agentOps annotations (Phase 5 domain slice, #1001) ──────────────────────
export const agentOps: AgentOpsAnnotations = {
  list: { summary: "List all assets visible to the caller's org.", danger: "low", mcpTier: 1 },
  listPage: { summary: "Filtered, sorted, paginated asset list with model/category/location joins.", danger: "low", mcpTier: 2 },
  rowExtras: { summary: "For a page of asset ids: each asset's next test-and-tag due date and the job it is currently out on.", danger: "low", mcpTier: 3 },
  listGallery: { summary: "Browse an org's whole active asset catalogue (unpaginated, joined + searchable).", danger: "low", mcpTier: 3 },
  registryPhotos: { summary: "Primary-photo URL maps for assets and models in an org.", danger: "low", mcpTier: 3 },
  getById: { summary: "Get one asset by id.", danger: "low", mcpTier: 1 },
  getByAssetTag: { summary: "Look up an asset by its human-readable asset tag.", danger: "low", mcpTier: 1 },
  listByModel: { summary: "List an org's assets belonging to one model.", danger: "low", mcpTier: 2 },
  listByModelIds: { summary: "Batch asset lookup across many models in one call.", danger: "low", mcpTier: 3 },
  listByIds: { summary: "Batch point-read assets by id, scoped to one org.", danger: "low", mcpTier: 3 },
  listByParentAssetId: { summary: "List child assets attached to a parent asset.", danger: "low", mcpTier: 2 },
};
