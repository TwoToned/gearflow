import { v, ConvexError } from "convex/values";
import { query, mutation } from "./_generated/server";
import type { QueryCtx } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
import { requireOrgRead, requireOrgReadDoc, requireOrgReadFor, requireOrgReadDocFor, requireService } from "./lib/auth";
import { isLinkRow } from "./lib/maintenanceRecordAssetKind";
import * as enums from "./lib/validators";

/**
 * Thin CRUD for MaintenanceRecord (Convex table "maintenanceRecords"). GENERATED — Phase 2/5.
 *
 * AUTH (Phase 5, convex/lib/auth.ts): mutations require the trusted backend
 * SERVICE token (service-only mirror/read helpers; the browser-direct write path with RBAC +
 * validation + audit enforced inside Convex lives in the *Writes.ts mutations — see FEATUREDOCS/54). Org-scoped reads
 * accept the service token OR a user token scoped to the same org. Lookups use the
 * cuid (`id`) via by_cuid. See FEATUREDOCS/54.
 */

export const list = query({
  args: { orgId: v.string() },
  handler: async (ctx, { orgId }) => {
    await requireOrgReadFor(ctx, orgId, "maintenance"); // Phase 2 read bootstrap (#998)
    return await ctx.db
      .query("maintenanceRecords")
      .withIndex("by_organizationId", (q) => q.eq("organizationId", orgId)) // r9.8-ok: reactive/full-org read (perf design); reviewed, accepted R-9.8 tradeoff — revisit with pagination if per-org rows grow large
      .collect();
  },
});

export const getById = query({
  args: { id: v.string() },
  handler: async (ctx, { id }) => {
    const doc = await ctx.db.query("maintenanceRecords").withIndex("by_cuid", (q) => q.eq("id", id)).unique();
    await requireOrgReadDocFor(ctx, doc, "maintenance"); // Phase 2 read bootstrap (#998)
    return doc;
  },
});

export const create = mutation({
  args: {
    id: v.string(),
    organizationId: v.string(),
    kitId: v.optional(v.string()),
    projectId: v.optional(v.string()),
    type: enums.MaintenanceType,
    status: v.optional(enums.MaintenanceStatus),
    title: v.string(),
    description: v.optional(v.string()),
    reportedById: v.optional(v.string()),
    assignedToId: v.optional(v.string()),
    scheduledDate: v.optional(v.number()),
    completedDate: v.optional(v.number()),
    cost: v.optional(v.number()),
    partsUsed: v.optional(v.string()),
    attachments: v.optional(v.array(v.string())),
    photos: v.optional(v.array(v.string())),
    result: v.optional(enums.MaintenanceResult),
    nextDueDate: v.optional(v.number()),
    tags: v.optional(v.array(v.string())),
    createdAt: v.optional(v.number()),
    updatedAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await requireService(ctx);
    return await ctx.db.insert("maintenanceRecords", args);
  },
});

export const createIfMissing = mutation({
  args: {
    id: v.string(),
    organizationId: v.string(),
    kitId: v.optional(v.string()),
    projectId: v.optional(v.string()),
    type: enums.MaintenanceType,
    status: v.optional(enums.MaintenanceStatus),
    title: v.string(),
    description: v.optional(v.string()),
    reportedById: v.optional(v.string()),
    assignedToId: v.optional(v.string()),
    scheduledDate: v.optional(v.number()),
    completedDate: v.optional(v.number()),
    cost: v.optional(v.number()),
    partsUsed: v.optional(v.string()),
    attachments: v.optional(v.array(v.string())),
    photos: v.optional(v.array(v.string())),
    result: v.optional(enums.MaintenanceResult),
    nextDueDate: v.optional(v.number()),
    tags: v.optional(v.array(v.string())),
    createdAt: v.optional(v.number()),
    updatedAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await requireService(ctx);
    const existing = await ctx.db.query("maintenanceRecords").withIndex("by_cuid", (q) => q.eq("id", args.id)).unique();
    if (existing) return { _id: existing._id, created: false };
    const _id = await ctx.db.insert("maintenanceRecords", args);
    return { _id, created: true };
  },
});

