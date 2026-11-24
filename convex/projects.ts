import { v, ConvexError } from "convex/values";
import { query, mutation, type QueryCtx } from "./_generated/server";
import { requireOrgReadFor, requireOrgReadDocFor, requireService } from "./lib/auth";
import { bumpCountersForTable } from "./lib/counters";
import { matchesSearch, compareValues, paginateItems } from "./lib/listQuery";
import * as enums from "./lib/validators";
import type { AgentOpsAnnotations } from "./lib/agentOps";
import { canSeeCrewPay, crewPayRedactor } from "./lib/crewPayVisibility";
import { PROJECT_CREW_COST_FIELDS } from "./lib/crewPayFields";
import { createLiveVersionForProject } from "./lib/projectVersionState";
import {
  JOB_SEGMENT_KEYS,
  inStatusSegment,
  matchesJobFilter,
  needsYouProjectIds,
  overdueReturnProjectIds,
  type JobListFilter,
  type JobSegmentKey,
} from "./lib/projectSegments";

/** The org's project rows, shared by listPage / segmentCounts / needsYouIds (one org-wide read, one place to bound later). */
async function loadOrgProjects(ctx: QueryCtx, orgId: string) {
  return await ctx.db
    .query("projects")
    .withIndex("by_organizationId", (q) => q.eq("organizationId", orgId)) // r9.8-ok: T3-style pagination rework approved but unshipped (no search index on projects yet) — see docs/exceptions.md R-8.3.3
    .collect();
}

/** An unknown segment key reads as "no segment" (a stale bookmark must still list). */
function parseSegment(raw: string | undefined): JobSegmentKey | undefined {
  return JOB_SEGMENT_KEYS.find((k) => k === raw);
}

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
    await requireOrgReadFor(ctx, orgId, "project"); // Phase 2 read bootstrap (#998)
    const rows = await ctx.db
      .query("projects")
      .withIndex("by_organizationId", (q) => q.eq("organizationId", orgId)) // r9.8-ok: cross-domain server-read helper (getProjectsByOrg) + the clients dashboard's org-wide rollup — see docs/exceptions.md R-8.3.3
      .collect();
    return rows.map(await crewPayRedactor(ctx, orgId, PROJECT_CREW_COST_FIELDS));
  },
});

