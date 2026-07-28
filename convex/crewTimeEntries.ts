import { v, ConvexError } from "convex/values";
import { query, mutation } from "./_generated/server";
import type { QueryCtx } from "./_generated/server";
import { requireOrgReadFor, requireOrgReadDocFor, requireService } from "./lib/auth";
import type { AgentOpsAnnotations } from "./lib/agentOps";
import * as enums from "./lib/validators";

// ── Time-entry read helpers ported from src/lib/crew-scheduling-read.ts (epoch-ms). ──
const iso = (ms: number | null | undefined): string | null => (ms != null ? new Date(ms).toISOString() : null);
const TE_SORT_KEYS = new Set(["date", "crewMember", "startTime", "totalHours", "status"]);
function ascNL<T>(a: T | null | undefined, b: T | null | undefined): number {
  if (a == null && b == null) return 0; if (a == null) return 1; if (b == null) return -1;
  return a < b ? -1 : a > b ? 1 : 0;
}
function descNF<T>(a: T | null | undefined, b: T | null | undefined): number {
  if (a == null && b == null) return 0; if (a == null) return -1; if (b == null) return 1;
  return a < b ? 1 : a > b ? -1 : 0;
}

export const agentOps: AgentOpsAnnotations = {
  allEntries: { summary: "Paginated/searchable/sortable timesheet (crew time entry) list.", danger: "low", mcpTier: 1 },
  forMember: { summary: "A crew member's time entries, newest first.", danger: "low", mcpTier: 2 },
  list: { summary: "List crew time entries for the org.", danger: "low", mcpTier: 2 },
  getById: { summary: "Get a single crew time entry by id.", danger: "low", mcpTier: 2 },
};
type TE = { id: string; assignmentId?: string; crewMemberId: string; description?: string; date: number; startTime: string; endTime: string; breakMinutes?: number; totalHours?: number; status?: string; approvedById?: string; approvedAt?: number; notes?: string; createdAt?: number; updatedAt?: number };
function teWire(e: TE) {
  return {
    id: e.id, assignmentId: e.assignmentId ?? null, crewMemberId: e.crewMemberId, description: e.description ?? null,
    date: new Date(e.date).toISOString(), startTime: e.startTime, endTime: e.endTime, breakMinutes: e.breakMinutes ?? 0,
    totalHours: e.totalHours ?? null, status: e.status ?? "DRAFT", approvedById: e.approvedById ?? null,
    approvedAt: iso(e.approvedAt), notes: e.notes ?? null, createdAt: iso(e.createdAt), updatedAt: iso(e.updatedAt),
  };
}
/** Membership-gated approver-name map (users mirror). */
async function approverNames(ctx: QueryCtx, orgId: string, entries: TE[]): Promise<Map<string, string | null>> {
  const ids = [...new Set(entries.map((e) => e.approvedById).filter((x): x is string => !!x))];
  const out = new Map<string, string | null>();
  for (const id of ids) {
    const mem = await ctx.db.query("members").withIndex("by_org_user", (q) => q.eq("organizationId", orgId).eq("userId", id)).first();
    if (!mem) { out.set(id, null); continue; }
    const u = await ctx.db.query("users").withIndex("by_cuid", (q) => q.eq("id", id)).unique();
    out.set(id, u?.name ?? null);
  }
  return out;
}

/**
 * Paginated timesheet list — browser-native replacement for getAllTimeEntries. Filter
 * (search + status/crewMember) + sort + paginate + member/assignment(+project/role) joins
 * + membership-gated approvedBy. One-shot (timesheets table).
 */