export const update = mutation({
  args: {
    id: v.string(),
    patch: v.object({
      organizationId: v.optional(v.string()),
      kitId: v.optional(v.string()),
      projectId: v.optional(v.string()),
      type: v.optional(enums.MaintenanceType),
      status: v.optional(enums.MaintenanceStatus),
      title: v.optional(v.string()),
      description: v.optional(v.string()),
      reportedById: v.optional(v.string()),
      assignedToId: v.optional(v.string()),
      scheduledDate: v.optional(v.number()),
      completedDate: v.optional(v.number()),
      cost: v.optional(v.number()),
      partsUsed: v.optional(v.string()),
      attachments: v.optional(v.array(v.string())),
      photos: v.optional(v.array(v.string())),
      result: v.optional(enums.MaintenanceResult),
      nextDueDate: v.optional(v.number()),
      tags: v.optional(v.array(v.string())),
      createdAt: v.optional(v.number()),
      updatedAt: v.optional(v.number()),
    }),
  },
  handler: async (ctx, { id, patch }) => {
    await requireService(ctx);
    const doc = await ctx.db.query("maintenanceRecords").withIndex("by_cuid", (q) => q.eq("id", id)).unique();
    if (!doc) throw new ConvexError("maintenanceRecords not found: " + id);
    const safePatch = { ...patch };
    delete safePatch.organizationId;
    await ctx.db.patch(doc._id, safePatch);
    return doc._id;
  },
});

export const remove = mutation({
  args: { id: v.string() },
  handler: async (ctx, { id }) => {
    await requireService(ctx);
    const doc = await ctx.db.query("maintenanceRecords").withIndex("by_cuid", (q) => q.eq("id", id)).unique();
    if (!doc) throw new ConvexError("maintenanceRecords not found: " + id);
    await ctx.db.delete(doc._id);
  },
});

// ─── CUSTOM (Phase C) ───────────────────────────────────────────────────────

/**
 * Scrub a deleted Better Auth user's FK references from an org's maintenance
 * records. Re-implements the Prisma `updateMany({ reportedById|assignedToId:
 * userId } → null)` the user-delete sweep used to run against the (now dead)
 * Postgres `maintenance_record` table. For each record where `reportedById` or
 * `assignedToId` equals `userId`, patch the matching field to `undefined`
 * (Convex `db.patch` with a field = `undefined` deletes it → clears to null);
 * the non-matching field is left untouched.
 */
export const scrubUserRefs = mutation({
  args: { organizationId: v.string(), userId: v.string() },
  handler: async (ctx, { organizationId, userId }) => {
    await requireService(ctx);
    const docs = await ctx.db
      .query("maintenanceRecords")
      .withIndex("by_organizationId", (q) => q.eq("organizationId", organizationId)) // r9.8-ok: reviewed, accepted R-9.8 tradeoff over the org set (aggregation/enrichment) — see docs/exceptions.md R-8.3.3
      .collect();
    let scrubbed = 0;
    for (const doc of docs) {
      const matchReported = doc.reportedById === userId;
      const matchAssigned = doc.assignedToId === userId;
      if (!matchReported && !matchAssigned) continue;
      const patch: { reportedById?: undefined; assignedToId?: undefined } = {};
      if (matchReported) patch.reportedById = undefined;
      if (matchAssigned) patch.assignedToId = undefined;
      await ctx.db.patch(doc._id, patch);
      scrubbed += 1;
    }
    return { scrubbed };
  },
});

// ─── Browser-direct READS (Phase 3 — re-home of src/server/maintenance.ts) ───
//
// `getMaintenanceRecords` / `getMaintenanceRecord` / `getAssetsForMaintenanceSelect`
// moved off the server action onto these org-scoped native queries. They resolve
// everything from Convex: the maintenanceRecordAssets links, the asset scalars +
// model name, and the reportedBy/assignedTo NAMES from the `users` mirror (name or
// null, NEVER the raw id — the read-parity lesson). Dates are returned as ISO
// strings to match the old `serialize()` output the consumers already parse.

/** epoch-ms → ISO string, treating absent/null as null (matches serialize()). */
function toIso(ms: number | null | undefined): string | null {
  return ms === null || ms === undefined ? null : new Date(ms).toISOString();
}

type EnrichedAssetLink = {
  id: string;
  assetId: string;
  asset: {
    id: string;
    assetTag: string;
    customName: string | null;
    model: { name: string };
  } | null;
};

/**
 * Build the enriched asset-link objects for a record (sorted by asset tag asc, to
 * mirror the old include orderBy). Reuses caller-provided asset/model maps so the
 * list read batches its reads across the whole result set.
 *
 * Filters to LINK rows only (`isLinkRow`) — `maintenanceRecordAssets` is
 * polymorphic (WS6 #945): a CHECKOFF progress row sharing this record's id is
 * never a "linked asset" for display purposes.
 */
