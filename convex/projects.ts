import { v, ConvexError } from "convex/values";
import { query, mutation } from "./_generated/server";
import { requireOrgRead, requireOrgReadDoc, requireService } from "./lib/auth";
import { bumpCountersForTable } from "./lib/counters";
import { matchesSearch, compareValues, paginateItems } from "./lib/listQuery";
import * as enums from "./lib/validators";

/**
 * Thin CRUD for Project (Convex table "projects"). GENERATED — Phase 2/5.
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
    await requireOrgRead(ctx, orgId);
    return await ctx.db
      .query("projects")
      .withIndex("by_organizationId", (q) => q.eq("organizationId", orgId))
      .collect();
  },
});

export const getById = query({
  args: { id: v.string() },
  handler: async (ctx, { id }) => {
    const doc = await ctx.db.query("projects").withIndex("by_cuid", (q) => q.eq("id", id)).unique();
    await requireOrgReadDoc(ctx, doc);
    return doc;
  },
});

/**
 * Paginated PROJECT list — browser-native replacement for ProjectTable's
 * useProjects/useClients/useLocations whole-org live subscriptions +
 * client-side filter/sort/paginate (Finding #1, docs/designs/
 * perf-convex-efficiency-2026-06.md). Templates are always excluded (matches
 * the old `.filter(p => !p.isTemplate)`). `client` is resolved server-side
 * (name only, matching the row shape ProjectTable's columns read); location
 * is only used to widen the search match (no location column exists), so it
 * isn't attached to the row.
 */
export const listPage = query({
  args: {
    orgId: v.string(),
    search: v.optional(v.string()),
    statusIn: v.optional(v.array(v.string())),
    typeIn: v.optional(v.array(v.string())),
    page: v.optional(v.number()),
    pageSize: v.optional(v.number()),
    sortBy: v.optional(v.string()),
    sortOrder: v.optional(v.union(v.literal("asc"), v.literal("desc"))),
  },
  handler: async (ctx, a) => {
    await requireOrgRead(ctx, a.orgId);
    const page = a.page ?? 1;
    const pageSize = a.pageSize ?? 25;
    const sortBy = a.sortBy ?? "rentalStartDate";
    const dir: 1 | -1 = a.sortOrder === "desc" ? -1 : 1;

    const [rows, clients, locations] = await Promise.all([
      ctx.db.query("projects").withIndex("by_organizationId", (q) => q.eq("organizationId", a.orgId)).collect(),
      ctx.db.query("clients").withIndex("by_organizationId", (q) => q.eq("organizationId", a.orgId)).collect(),
      ctx.db.query("locations").withIndex("by_organizationId", (q) => q.eq("organizationId", a.orgId)).collect(),
    ]);
    const clientMap = new Map(clients.map((c) => [c.id, c]));
    const locationMap = new Map(locations.map((l) => [l.id, l]));
    const clientNameFor = (id: string | null | undefined) => (id ? clientMap.get(id)?.name : undefined);
    const locationNameFor = (id: string | null | undefined) => (id ? locationMap.get(id)?.name : undefined);

    const filtered = rows.filter((p) => {
      if (p.isTemplate) return false;
      if (a.statusIn && a.statusIn.length > 0 && !(p.status && a.statusIn.includes(p.status))) return false;
      if (a.typeIn && a.typeIn.length > 0 && !(p.type && a.typeIn.includes(p.type))) return false;
      if (a.search && !matchesSearch([p.name, p.projectNumber, locationNameFor(p.locationId)], a.search)) return false;
      return true;
    });

    const keyFn = (p: typeof rows[number]): unknown => {
      if (sortBy === "client") return clientNameFor(p.clientId);
      return (p as unknown as Record<string, unknown>)[sortBy];
    };
    const sorted = [...filtered].sort((x, y) => compareValues(keyFn(x), keyFn(y), dir));
    const { items: pageRows, total, totalPages } = paginateItems(sorted, page, pageSize);

    const items = pageRows.map((p) => ({
      ...p,
      client: p.clientId ? { name: clientNameFor(p.clientId) ?? null } : null,
    }));

    return { items, total, page, pageSize, totalPages };
  },
});

/**
 * Batch point-read projects by cuid, scoped to one org. Lets a detail composite
 * attach projects to its line-items / scan-logs by id instead of collecting every
 * project in the org (getProjectsByOrg) just to build a lookup map. Cross-org ids
 * dropped. Does NOT exclude templates — callers that need that filter on the result.
 */