export const allEntries = query({
  args: {
    orgId: v.string(), search: v.optional(v.string()), filters: v.optional(v.any()),
    page: v.optional(v.number()), pageSize: v.optional(v.number()), sortBy: v.optional(v.string()), sortOrder: v.optional(v.union(v.literal("asc"), v.literal("desc"))),
  },
  handler: async (ctx, a) => {
    await requireOrgReadFor(ctx, a.orgId, "crew"); // Phase 2 read bootstrap (#998)
    const page = a.page && a.page > 0 ? a.page : 1; // clamp (parity with `params?.page || 1`)
    const pageSize = a.pageSize && a.pageSize > 0 ? a.pageSize : 25;
    const sortBy = TE_SORT_KEYS.has(a.sortBy ?? "") ? a.sortBy! : "date";
    const order = a.sortOrder ?? "desc";

    const [allE, assignments, members, roles, projects] = await Promise.all([
      ctx.db.query("crewTimeEntries").withIndex("by_organizationId", (q) => q.eq("organizationId", a.orgId)).collect(), // r9.8-ok: reactive/full-org read (perf design); reviewed, accepted R-9.8 tradeoff — revisit with pagination if per-org rows grow large
      ctx.db.query("crewAssignments").withIndex("by_organizationId", (q) => q.eq("organizationId", a.orgId)).collect(), // r9.8-ok: crew-graph aggregation (bounded by org roster/projects) (allEntries enrichment)
      ctx.db.query("crewMembers").withIndex("by_organizationId", (q) => q.eq("organizationId", a.orgId)).collect(), // r9.8-ok: crew-graph aggregation (bounded by org roster/projects) (allEntries enrichment) — see docs/exceptions.md R-8.3.3
      ctx.db.query("crewRoles").withIndex("by_organizationId", (q) => q.eq("organizationId", a.orgId)).collect(), // r9.8-ok: crew-graph aggregation (bounded by org roster/projects) (allEntries enrichment) — see docs/exceptions.md R-8.3.3
      ctx.db.query("projects").withIndex("by_organizationId", (q) => q.eq("organizationId", a.orgId)).collect(), // r9.8-ok: crew-graph aggregation (bounded by org roster/projects) (allEntries enrichment) — see docs/exceptions.md R-8.3.3
    ]);
    const memberById = new Map(members.map((m) => [m.id, m]));
    const asgById = new Map(assignments.map((x) => [x.id, x]));
    const roleById = new Map(roles.map((r) => [r.id, r]));
    const projById = new Map(projects.map((p) => [p.id, p]));
    const projectOf = (e: TE) => { const asg = e.assignmentId ? asgById.get(e.assignmentId) : null; return asg ? projById.get(asg.projectId) ?? null : null; };

    let filtered = allE as TE[];
    const needle = a.search?.trim().toLowerCase();
    if (needle) filtered = filtered.filter((e) => { const m = memberById.get(e.crewMemberId); const p = projectOf(e); return (m?.firstName ?? "").toLowerCase().includes(needle) || (m?.lastName ?? "").toLowerCase().includes(needle) || (e.description ?? "").toLowerCase().includes(needle) || (p?.name ?? "").toLowerCase().includes(needle) || (p?.projectNumber ?? "").toLowerCase().includes(needle); });
    const f = (a.filters ?? {}) as Record<string, string[]>;
    if (f.status?.length) { const set = new Set(f.status); filtered = filtered.filter((e) => set.has(e.status ?? "DRAFT")); }
    if (f.crewMemberId?.length) { const set = new Set(f.crewMemberId); filtered = filtered.filter((e) => set.has(e.crewMemberId)); }

    const cmp = order === "asc" ? ascNL : descNF;
    const valueOf = (e: TE): string | number | null | undefined => sortBy === "crewMember" ? memberById.get(e.crewMemberId)?.lastName : sortBy === "startTime" ? e.startTime : sortBy === "totalHours" ? (e.totalHours ?? null) : sortBy === "status" ? (e.status ?? "DRAFT") : e.date;
    const sorted = [...filtered].sort((x, y) => { const p = cmp(valueOf(x), valueOf(y)); if (p !== 0) return p; if (sortBy === "date") return descNF(x.startTime, y.startTime); return 0; });
    const total = filtered.length;
    const pageE = sorted.slice((page - 1) * pageSize, (page - 1) * pageSize + pageSize);
    const approvers = await approverNames(ctx, a.orgId, pageE);

    const entries = pageE.map((e) => {
      const member = memberById.get(e.crewMemberId) ?? null;
      const asg = e.assignmentId ? asgById.get(e.assignmentId) ?? null : null;
      const project = asg ? projById.get(asg.projectId) ?? null : null;
      const role = asg?.crewRoleId ? roleById.get(asg.crewRoleId) ?? null : null;
      return {
        ...teWire(e),
        crewMember: member ? { id: member.id, firstName: member.firstName, lastName: member.lastName } : null,
        assignment: asg ? { id: asg.id, phase: asg.phase ?? null, status: asg.status ?? null, project: project ? { id: project.id, name: project.name, projectNumber: project.projectNumber } : null, crewRole: role ? { name: role.name } : null } : null,
        approvedBy: e.approvedById ? { name: approvers.get(e.approvedById) ?? null } : null,
      };
    });
    return { entries, total };
  },
});