function buildLinks(
  recordLinks: Doc<"maintenanceRecordAssets">[],
  assetMap: Map<string, Doc<"assets">>,
  modelMap: Map<string, Doc<"models">>,
): EnrichedAssetLink[] {
  return recordLinks
    .filter(isLinkRow)
    .map((l) => {
      const assetId = l.assetId as string; // isLinkRow guarantees this is set
      const asset = assetMap.get(assetId) ?? null;
      const model = asset?.modelId ? modelMap.get(asset.modelId) ?? null : null;
      return {
        id: l.id,
        assetId,
        asset: asset
          ? {
              id: asset.id,
              assetTag: asset.assetTag,
              customName: asset.customName ?? null,
              model: { name: model?.name ?? "" },
            }
          : null,
      };
    })
    .sort((x, y) => {
      const tx = x.asset?.assetTag ?? "";
      const ty = y.asset?.assetTag ?? "";
      return tx < ty ? -1 : tx > ty ? 1 : 0;
    });
}

/** Resolve a user's display name from the mirror (name or null — never the id). */
async function userName(
  ctx: QueryCtx,
  orgId: string,
  userId: string | null | undefined,
  cache: Map<string, string | null>,
): Promise<{ id: string; name: string | null } | null> {
  if (!userId) return null;
  if (!cache.has(userId)) {
    const u = await ctx.db.query("users").withIndex("by_cuid", (q) => q.eq("id", userId)).first();
    cache.set(userId, u?.name ?? null);
  }
  return { id: userId, name: cache.get(userId) ?? null };
}

function mapScalars(doc: Doc<"maintenanceRecords">) {
  return {
    id: doc.id,
    organizationId: doc.organizationId,
    kitId: doc.kitId ?? null,
    projectId: doc.projectId ?? null,
    type: doc.type,
    status: doc.status ?? "SCHEDULED",
    title: doc.title,
    description: doc.description ?? null,
    reportedById: doc.reportedById ?? null,
    assignedToId: doc.assignedToId ?? null,
    scheduledDate: toIso(doc.scheduledDate),
    completedDate: toIso(doc.completedDate),
    cost: doc.cost ?? null,
    partsUsed: doc.partsUsed ?? null,
    attachments: doc.attachments ?? [],
    photos: doc.photos ?? [],
    result: doc.result ?? null,
    nextDueDate: toIso(doc.nextDueDate),
    tags: doc.tags ?? [],
    createdAt: toIso(doc.createdAt) ?? new Date(doc._creationTime).toISOString(),
    updatedAt: toIso(doc.updatedAt) ?? new Date(doc._creationTime).toISOString(),
  };
}

const STATUS_RANK: Record<string, number> = {
  SCHEDULED: 0,
  AWAITING_PARTS: 1,
  IN_PROGRESS: 2,
  QA: 3,
  COMPLETED: 4,
  CANCELLED: 5,
};
const TYPE_RANK: Record<string, number> = {
  REPAIR: 0,
  PREVENTATIVE: 1,
  TEST_AND_TAG: 2,
  INSPECTION: 3,
  CLEANING: 4,
  FIRMWARE_UPDATE: 5,
};
const RESULT_RANK: Record<string, number> = { PASS: 0, FAIL: 1, CONDITIONAL: 2 };

function cmpNullable(
  a: number | string | null,
  b: number | string | null,
  dir: "asc" | "desc",
): number {
  if (a === null && b === null) return 0;
  if (a === null) return dir === "asc" ? 1 : -1; // NULLS LAST asc / FIRST desc
  if (b === null) return dir === "asc" ? -1 : 1;
  let base: number;
  if (typeof a === "string" && typeof b === "string") base = a < b ? -1 : a > b ? 1 : 0;
  else base = (a as number) - (b as number);
  return dir === "asc" ? base : -base;
}

/**
 * Paginated + filtered + sorted maintenance list (re-home of the server
 * `getMaintenanceRecords`). Org-scoped; the search OR matches title/description +
 * linked asset tags + model names, so it batches the whole org's links/assets/models
 * to filter, then enriches only the page slice. Dates are ISO strings.
 */