export const getById = query({
  args: { id: v.string() },
  handler: async (ctx, { id }) => {
    const doc = await ctx.db.query("projects").withIndex("by_cuid", (q) => q.eq("id", id)).unique();
    await requireOrgReadDocFor(ctx, doc, "project"); // Phase 2 read bootstrap (#998)
    if (!doc) return doc;
    // The totals that include crew cost (and the margin that back-solves them)
    // are absent below the pay line (UX Phase 15 ruling, lib/crewPayFields.ts).
    return (await crewPayRedactor(ctx, doc.organizationId, PROJECT_CREW_COST_FIELDS))(doc);
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
/** The list's sort key: default `rentalStartDate`, and never a crew-cost total below the pay line (its order would leak it). */
async function listSortKey(ctx: QueryCtx, orgId: string, sortBy: string | undefined): Promise<string> {
  if (!sortBy) return "rentalStartDate";
  if (!(PROJECT_CREW_COST_FIELDS as readonly string[]).includes(sortBy)) return sortBy;
  return (await canSeeCrewPay(ctx, orgId)) ? sortBy : "rentalStartDate";
}

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
    // List-page filters (UX unification §9b.3): all optional; absent = old behaviour.
    segment: v.optional(v.string()),
    includeCancelled: v.optional(v.boolean()),
    clientIn: v.optional(v.array(v.string())),
    pmIn: v.optional(v.array(v.string())),
    dateFrom: v.optional(v.number()),
    dateTo: v.optional(v.number()),
    /** Stable clock for the derived `needs` segment (a caller snapshot, never a fresh Date.now()). */
    now: v.optional(v.number()),
    /** D86: only overdue returns (`lib/overdueReturns.ts`, the Home tile's definition). Additive; absent = off. */
    overdue: v.optional(v.boolean()),
  },
  handler: async (ctx, a) => {
    await requireOrgReadFor(ctx, a.orgId, "project"); // Phase 2 read bootstrap (#998)
    const page = a.page ?? 1;
    const pageSize = a.pageSize ?? 25;
    // Below the pay line a crew-cost total is absent from every row — and can't
    // be used as a sort key either, or its ORDER would leak what the rows hide.
    const redact = await crewPayRedactor(ctx, a.orgId, PROJECT_CREW_COST_FIELDS);
    const sortBy = await listSortKey(ctx, a.orgId, a.sortBy);
    const dir: 1 | -1 = a.sortOrder === "desc" ? -1 : 1;
    const segment = parseSegment(a.segment);

    // locationNameFor is only consulted inside the `a.search` branch below (location
    // isn't a column on this table, only a search-widening field) — skip the read
    // entirely on every unfiltered/non-search page load instead of always collecting
    // the whole locations table.
    const [rows, clients, locations] = await Promise.all([
      loadOrgProjects(ctx, a.orgId),
      ctx.db.query("clients").withIndex("by_organizationId", (q) => q.eq("organizationId", a.orgId)).collect(), // r9.8-ok: bounded per-org catalog/config map (list enrichment) — see docs/exceptions.md R-8.3.3
      a.search
        ? ctx.db.query("locations").withIndex("by_organizationId", (q) => q.eq("organizationId", a.orgId)).collect() // r9.8-ok: bounded per-org catalog/config map (list enrichment) — see docs/exceptions.md R-8.3.3
        : Promise.resolve([]),
    ]);
    const clientMap = new Map(clients.map((c) => [c.id, c]));
    const locationMap = new Map(locations.map((l) => [l.id, l]));
    const clientNameFor = (id: string | null | undefined) => (id ? clientMap.get(id)?.name : undefined);
    const locationNameFor = (id: string | null | undefined) => (id ? locationMap.get(id)?.name : undefined);

    const needsYou = segment === "needs" ? await needsYouProjectIds(ctx, a.orgId, rows, a.now) : new Set<string>();
    const overdueIds = a.overdue ? await overdueReturnProjectIds(ctx, rows, a.now) : undefined;
    const filter: JobListFilter = { ...a, segment, overdueIds };
    const filtered = rows.filter((p) => {
      if (!matchesJobFilter(p, filter, needsYou)) return false;
      if (a.search && !matchesSearch([p.name, p.projectNumber, clientNameFor(p.clientId), locationNameFor(p.locationId)], a.search)) return false;
      return true;
    });

    const keyFn = (p: typeof rows[number]): unknown => {
      if (sortBy === "client") return clientNameFor(p.clientId);
      return (p as unknown as Record<string, unknown>)[sortBy];
    };
    const sorted = [...filtered].sort((x, y) => compareValues(keyFn(x), keyFn(y), dir));
    const { items: pageRows, total, totalPages } = paginateItems(sorted, page, pageSize);

    const items = pageRows.map((p) => ({
      ...redact(p),
      client: p.clientId ? { name: clientNameFor(p.clientId) ?? null } : null,
    }));

    return { items, total, page, pageSize, totalPages };
  },
});

/**
 * Counts for the Jobs list's quick strip (§9b.3), one number per segment key,
 * derived on read. `all` excludes CANCELLED; `needs` is the derived "needs you"
 * set (`convex/lib/projectSegments.ts`). Read-only; org-scoped by the guard and
 * by the `by_organizationId` read.
 */
export const segmentCounts = query({
  args: { orgId: v.string(), now: v.optional(v.number()) },
  handler: async (ctx, { orgId, now }) => {
    await requireOrgReadFor(ctx, orgId, "project");
    const rows = (await loadOrgProjects(ctx, orgId)).filter((p) => !p.isTemplate);
    const needsYou = await needsYouProjectIds(ctx, orgId, rows, now);
    const counts: Record<JobSegmentKey, number> = { all: 0, active: 0, quoting: 0, booked: 0, out: 0, done: 0, needs: needsYou.size };
    for (const key of JOB_SEGMENT_KEYS) {
      if (key === "needs") continue;
      counts[key] = rows.filter((p) => inStatusSegment(p, key)).length;
    }
    return counts;
  },
});

/**
 * Ids of the jobs in the derived "needs you" set (blocking discussion, overdue
 * return, hard overbooking, quote untouched 12+ days), so a surface can
 * highlight or open them.
 */