export const listByIds = query({
  args: { orgId: v.string(), ids: v.array(v.string()) },
  handler: async (ctx, { orgId, ids }) => {
    await requireOrgRead(ctx, orgId);
    const unique = [...new Set(ids)];
    if (unique.length > 1000) throw new ConvexError("projects.listByIds: too many ids (max 1000)");
    const docs = await Promise.all(
      unique.map((id) => ctx.db.query("projects").withIndex("by_cuid", (q) => q.eq("id", id)).unique()),
    );
    return docs.filter((d): d is NonNullable<typeof d> => d !== null && d.organizationId === orgId);
  },
});

export const create = mutation({
  args: {
    id: v.string(),
    organizationId: v.string(),
    projectNumber: v.string(),
    name: v.string(),
    clientId: v.optional(v.string()),
    status: v.optional(enums.ProjectStatus),
    type: v.optional(enums.ProjectType),
    description: v.optional(v.string()),
    locationId: v.optional(v.string()),
    siteContactName: v.optional(v.string()),
    siteContactPhone: v.optional(v.string()),
    siteContactEmail: v.optional(v.string()),
    loadInDate: v.optional(v.number()),
    loadInTime: v.optional(v.string()),
    eventStartDate: v.optional(v.number()),
    eventStartTime: v.optional(v.string()),
    eventEndDate: v.optional(v.number()),
    eventEndTime: v.optional(v.string()),
    loadOutDate: v.optional(v.number()),
    loadOutTime: v.optional(v.string()),
    rentalStartDate: v.optional(v.number()),
    rentalEndDate: v.optional(v.number()),
    projectManagerId: v.optional(v.string()),
    defaultRentalPeriod: v.optional(enums.RentalPeriod),
    defaultRentalQuantity: v.optional(v.number()),
    taxRate: v.optional(v.number()),
    equipmentRevenue: v.optional(v.number()),
    serviceCostTotal: v.optional(v.number()),
    labourCostTotal: v.optional(v.number()),
    subHireCostTotal: v.optional(v.number()),
    margin: v.optional(v.number()),
    crewNotes: v.optional(v.string()),
    internalNotes: v.optional(v.string()),
    clientNotes: v.optional(v.string()),
    subtotal: v.optional(v.number()),
    discountPercent: v.optional(v.number()),
    discountAmount: v.optional(v.number()),
    taxAmount: v.optional(v.number()),
    total: v.optional(v.number()),
    depositPercent: v.optional(v.number()),
    depositPaid: v.optional(v.number()),
    invoicedTotal: v.optional(v.number()),
    tags: v.optional(v.array(v.string())),
    isTemplate: v.optional(v.boolean()),
    createdAt: v.optional(v.number()),
    updatedAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await requireService(ctx);
    const _id = await ctx.db.insert("projects", args);
    await bumpCountersForTable(ctx, "projects", null, args);
    return _id;
  },
});

export const createIfMissing = mutation({
  args: {
    id: v.string(),
    organizationId: v.string(),
    projectNumber: v.string(),
    name: v.string(),
    clientId: v.optional(v.string()),
    status: v.optional(enums.ProjectStatus),
    type: v.optional(enums.ProjectType),
    description: v.optional(v.string()),
    locationId: v.optional(v.string()),
    siteContactName: v.optional(v.string()),
    siteContactPhone: v.optional(v.string()),
    siteContactEmail: v.optional(v.string()),
    loadInDate: v.optional(v.number()),
    loadInTime: v.optional(v.string()),
    eventStartDate: v.optional(v.number()),
    eventStartTime: v.optional(v.string()),
    eventEndDate: v.optional(v.number()),
    eventEndTime: v.optional(v.string()),
    loadOutDate: v.optional(v.number()),
    loadOutTime: v.optional(v.string()),
    rentalStartDate: v.optional(v.number()),
    rentalEndDate: v.optional(v.number()),
    projectManagerId: v.optional(v.string()),
    defaultRentalPeriod: v.optional(enums.RentalPeriod),
    defaultRentalQuantity: v.optional(v.number()),
    taxRate: v.optional(v.number()),
    equipmentRevenue: v.optional(v.number()),
    serviceCostTotal: v.optional(v.number()),
    labourCostTotal: v.optional(v.number()),
    subHireCostTotal: v.optional(v.number()),
    margin: v.optional(v.number()),
    crewNotes: v.optional(v.string()),
    internalNotes: v.optional(v.string()),
    clientNotes: v.optional(v.string()),
    subtotal: v.optional(v.number()),
    discountPercent: v.optional(v.number()),
    discountAmount: v.optional(v.number()),
    taxAmount: v.optional(v.number()),
    total: v.optional(v.number()),
    depositPercent: v.optional(v.number()),
    depositPaid: v.optional(v.number()),
    invoicedTotal: v.optional(v.number()),
    tags: v.optional(v.array(v.string())),
    isTemplate: v.optional(v.boolean()),
    createdAt: v.optional(v.number()),
    updatedAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await requireService(ctx);
    const existing = await ctx.db.query("projects").withIndex("by_cuid", (q) => q.eq("id", args.id)).unique();
    if (existing) return { _id: existing._id, created: false };
    const _id = await ctx.db.insert("projects", args);
    await bumpCountersForTable(ctx, "projects", null, args);
    return { _id, created: true };
  },
});