/** A crew member's time entries (date desc, then startTime desc) + joins — replaces getTimeEntriesForMember. */
export const forMember = query({
  args: { crewMemberId: v.string(), orgId: v.string() },
  handler: async (ctx, { crewMemberId, orgId }) => {
    await requireOrgReadFor(ctx, orgId, "crew"); // Phase 2 read bootstrap (#998)
    const member = await ctx.db.query("crewMembers").withIndex("by_cuid", (q) => q.eq("id", crewMemberId)).unique();
    if (!member || member.organizationId !== orgId) throw new ConvexError("Crew member not found");

    const [entriesRaw, assignments, roles, projects] = await Promise.all([
      ctx.db.query("crewTimeEntries").withIndex("by_crewMemberId", (q) => q.eq("crewMemberId", crewMemberId)).collect().then((rows) => rows.filter((e) => e.organizationId === orgId)),
      ctx.db.query("crewAssignments").withIndex("by_organizationId", (q) => q.eq("organizationId", orgId)).collect(), // r9.8-ok: crew-graph aggregation (bounded by org roster/projects) (forMember enrichment)
      ctx.db.query("crewRoles").withIndex("by_organizationId", (q) => q.eq("organizationId", orgId)).collect(), // r9.8-ok: crew-graph aggregation (bounded by org roster/projects) (forMember enrichment) — see docs/exceptions.md R-8.3.3
      ctx.db.query("projects").withIndex("by_organizationId", (q) => q.eq("organizationId", orgId)).collect(), // r9.8-ok: crew-graph aggregation (bounded by org roster/projects) (forMember enrichment) — see docs/exceptions.md R-8.3.3
    ]);
    const asgById = new Map(assignments.map((x) => [x.id, x]));
    const roleById = new Map(roles.map((r) => [r.id, r]));
    const projById = new Map(projects.map((p) => [p.id, p]));
    const sorted = (entriesRaw as TE[]).sort((a, b) => { const d = descNF(a.date, b.date); if (d !== 0) return d; return descNF(a.startTime, b.startTime); });
    const approvers = await approverNames(ctx, orgId, sorted);
    return sorted.map((e) => {
      const asg = e.assignmentId ? asgById.get(e.assignmentId) ?? null : null;
      const project = asg ? projById.get(asg.projectId) ?? null : null;
      const role = asg?.crewRoleId ? roleById.get(asg.crewRoleId) ?? null : null;
      return {
        ...teWire(e),
        assignment: asg ? { id: asg.id, phase: asg.phase ?? null, status: asg.status ?? null, project: project ? { name: project.name, projectNumber: project.projectNumber } : null, crewRole: role ? { name: role.name } : null } : null,
        approvedBy: e.approvedById ? { name: approvers.get(e.approvedById) ?? null } : null,
      };
    });
  },
});