export const needsYouIds = query({
  args: { orgId: v.string(), now: v.optional(v.number()) },
  handler: async (ctx, { orgId, now }) => {
    await requireOrgReadFor(ctx, orgId, "project");
    const rows = (await loadOrgProjects(ctx, orgId)).filter((p) => !p.isTemplate);
    const ids = await needsYouProjectIds(ctx, orgId, rows, now);
    return [...ids].sort();
  },
});

/**
 * ALL of an org's non-template, non-cancelled projects (NOT paginated), with
 * client resolved server-side — browser-native backend for the project
 * board's "browse everything, grouped by lifecycle stage" kanban view
 * (project-board.tsx). Unlike `listPage`, this returns every matching row in
 * one shot: the board groups everything by status column on one screen,
 * which doesn't fit a paginated contract (same "Option A" shape as
 * assets.listGallery — see docs/designs/perf-convex-efficiency-2026-06.md
 * Finding #1). CANCELLED is excluded because the board has no column for it
 * (matches the old client-side filter); no sort is applied (matches the old
 * behavior — cards were never explicitly ordered within a column).
 */
export const listBoard = query({
  args: { orgId: v.string(), search: v.optional(v.string()) },
  handler: async (ctx, { orgId, search }) => {
    await requireOrgReadFor(ctx, orgId, "project");
    const [rows, clients] = await Promise.all([
      ctx.db.query("projects").withIndex("by_organizationId", (q) => q.eq("organizationId", orgId)).collect(), // r9.8-ok: "browse everything" kanban view, Option A (perf design) — see docs/exceptions.md R-8.3.3
      ctx.db.query("clients").withIndex("by_organizationId", (q) => q.eq("organizationId", orgId)).collect(), // r9.8-ok: bounded per-org enrichment map (board) — see docs/exceptions.md R-8.3.3
    ]);
    const clientMap = new Map(clients.map((c) => [c.id, c]));
    const clientNameFor = (id: string | null | undefined) => (id ? clientMap.get(id)?.name : undefined);

    const filtered = rows.filter((p) => {
      if (p.isTemplate) return false;
      if (p.status === "CANCELLED") return false;
      if (search && !matchesSearch([p.name, p.projectNumber, clientNameFor(p.clientId)], search)) return false;
      return true;
    });

    const redact = await crewPayRedactor(ctx, orgId, PROJECT_CREW_COST_FIELDS);
    return filtered.map((p) => ({
      ...redact(p),
      client: p.clientId ? { name: clientNameFor(p.clientId) ?? null } : null,
    }));
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
    await requireOrgReadFor(ctx, orgId, "project");
    const unique = [...new Set(ids)];
    if (unique.length > 1000) throw new ConvexError("projects.listByIds: too many ids (max 1000)");
    const docs = await Promise.all(
      unique.map((id) => ctx.db.query("projects").withIndex("by_cuid", (q) => q.eq("id", id)).unique()),
    );
    const redact = await crewPayRedactor(ctx, orgId, PROJECT_CREW_COST_FIELDS);
    return docs.filter((d): d is NonNullable<typeof d> => d !== null && d.organizationId === orgId).map(redact);
  },
});