export const recordsPage = query({
  args: {
    orgId: v.string(),
    search: v.optional(v.string()),
    status: v.optional(v.string()),
    type: v.optional(v.string()),
    assetId: v.optional(v.string()),
    page: v.optional(v.number()),
    pageSize: v.optional(v.number()),
    sortBy: v.optional(v.string()),
    sortOrder: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await requireOrgRead(ctx, args.orgId);
    const page = args.page ?? 1;
    const pageSize = args.pageSize ?? 25;
    const dir: "asc" | "desc" = args.sortOrder === "desc" ? "desc" : "asc";

    const records = await ctx.db
      .query("maintenanceRecords")
      .withIndex("by_organizationId", (q) => q.eq("organizationId", args.orgId)) // r9.8-ok: server-side filter/sort/paginate over the org set (perf design); accepted R-9.8 tradeoff
      .collect();

    // Batch links → assets → models for the whole org set (mirrors attachJoins).
    const linksByRecord = new Map<string, Doc<"maintenanceRecordAssets">[]>();
    const assetIds = new Set<string>();
    for (const r of records) {
      // WS6 #945: maintenanceRecordAssets is polymorphic — filter out CHECKOFF
      // progress rows so they never masquerade as "linked assets" here.
      const rls = (
        await ctx.db
          .query("maintenanceRecordAssets")
          .withIndex("by_maintenanceRecordId", (q) => q.eq("maintenanceRecordId", r.id))
          .collect()
      ).filter(isLinkRow);
      linksByRecord.set(r.id, rls);
      for (const l of rls) assetIds.add(l.assetId!);
    }
    const assetMap = new Map<string, Doc<"assets">>();
    const modelIds = new Set<string>();
    for (const id of assetIds) {
      const a = await ctx.db.query("assets").withIndex("by_cuid", (q) => q.eq("id", id)).unique();
      if (a && a.organizationId === args.orgId) {
        assetMap.set(id, a);
        if (a.modelId) modelIds.add(a.modelId);
      }
    }
    const modelMap = new Map<string, Doc<"models">>();
    for (const id of modelIds) {
      const m = await ctx.db.query("models").withIndex("by_cuid", (q) => q.eq("id", id)).unique();
      if (m && m.organizationId === args.orgId) modelMap.set(id, m);
    }

    // Per-record join data used by the filter + the asset-id filter.
    const joinData = new Map<string, { assetIds: string[]; assetTags: string[]; modelNames: string[] }>();
    for (const r of records) {
      const jd = { assetIds: [] as string[], assetTags: [] as string[], modelNames: [] as string[] };
      for (const l of linksByRecord.get(r.id) ?? []) {
        jd.assetIds.push(l.assetId!);
        const asset = assetMap.get(l.assetId!);
        if (asset?.assetTag) jd.assetTags.push(asset.assetTag);
        const model = asset?.modelId ? modelMap.get(asset.modelId) : null;
        if (model?.name) jd.modelNames.push(model.name);
      }
      joinData.set(r.id, jd);
    }

    const needle = args.search?.toLowerCase();
    const filtered = records.filter((r) => {
      if (args.status && statusFilterFails(r, args.status)) return false;
      if (args.type && r.type !== args.type) return false;
      const jd = joinData.get(r.id) ?? { assetIds: [], assetTags: [], modelNames: [] };
      if (args.assetId && !jd.assetIds.includes(args.assetId)) return false;
      if (needle) {
        const hit =
          r.title.toLowerCase().includes(needle) ||
          (r.description ?? "").toLowerCase().includes(needle) ||
          jd.assetTags.some((t) => t.toLowerCase().includes(needle)) ||
          jd.modelNames.some((n) => n.toLowerCase().includes(needle));
        if (!hit) return false;
      }
      return true;
    });

    const keyOf = (r: Doc<"maintenanceRecords">, key: string): number | string | null => {
      switch (key) {
        case "status": return STATUS_RANK[r.status ?? "SCHEDULED"] ?? Number.MAX_SAFE_INTEGER;
        case "type": return TYPE_RANK[r.type] ?? Number.MAX_SAFE_INTEGER;
        case "result": return r.result == null ? null : RESULT_RANK[r.result] ?? Number.MAX_SAFE_INTEGER;
        case "title": return r.title;
        case "scheduledDate": return r.scheduledDate ?? null;
        case "completedDate": return r.completedDate ?? null;
        case "nextDueDate": return r.nextDueDate ?? null;
        case "createdAt": return r.createdAt ?? r._creationTime;
        case "updatedAt": return r.updatedAt ?? r._creationTime;
        case "cost": return r.cost ?? null;
        default: return r.createdAt ?? r._creationTime;
      }
    };
    const sorted = [...filtered];
    if (args.sortBy) {
      sorted.sort((a, b) => cmpNullable(keyOf(a, args.sortBy!), keyOf(b, args.sortBy!), dir));
    } else {
      sorted.sort((a, b) => {
        const s = cmpNullable(keyOf(a, "status"), keyOf(b, "status"), "asc");
        if (s !== 0) return s;
        return cmpNullable(keyOf(a, "scheduledDate"), keyOf(b, "scheduledDate"), "asc");
      });
    }

    const total = sorted.length;
    const slice = sorted.slice((page - 1) * pageSize, (page - 1) * pageSize + pageSize);

    const userCache = new Map<string, string | null>();
    const enriched = [];
    for (const r of slice) {
      enriched.push({
        ...mapScalars(r),
        assets: buildLinks(linksByRecord.get(r.id) ?? [], assetMap, modelMap),
        reportedBy: await userName(ctx, args.orgId, r.reportedById, userCache),
        assignedTo: await userName(ctx, args.orgId, r.assignedToId, userCache),
      });
    }

    return { records: enriched, total, page, pageSize, totalPages: Math.ceil(total / pageSize) };
  },
});