export const update = mutation({
  args: {
    id: v.string(),
    patch: v.object({
      organizationId: v.optional(v.string()),
      projectNumber: v.optional(v.string()),
      name: v.optional(v.string()),
      clientId: v.optional(v.string()),
      status: v.optional(enums.ProjectStatus),
      type: v.optional(enums.ProjectType),
      description: v.optional(v.string()),
      locationId: v.optional(v.string()),
      siteContactName: v.optional(v.string()),
      siteContactPhone: v.optional(v.string()),
      siteContactEmail: v.optional(v.string()),
      loadInDate: v.optional(v.number()),
      loadInTime: v.optional(v.string()),
      eventStartDate: v.optional(v.number()),
      eventStartTime: v.optional(v.string()),
      eventEndDate: v.optional(v.number()),
      eventEndTime: v.optional(v.string()),
      loadOutDate: v.optional(v.number()),
      loadOutTime: v.optional(v.string()),
      rentalStartDate: v.optional(v.number()),
      rentalEndDate: v.optional(v.number()),
      projectManagerId: v.optional(v.string()),
      defaultRentalPeriod: v.optional(enums.RentalPeriod),
      defaultRentalQuantity: v.optional(v.number()),
      taxRate: v.optional(v.number()),
      equipmentRevenue: v.optional(v.number()),
      serviceCostTotal: v.optional(v.number()),
      labourCostTotal: v.optional(v.number()),
      subHireCostTotal: v.optional(v.number()),
      margin: v.optional(v.number()),
      crewNotes: v.optional(v.string()),
      internalNotes: v.optional(v.string()),
      clientNotes: v.optional(v.string()),
      subtotal: v.optional(v.number()),
      discountPercent: v.optional(v.number()),
      discountAmount: v.optional(v.number()),
      taxAmount: v.optional(v.number()),
      total: v.optional(v.number()),
      depositPercent: v.optional(v.number()),
      depositPaid: v.optional(v.number()),
      invoicedTotal: v.optional(v.number()),
      tags: v.optional(v.array(v.string())),
      isTemplate: v.optional(v.boolean()),
      createdAt: v.optional(v.number()),
      updatedAt: v.optional(v.number()),
    }),
  },
  handler: async (ctx, { id, patch }) => {
    await requireService(ctx);
    const doc = await ctx.db.query("projects").withIndex("by_cuid", (q) => q.eq("id", id)).unique();
    if (!doc) throw new ConvexError("projects not found: " + id);
    const safePatch = { ...patch };
    delete safePatch.organizationId;
    await ctx.db.patch(doc._id, safePatch);
    await bumpCountersForTable(ctx, "projects", doc, { ...doc, ...safePatch });
    return doc._id;
  },
});

export const remove = mutation({
  args: { id: v.string() },
  handler: async (ctx, { id }) => {
    await requireService(ctx);
    const doc = await ctx.db.query("projects").withIndex("by_cuid", (q) => q.eq("id", id)).unique();
    if (!doc) throw new ConvexError("projects not found: " + id);
    // The revenue rollup is a Convex-only cache with no FK to cascade through. ROI
    // queries already skip rows whose project is gone, so this is hygiene rather
    // than correctness — but one orphan per model per deleted project adds up.
    const rollups = await ctx.db
      .query("projectModelRevenues")
      .withIndex("by_projectId", (q) => q.eq("projectId", id))
      .collect();
    for (const r of rollups) await ctx.db.delete(r._id);
    await ctx.db.delete(doc._id);
    await bumpCountersForTable(ctx, "projects", doc, null);
  },
});

// ─── CUSTOM (project keystone write-inversion, Phase C) ───