export const create = mutation({
  args: {
    id: v.string(),
    organizationId: v.string(),
    projectNumber: v.string(),
    name: v.string(),
    clientId: v.optional(v.string()),
    clientContactId: v.optional(v.string()),
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
    projectStartDate: v.optional(v.number()),
    projectStartTime: v.optional(v.string()),
    projectEndDate: v.optional(v.number()),
    projectEndTime: v.optional(v.string()),
    rentalStartDate: v.optional(v.number()),
    rentalEndDate: v.optional(v.number()),
    projectManagerId: v.optional(v.string()),
    billingWeeksOverride: v.optional(v.number()),
    billingDaysOverride: v.optional(v.number()),
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
    // #1228 — bootstrap version 1 + liveVersionId (see createLiveVersionForProject's
    // comment: mandatory on every project-creating write path).
    await createLiveVersionForProject(ctx, {
      orgId: args.organizationId, projectId: args.id, projectDocId: _id,
      now: args.createdAt ?? Date.now(), createdById: "system",
    });
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
    clientContactId: v.optional(v.string()),
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
    projectStartDate: v.optional(v.number()),
    projectStartTime: v.optional(v.string()),
    projectEndDate: v.optional(v.number()),
    projectEndTime: v.optional(v.string()),
    rentalStartDate: v.optional(v.number()),
    rentalEndDate: v.optional(v.number()),
    projectManagerId: v.optional(v.string()),
    billingWeeksOverride: v.optional(v.number()),
    billingDaysOverride: v.optional(v.number()),
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
    // #1228 — see the identical note on `create` above.
    await createLiveVersionForProject(ctx, {
      orgId: args.organizationId, projectId: args.id, projectDocId: _id,
      now: args.createdAt ?? Date.now(), createdById: "system",
    });
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
      clientContactId: v.optional(v.string()),
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
      projectStartDate: v.optional(v.number()),
      projectStartTime: v.optional(v.string()),
      projectEndDate: v.optional(v.number()),
      projectEndTime: v.optional(v.string()),
      rentalStartDate: v.optional(v.number()),
      rentalEndDate: v.optional(v.number()),
      projectManagerId: v.optional(v.string()),
      billingWeeksOverride: v.optional(v.number()),
      billingDaysOverride: v.optional(v.number()),
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
  // Per-project contact picker (WS9 #948) — org + belongs-to-project's-client
  // validated in projectWrites.ts (createNative / updateNative), cleared there when
  // clientId changes without an explicit new contact.
  clientContactId: v.optional(v.string()),
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
  projectStartDate: v.optional(v.number()),
  projectStartTime: v.optional(v.string()),
  projectEndDate: v.optional(v.number()),
  projectEndTime: v.optional(v.string()),
  rentalStartDate: v.optional(v.number()),
  rentalEndDate: v.optional(v.number()),
  projectManagerId: v.optional(v.string()),
  billingWeeksOverride: v.optional(v.number()),
  billingDaysOverride: v.optional(v.number()),
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
    // Pre-existing gap found during the Phase 5 (#1001) coverage sweep: this
    // query had NO auth guard at all, so any authenticated identity could look
    // up any org's project by number. Fixed here rather than left — R-8.4.3
    // treats an unguarded cross-tenant read as a Critical, not a style nit.
    await requireOrgReadFor(ctx, organizationId, "project");
    const doc = await ctx.db
      .query("projects")
      .withIndex("by_organizationId_projectNumber", (q) =>
        q.eq("organizationId", organizationId).eq("projectNumber", projectNumber),
      )
      .unique();
    return doc && (await crewPayRedactor(ctx, organizationId, PROJECT_CREW_COST_FIELDS))(doc);
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
    // #986/#1085 — a real project starts at revision 1 (its first quote is v1)
    // AND liveRevision 1 (its first version is, trivially, its live one), same
    // as projectWrites.createNative. Templates carry no revision at all.
    const newDocId = await ctx.db.insert("projects", args.isTemplate ? args : { ...args, revision: 1, liveRevision: 1 });
    // #1228 — bootstrap version 1 + liveVersionId (mandatory on every
    // project-creating write path; see createLiveVersionForProject's comment).
    await createLiveVersionForProject(ctx, {
      orgId: args.organizationId, projectId: args.id, projectDocId: newDocId,
      now: args.createdAt ?? Date.now(), createdById: "system",
    });
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

// ─── agentOps annotations (Phase 5 domain slice, #1001) ──────────────────────
export const agentOps: AgentOpsAnnotations = {
  list: { summary: "List all projects for an org.", danger: "low", mcpTier: 2 },
  getById: { summary: "Get one project by id.", danger: "low", mcpTier: 1 },
  listPage: { summary: "Filtered, sorted, paginated project list with client join.", danger: "low", mcpTier: 1 },
  segmentCounts: { summary: "Counts for the Jobs list strip: all, active, quoting, booked, out, done and needs-you.", danger: "low", mcpTier: 3 },
  needsYouIds: { summary: "Ids of jobs that need attention: open blocking comment, overdue return, hard overbooking, or a stale quote.", danger: "low", mcpTier: 3 },
  listBoard: { summary: "Browse an org's non-template, non-cancelled projects grouped for the kanban board.", danger: "low", mcpTier: 2 },
  listByIds: { summary: "Batch point-read projects by id, scoped to one org.", danger: "low", mcpTier: 2 },
  getByOrgAndNumber: { summary: "Look up a project by its human-facing project number.", danger: "low", mcpTier: 1 },
};