/**
 * Thin CRUD for CrewTimeEntry (Convex table "crewTimeEntries"). GENERATED — Phase 2/5.
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
    await requireOrgReadFor(ctx, orgId, "crew"); // Phase 2 read bootstrap (#998)
    return await ctx.db
      .query("crewTimeEntries")
      .withIndex("by_organizationId", (q) => q.eq("organizationId", orgId)) // r9.8-ok: reactive/full-org read (perf design); reviewed, accepted R-9.8 tradeoff — revisit with pagination if per-org rows grow large
      .collect();
  },
});

export const getById = query({
  args: { id: v.string() },
  handler: async (ctx, { id }) => {
    const doc = await ctx.db.query("crewTimeEntries").withIndex("by_cuid", (q) => q.eq("id", id)).unique();
    await requireOrgReadDocFor(ctx, doc, "crew"); // Phase 2 read bootstrap (#998)
    return doc;
  },
});

export const create = mutation({
  args: {
    id: v.string(),
    organizationId: v.string(),
    assignmentId: v.optional(v.string()),
    crewMemberId: v.string(),
    description: v.optional(v.string()),
    date: v.number(),
    startTime: v.string(),
    endTime: v.string(),
    breakMinutes: v.optional(v.number()),
    totalHours: v.optional(v.number()),
    status: v.optional(enums.TimeEntryStatus),
    approvedById: v.optional(v.string()),
    approvedAt: v.optional(v.number()),
    notes: v.optional(v.string()),
    createdAt: v.optional(v.number()),
    updatedAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await requireService(ctx);
    return await ctx.db.insert("crewTimeEntries", args);
  },
});

export const createIfMissing = mutation({
  args: {
    id: v.string(),
    organizationId: v.string(),
    assignmentId: v.optional(v.string()),
    crewMemberId: v.string(),
    description: v.optional(v.string()),
    date: v.number(),
    startTime: v.string(),
    endTime: v.string(),
    breakMinutes: v.optional(v.number()),
    totalHours: v.optional(v.number()),
    status: v.optional(enums.TimeEntryStatus),
    approvedById: v.optional(v.string()),
    approvedAt: v.optional(v.number()),
    notes: v.optional(v.string()),
    createdAt: v.optional(v.number()),
    updatedAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await requireService(ctx);
    const existing = await ctx.db.query("crewTimeEntries").withIndex("by_cuid", (q) => q.eq("id", args.id)).unique();
    if (existing) return { _id: existing._id, created: false };
    const _id = await ctx.db.insert("crewTimeEntries", args);
    return { _id, created: true };
  },
});

/**
 * Insert many time entries in ONE atomic mutation — collapses the "log time for
 * N selected crew" client loop (one createTimeEntry round-trip per crew member).
 * createIfMissing semantics per entry (idempotent by cuid on retry). The server
 * action validates each crew member + assignment before calling this, so every
 * entry here is already vetted.
 */
export const createMany = mutation({
  args: {
    entries: v.array(
      v.object({
        id: v.string(),
        organizationId: v.string(),
        assignmentId: v.optional(v.string()),
        crewMemberId: v.string(),
        description: v.optional(v.string()),
        date: v.number(),
        startTime: v.string(),
        endTime: v.string(),
        breakMinutes: v.optional(v.number()),
        totalHours: v.optional(v.number()),
        status: v.optional(enums.TimeEntryStatus),
        notes: v.optional(v.string()),
        createdAt: v.optional(v.number()),
        updatedAt: v.optional(v.number()),
      }),
    ),
  },
  handler: async (ctx, { entries }) => {
    await requireService(ctx);
    for (const e of entries) {
      const existing = await ctx.db.query("crewTimeEntries").withIndex("by_cuid", (q) => q.eq("id", e.id)).unique();
      if (existing) continue;
      await ctx.db.insert("crewTimeEntries", e);
    }
  },
});

export const update = mutation({
  args: {
    id: v.string(),
    patch: v.object({
      organizationId: v.optional(v.string()),
      assignmentId: v.optional(v.string()),
      crewMemberId: v.optional(v.string()),
      description: v.optional(v.string()),
      date: v.optional(v.number()),
      startTime: v.optional(v.string()),
      endTime: v.optional(v.string()),
      breakMinutes: v.optional(v.number()),
      totalHours: v.optional(v.number()),
      status: v.optional(enums.TimeEntryStatus),
      approvedById: v.optional(v.string()),
      approvedAt: v.optional(v.number()),
      notes: v.optional(v.string()),
      createdAt: v.optional(v.number()),
      updatedAt: v.optional(v.number()),
    }),
  },
  handler: async (ctx, { id, patch }) => {
    await requireService(ctx);
    const doc = await ctx.db.query("crewTimeEntries").withIndex("by_cuid", (q) => q.eq("id", id)).unique();
    if (!doc) throw new ConvexError("crewTimeEntries not found: " + id);
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
    const doc = await ctx.db.query("crewTimeEntries").withIndex("by_cuid", (q) => q.eq("id", id)).unique();
    if (!doc) throw new ConvexError("crewTimeEntries not found: " + id);
    await ctx.db.delete(doc._id);
  },
});