export const projectWriteFields = {
  clientId: v.optional(v.string()),
  status: v.optional(enums.ProjectStatus),
  type: v.optional(enums.ProjectType),
  description: v.optional(v.string()),
  locationId: v.optional(v.string()),
  siteContactName: v.optional(v.string()),
  siteContactPhone: v.optional(v.string()),
  siteContactEmail: v.optional(v.string()),
  loadInDate: v.optional(v.number()),
  loadInTime: v.optional(v.string()),
  eventStartDate: v.optional(v.number()),
  eventStartTime: v.optional(v.string()),
  eventEndDate: v.optional(v.number()),
  eventEndTime: v.optional(v.string()),
  loadOutDate: v.optional(v.number()),
  loadOutTime: v.optional(v.string()),
  rentalStartDate: v.optional(v.number()),
  rentalEndDate: v.optional(v.number()),
  projectManagerId: v.optional(v.string()),
  defaultRentalPeriod: v.optional(enums.RentalPeriod),
  defaultRentalQuantity: v.optional(v.number()),
  taxRate: v.optional(v.number()),
  equipmentRevenue: v.optional(v.number()),
  serviceCostTotal: v.optional(v.number()),
  labourCostTotal: v.optional(v.number()),
  subHireCostTotal: v.optional(v.number()),
  margin: v.optional(v.number()),
  crewNotes: v.optional(v.string()),
  internalNotes: v.optional(v.string()),
  clientNotes: v.optional(v.string()),
  subtotal: v.optional(v.number()),
  discountPercent: v.optional(v.number()),
  discountAmount: v.optional(v.number()),
  taxAmount: v.optional(v.number()),
  total: v.optional(v.number()),
  depositPercent: v.optional(v.number()),
  depositPaid: v.optional(v.number()),
  invoicedTotal: v.optional(v.number()),
  tags: v.optional(v.array(v.string())),
  isTemplate: v.optional(v.boolean()),
  createdAt: v.optional(v.number()),
  updatedAt: v.optional(v.number()),
};

/** Look up a project by its org-scoped project number (the @@unique guard). */
export const getByOrgAndNumber = query({
  args: { organizationId: v.string(), projectNumber: v.string() },
  handler: async (ctx, { organizationId, projectNumber }) => {
    return await ctx.db
      .query("projects")
      .withIndex("by_organizationId_projectNumber", (q) =>
        q.eq("organizationId", organizationId).eq("projectNumber", projectNumber),
      )
      .unique();
  },
});

/**
 * Create a project, enforcing the `@@unique([organizationId, projectNumber])`
 * invariant Convex can't express as an index constraint. Serializable check-then-
 * insert on by_organizationId_projectNumber — a concurrent insert of the same number
 * conflicts on the read range and retries. Returns `{ created }` — false (no insert)
 * if the number is already taken, so the action can bump + retry.
 */
export const createWithUniqueNumber = mutation({
  args: {
    id: v.string(),
    organizationId: v.string(),
    projectNumber: v.string(),
    name: v.string(),
    ...projectWriteFields,
  },
  handler: async (ctx, args) => {
    await requireService(ctx);
    const clash = await ctx.db
      .query("projects")
      .withIndex("by_organizationId_projectNumber", (q) =>
        q.eq("organizationId", args.organizationId).eq("projectNumber", args.projectNumber),
      )
      .unique();
    if (clash) return { created: false, id: clash.id };
    await ctx.db.insert("projects", args);
    await bumpCountersForTable(ctx, "projects", null, args);
    return { created: true, id: args.id };
  },
});

/**
 * Patch a project with explicit field clears (clientId / locationId /
 * projectManagerId / dates / financials → unset). The generated `update` can't
 * clear, because the action's `toConvexDoc` drops nulls before the wire.
 */
export const patchProject = mutation({
  args: {
    id: v.string(),
    set: v.object({ name: v.optional(v.string()), projectNumber: v.optional(v.string()), ...projectWriteFields }),
    clear: v.optional(v.array(v.string())),
  },
  handler: async (ctx, { id, set, clear }) => {
    await requireService(ctx);
    const doc = await ctx.db.query("projects").withIndex("by_cuid", (q) => q.eq("id", id)).unique();
    if (!doc) throw new ConvexError("projects not found: " + id);
    const patch: Record<string, unknown> = { ...set };
    for (const k of clear ?? []) patch[k] = undefined;
    await ctx.db.patch(doc._id, patch);
    await bumpCountersForTable(ctx, "projects", doc, { ...doc, ...patch });
    return doc._id;
  },
});