/** Postgres-enum status filter helper (kept trivial; extracted for readability). */
function statusFilterFails(r: Doc<"maintenanceRecords">, status: string): boolean {
  return (r.status ?? "SCHEDULED") !== status;
}

/**
 * Single maintenance record with joins (re-home of the server
 * `getMaintenanceRecord`). Org-scoped via a per-row re-check; returns null when the
 * record is absent or belongs to another org.
 */
export const recordDetail = query({
  args: { orgId: v.string(), id: v.string() },
  handler: async (ctx, { orgId, id }) => {
    await requireOrgRead(ctx, orgId);
    const record = await ctx.db.query("maintenanceRecords").withIndex("by_cuid", (q) => q.eq("id", id)).unique();
    if (!record || record.organizationId !== orgId) return null;

    // WS6 #945: maintenanceRecordAssets is polymorphic — filter out CHECKOFF
    // progress rows so they never masquerade as "linked assets" here.
    const links = (
      await ctx.db
        .query("maintenanceRecordAssets")
        .withIndex("by_maintenanceRecordId", (q) => q.eq("maintenanceRecordId", id))
        .collect()
    ).filter(isLinkRow);
    const assetMap = new Map<string, Doc<"assets">>();
    const modelMap = new Map<string, Doc<"models">>();
    for (const l of links) {
      const assetId = l.assetId!;
      const a = await ctx.db.query("assets").withIndex("by_cuid", (q) => q.eq("id", assetId)).unique();
      if (a && a.organizationId === orgId) {
        assetMap.set(assetId, a);
        if (a.modelId && !modelMap.has(a.modelId)) {
          const m = await ctx.db.query("models").withIndex("by_cuid", (q) => q.eq("id", a.modelId)).unique();
          if (m && m.organizationId === orgId) modelMap.set(a.modelId, m);
        }
      }
    }

    const userCache = new Map<string, string | null>();
    return {
      ...mapScalars(record),
      assets: buildLinks(links, assetMap, modelMap),
      reportedBy: await userName(ctx, orgId, record.reportedById, userCache),
      assignedTo: await userName(ctx, orgId, record.assignedToId, userCache),
    };
  },
});

/**
 * Active-asset picker for the maintenance form (re-home of
 * `getAssetsForMaintenanceSelect`). Returns `{ id, label }` sorted by asset tag,
 * label = `TAG — Model (customName)`.
 */
export const assetsForSelect = query({
  args: { orgId: v.string() },
  handler: async (ctx, { orgId }) => {
    await requireOrgRead(ctx, orgId);
    const assets = (
      await ctx.db.query("assets").withIndex("by_organizationId", (q) => q.eq("organizationId", orgId)).collect() // r9.8-ok: picker: scans the org set for candidates — accepted, revisit with a narrower index if large
    )
      .filter((a) => a.isActive !== false)
      .sort((a, b) => a.assetTag.localeCompare(b.assetTag));

    const modelMap = new Map<string, string>();
    const out: { id: string; label: string }[] = [];
    for (const a of assets) {
      if (a.modelId && !modelMap.has(a.modelId)) {
        const m = await ctx.db.query("models").withIndex("by_cuid", (q) => q.eq("id", a.modelId)).unique();
        modelMap.set(a.modelId, m && m.organizationId === orgId ? m.name : "");
      }
      const modelName = a.modelId ? modelMap.get(a.modelId) ?? "" : "";
      out.push({
        id: a.id,
        label: `${a.assetTag} — ${modelName}${a.customName ? ` (${a.customName})` : ""}`,
      });
    }
    return out;
  },
});