/**
 * Delete N time entries in ONE array mutation (bulk single-call invariant) — replaces
 * the server firing one `remove` per entry in a crew-member delete cascade. Per-item
 * `organizationId` re-check (by_cuid is a GLOBAL index); a missing / cross-org id is
 * skipped (idempotent — a row an assignment-cascade already deleted is just absent).
 */
export const removeMany = mutation({
  args: { organizationId: v.string(), ids: v.array(v.string()) },
  handler: async (ctx, { organizationId, ids }) => {
    await requireService(ctx);
    let deleted = 0;
    for (const id of ids) {
      const doc = await ctx.db.query("crewTimeEntries").withIndex("by_cuid", (q) => q.eq("id", id)).unique();
      if (!doc || doc.organizationId !== organizationId) continue;
      await ctx.db.delete(doc._id);
      deleted++;
    }
    return { deleted };
  },
});

/**
 * Bulk status transition (bulk single-call invariant, Phase 3): apply ONE shared `set`
 * to N time entries in a single array mutation — replaces the server firing one
 * `patchTimeEntry` round-trip per entry (submit / approve N timesheets). Guards each
 * entry per-item: `organizationId` re-check (by_cuid is a GLOBAL index) + a
 * `fromStatuses` eligibility gate re-checked HERE (TOCTOU-safe — the status may have
 * changed since the caller read it). Skips ineligible entries; returns the ids updated.
 */
export const patchManyStatus = mutation({
  args: {
    organizationId: v.string(),
    ids: v.array(v.string()),
    fromStatuses: v.array(enums.TimeEntryStatus),
    set: v.object({
      status: enums.TimeEntryStatus,
      approvedById: v.optional(v.string()),
      approvedAt: v.optional(v.number()),
      updatedAt: v.number(),
    }),
  },
  handler: async (ctx, { organizationId, ids, fromStatuses, set }) => {
    await requireService(ctx);
    const allowed = new Set<string>(fromStatuses);
    const updated: string[] = [];
    for (const id of ids) {
      const doc = await ctx.db.query("crewTimeEntries").withIndex("by_cuid", (q) => q.eq("id", id)).unique();
      if (!doc || doc.organizationId !== organizationId) continue; // per-item org re-check
      if (doc.status == null || !allowed.has(doc.status)) continue; // eligibility (status may have changed)
      await ctx.db.patch(doc._id, set);
      updated.push(id);
    }
    return { count: updated.length, updated };
  },
});

// ─── CUSTOM (crew-scheduling write-inversion, Phase C — re-add on a `pnpm convex:crud` regen) ───

/** Patch a time entry with explicit field clears — the edit-resets-to-DRAFT path
 *  clears `approvedById`/`approvedAt`, which the generated `update` can't express. */
export const patchTimeEntry = mutation({
  args: {
    id: v.string(),
    set: v.object({
      assignmentId: v.optional(v.string()),
      description: v.optional(v.string()),
      date: v.optional(v.number()),
      startTime: v.optional(v.string()),
      endTime: v.optional(v.string()),
      breakMinutes: v.optional(v.number()),
      totalHours: v.optional(v.number()),
      status: v.optional(enums.TimeEntryStatus),
      approvedById: v.optional(v.string()),
      approvedAt: v.optional(v.number()),
      notes: v.optional(v.string()),
      updatedAt: v.optional(v.number()),
    }),
    clear: v.optional(v.array(v.string())),
  },
  handler: async (ctx, { id, set, clear }) => {
    await requireService(ctx);
    const doc = await ctx.db.query("crewTimeEntries").withIndex("by_cuid", (q) => q.eq("id", id)).unique();
    if (!doc) throw new ConvexError("crewTimeEntries not found: " + id);
    const patch: Record<string, unknown> = { ...set };
    for (const k of clear ?? []) patch[k] = undefined;
    await ctx.db.patch(doc._id, patch);
    return doc._id;
  },
});
