import { v, ConvexError } from "convex/values";
import { query, mutation } from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
import { requireOrgRead, requireOrgReadDoc, requireService } from "./lib/auth";
import { bumpCountersForTable } from "./lib/counters";
import * as enums from "./lib/validators";

/**
 * Thin CRUD for CrewAssignment (Convex table "crewAssignments"). GENERATED — Phase 2/5.
 *
 * AUTH (Phase 5, convex/lib/auth.ts): mutations require the trusted backend
 * SERVICE token (service-only mirror/read helpers; the browser-direct write path with RBAC +
 * validation + audit enforced inside Convex lives in the *Writes.ts mutations — see FEATUREDOCS/54). Org-scoped reads
 * accept the service token OR a user token scoped to the same org. Lookups use the
 * cuid (`id`) via by_cuid. See FEATUREDOCS/54.
 */

// ── Pure scheduling helpers ported from src/lib/crew-scheduling-read.ts (epoch-ms). ──
const PHASE_RANK: Record<string, number> = { BUMP_IN: 0, EVENT: 1, BUMP_OUT: 2, DELIVERY: 3, PICKUP: 4, SETUP: 5, REHEARSAL: 6, FULL_DURATION: 7 };
const EXCLUDED_STATUSES = new Set(["CANCELLED", "DECLINED"]);
const isoMs = (ms: number | null | undefined): string | null => (ms != null ? new Date(ms).toISOString() : null);
function ascNullsLast<T>(a: T | null | undefined, b: T | null | undefined): number {
  if (a == null && b == null) return 0;
  if (a == null) return 1; if (b == null) return -1;
  return a < b ? -1 : a > b ? 1 : 0;
}
function rangeOverlaps(rowStart: number | null | undefined, rowEnd: number | null | undefined, rs: number, re: number): boolean {
  if (rowStart == null || rowEnd == null) return false;
  return rowStart <= re && rowEnd >= rs;
}

/**
 * A project's crew — browser-native replacement for getProjectCrew. Assignments
 * (by_projectId, org-filtered) + member/role/service joins + shifts (by_assignmentId)
 * + confirmedBy from the users mirror. sortProjectCrew order (PM desc, phase rank,
 * lastName). One-shot composite (shared-store consumer).
 */
export const projectCrew = query({
  args: { projectId: v.string(), orgId: v.string() },
  handler: async (ctx, { projectId, orgId }) => {
    await requireOrgRead(ctx, orgId);
    const project = await ctx.db.query("projects").withIndex("by_cuid", (q) => q.eq("id", projectId)).unique();
    if (!project || project.organizationId !== orgId) throw new ConvexError("Project not found");

    const [assignmentsRaw, members, roles, services] = await Promise.all([
      ctx.db.query("crewAssignments").withIndex("by_projectId", (q) => q.eq("projectId", projectId)).collect().then((rows) => rows.filter((a) => a.organizationId === orgId)),
      ctx.db.query("crewMembers").withIndex("by_organizationId", (q) => q.eq("organizationId", orgId)).collect(), // r9.8-ok: bounded by the org's crew roster (name resolution)
      ctx.db.query("crewRoles").withIndex("by_organizationId", (q) => q.eq("organizationId", orgId)).collect(), // r9.8-ok: small bounded per-org config set (crew roles)
      ctx.db.query("projectServices").withIndex("by_projectId", (q) => q.eq("projectId", projectId)).collect().then((rows) => rows.filter((s) => s.organizationId === orgId)),
    ]);
    const memberById = new Map(members.map((m) => [m.id, m]));
    const roleById = new Map(roles.map((r) => [r.id, r]));
    const serviceById = new Map(services.map((s) => [s.id, s]));

    const filtered = assignmentsRaw.filter((a) => memberById.has(a.crewMemberId));
    filtered.sort((a, b) => {
      if ((a.isProjectManager ?? false) !== (b.isProjectManager ?? false)) return a.isProjectManager ? -1 : 1;
      const ar = a.phase == null ? Infinity : PHASE_RANK[a.phase] ?? Infinity;
      const br = b.phase == null ? Infinity : PHASE_RANK[b.phase] ?? Infinity;
      if (ar !== br) return ar - br;
      return ascNullsLast(memberById.get(a.crewMemberId)?.lastName, memberById.get(b.crewMemberId)?.lastName);
    });

    const out = [];
    for (const a of filtered) {
      const m = memberById.get(a.crewMemberId)!;
      const role = a.crewRoleId ? roleById.get(a.crewRoleId) ?? null : null;
      const service = a.serviceId ? serviceById.get(a.serviceId) ?? null : null;
      const shifts = (await ctx.db.query("crewShifts").withIndex("by_assignmentId", (q) => q.eq("assignmentId", a.id)).collect())
        .sort((x, y) => ascNullsLast(x.date, y.date))
        .map((s) => ({ id: s.id, assignmentId: s.assignmentId, date: isoMs(s.date), callTime: s.callTime ?? null, endTime: s.endTime ?? null, breakMinutes: s.breakMinutes ?? null, location: s.location ?? null, notes: s.notes ?? null, status: s.status ?? "SCHEDULED" }));
      let confirmedBy = null;
      if (a.confirmedById) {
        // Membership-gate the users-mirror join (a foreign id can't leak another org's name).
        const mem = await ctx.db.query("members").withIndex("by_org_user", (q) => q.eq("organizationId", orgId).eq("userId", a.confirmedById!)).first();
        if (mem) {
          const u = await ctx.db.query("users").withIndex("by_cuid", (q) => q.eq("id", a.confirmedById!)).unique();
          confirmedBy = u ? { id: u.id, name: u.name ?? null } : null;
        }
      }
      // Strip Convex system fields + the single-use offer-respond bearer token (no
      // consumer reads it off projectCrew) before it reaches any crew:read caller (audit).
      const { _id, _creationTime, responseToken, ...arest } = a;
      void _id; void _creationTime; void responseToken;
      out.push({
        ...arest,
        startDate: isoMs(a.startDate), endDate: isoMs(a.endDate), confirmedAt: isoMs(a.confirmedAt), offeredAt: isoMs(a.offeredAt), respondedAt: isoMs(a.respondedAt), createdAt: isoMs(a.createdAt), updatedAt: isoMs(a.updatedAt),
        crewMember: { id: m.id, firstName: m.firstName, lastName: m.lastName, email: m.email ?? null, phone: m.phone ?? null, image: m.image ?? null, defaultDayRate: m.defaultDayRate ?? null, defaultHourlyRate: m.defaultHourlyRate ?? null },
        crewRole: role ? { id: role.id, name: role.name, color: role.color ?? null, defaultRate: role.defaultRate ?? null, rateType: role.rateType ?? null } : null,
        service: service ? { id: service.id, title: service.title, type: service.type } : null,
        shifts,
        confirmedBy,
      });
    }
    return out;
  },
});

/** Aggregate project labour cost — browser-native replacement for getProjectLabourCost. */
export const projectLabourCost = query({
  args: { projectId: v.string(), orgId: v.string() },
  handler: async (ctx, { projectId, orgId }) => {
    await requireOrgRead(ctx, orgId);
    const assignments = (await ctx.db.query("crewAssignments").withIndex("by_projectId", (q) => q.eq("projectId", projectId)).collect())
      .filter((a) => a.organizationId === orgId && !EXCLUDED_STATUSES.has(a.status ?? ""));
    return { totalLabourCost: assignments.reduce((sum, a) => sum + (a.estimatedCost ?? 0), 0), assignmentCount: assignments.length };
  },
});

/**
 * Active crew members for the assignment picker — browser-native replacement for
 * getCrewMembersForAssignment. Active+ACTIVE members (search, lastName asc, top 50) +
 * their assignments on THIS project + (optional) cross-project conflicts + unavailability.
 */
export const membersForAssignment = query({
  args: { projectId: v.string(), orgId: v.string(), search: v.optional(v.string()), rangeStartMs: v.optional(v.number()), rangeEndMs: v.optional(v.number()) },
  handler: async (ctx, { projectId, orgId, search, rangeStartMs, rangeEndMs }) => {
    await requireOrgRead(ctx, orgId);
    const [allMembers, allAssignments, roles, projects] = await Promise.all([
      ctx.db.query("crewMembers").withIndex("by_organizationId", (q) => q.eq("organizationId", orgId)).collect(), // r9.8-ok: crew-graph aggregation (bounded by org roster/projects)
      ctx.db.query("crewAssignments").withIndex("by_organizationId", (q) => q.eq("organizationId", orgId)).collect(), // r9.8-ok: crew-graph aggregation (bounded by org roster/projects)
      ctx.db.query("crewRoles").withIndex("by_organizationId", (q) => q.eq("organizationId", orgId)).collect(), // r9.8-ok: crew-graph aggregation (bounded by org roster/projects)
      ctx.db.query("projects").withIndex("by_organizationId", (q) => q.eq("organizationId", orgId)).collect(), // r9.8-ok: crew-graph aggregation (bounded by org roster/projects)
    ]);
    const roleById = new Map(roles.map((r) => [r.id, r]));
    const projectsById = new Map(projects.map((p) => [p.id, p]));
    const needle = search?.trim().toLowerCase();
    const members = allMembers
      .filter((m) => (m.isActive ?? true) && (m.status ?? "ACTIVE") === "ACTIVE")
      .filter((m) => !needle || m.firstName.toLowerCase().includes(needle) || m.lastName.toLowerCase().includes(needle) || (m.email ?? "").toLowerCase().includes(needle) || (m.department ?? "").toLowerCase().includes(needle))
      .sort((a, b) => ascNullsLast(a.lastName, b.lastName))
      .slice(0, 50);

    const projectAssignmentsByMember = new Map<string, typeof allAssignments>();
    for (const a of allAssignments) {
      if (a.projectId !== projectId) continue;
      const list = projectAssignmentsByMember.get(a.crewMemberId) ?? [];
      list.push(a); projectAssignmentsByMember.set(a.crewMemberId, list);
    }
    const baseShape = (m: typeof members[number]) => {
      const role = m.crewRoleId ? roleById.get(m.crewRoleId) ?? null : null;
      return {
        id: m.id, firstName: m.firstName, lastName: m.lastName, email: m.email ?? null, phone: m.phone ?? null, image: m.image ?? null,
        department: m.department ?? null, defaultDayRate: m.defaultDayRate ?? null, defaultHourlyRate: m.defaultHourlyRate ?? null,
        crewRole: role ? { id: role.id, name: role.name } : null,
        assignments: (projectAssignmentsByMember.get(m.id) ?? []).map((a) => ({ id: a.id, phase: a.phase ?? null, status: a.status ?? null, serviceId: a.serviceId ?? null })),
      };
    };

    if (rangeStartMs != null && rangeEndMs != null) {
      const memberIds = new Set(members.map((m) => m.id));
      const avails = (await Promise.all([...memberIds].map((mid) => ctx.db.query("crewAvailabilities").withIndex("by_crewMemberId", (q) => q.eq("crewMemberId", mid)).collect())))
        .flat().filter((b) => b.organizationId == null || b.organizationId === orgId);
      const unavailable = new Set<string>();
      for (const b of avails) { if (b.type === "UNAVAILABLE" && rangeOverlaps(b.startDate, b.endDate, rangeStartMs, rangeEndMs)) unavailable.add(b.crewMemberId); }
      return members.map((m) => {
        const conflicts = allAssignments
          .filter((a) => a.crewMemberId === m.id && a.projectId !== projectId && !EXCLUDED_STATUSES.has(a.status ?? "") && rangeOverlaps(a.startDate, a.endDate, rangeStartMs, rangeEndMs))
          .map((c) => { const p = projectsById.get(c.projectId) ?? null; return { crewMemberId: c.crewMemberId, projectId: c.projectId, project: p ? { projectNumber: p.projectNumber, name: p.name } : null, startDate: isoMs(c.startDate), endDate: isoMs(c.endDate) }; });
        return { ...baseShape(m), conflicts, isUnavailable: unavailable.has(m.id) };
      });
    }
    return members.map((m) => ({ ...baseShape(m), conflicts: [] as never[], isUnavailable: false }));
  },
});

export const list = query({
  args: { orgId: v.string() },
  handler: async (ctx, { orgId }) => {
    await requireOrgRead(ctx, orgId);
    return await ctx.db
      .query("crewAssignments")
      .withIndex("by_organizationId", (q) => q.eq("organizationId", orgId)) // r9.8-ok: reactive/full-org read (perf design); reviewed, accepted R-9.8 tradeoff — revisit with pagination if per-org rows grow large
      .collect();
  },
});

export const getById = query({
  args: { id: v.string() },
  handler: async (ctx, { id }) => {
    const doc = await ctx.db.query("crewAssignments").withIndex("by_cuid", (q) => q.eq("id", id)).unique();
    await requireOrgReadDoc(ctx, doc);
    return doc;
  },
});

export const listByProject = query({
  args: { projectId: v.string(), orgId: v.string() },
  handler: async (ctx, { projectId, orgId }) => {
    await requireOrgRead(ctx, orgId);
    // by_projectId is a GLOBAL index — filter to the caller's org (cross-tenant guard).
    return (await ctx.db
      .query("crewAssignments")
      .withIndex("by_projectId", (q) => q.eq("projectId", projectId))
      .collect()).filter((r) => r.organizationId === orgId);
  },
});

/**
 * Look up a single assignment by its (single-use) responseToken. Service-only —
 * used by the public crew-offer respond route (token IS the bearer credential).
 */
export const getByResponseToken = query({
  args: { responseToken: v.string() },
  handler: async (ctx, { responseToken }) => {
    await requireService(ctx);
    return await ctx.db
      .query("crewAssignments")
      .withIndex("by_responseToken", (q) => q.eq("responseToken", responseToken))
      .first();
  },
});

/**
 * All crew assignments for a set of service ids (one round trip), org-scoped.
 * Used to attach assignment summaries onto project services without N+1 reads.
 */
export const listByServiceIds = query({
  args: { serviceIds: v.array(v.string()), orgId: v.string() },
  handler: async (ctx, { serviceIds, orgId }) => {
    await requireOrgRead(ctx, orgId);
    const results = [];
    for (const serviceId of serviceIds) {
      const rows = await ctx.db
        .query("crewAssignments")
        .withIndex("by_serviceId", (q) => q.eq("serviceId", serviceId))
        .collect();
      // by_serviceId is a GLOBAL index — filter to the caller's org (cross-tenant guard).
      results.push(...rows.filter((r) => r.organizationId === orgId));
    }
    return results;
  },
});

export const create = mutation({
  args: {
    id: v.string(),
    organizationId: v.string(),
    projectId: v.string(),
    crewMemberId: v.string(),
    crewRoleId: v.optional(v.string()),
    status: v.optional(enums.AssignmentStatus),
    phase: v.optional(enums.ProjectPhase),
    isProjectManager: v.optional(v.boolean()),
    startDate: v.optional(v.number()),
    startTime: v.optional(v.string()),
    endDate: v.optional(v.number()),
    endTime: v.optional(v.string()),
    rateOverride: v.optional(v.number()),
    rateType: v.optional(enums.CrewRateType),
    estimatedHours: v.optional(v.number()),
    estimatedCost: v.optional(v.number()),
    notes: v.optional(v.string()),
    internalNotes: v.optional(v.string()),
    responseToken: v.optional(v.string()),
    offeredAt: v.optional(v.number()),
    respondedAt: v.optional(v.number()),
    responseNote: v.optional(v.string()),
    confirmedAt: v.optional(v.number()),
    confirmedById: v.optional(v.string()),
    serviceId: v.optional(v.string()),
    createdAt: v.optional(v.number()),
    updatedAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await requireService(ctx);
    const _id = await ctx.db.insert("crewAssignments", args);
    await bumpCountersForTable(ctx, "crewAssignments", null, args);
    return _id;
  },
});

export const createIfMissing = mutation({
  args: {
    id: v.string(),
    organizationId: v.string(),
    projectId: v.string(),
    crewMemberId: v.string(),
    crewRoleId: v.optional(v.string()),
    status: v.optional(enums.AssignmentStatus),
    phase: v.optional(enums.ProjectPhase),
    isProjectManager: v.optional(v.boolean()),
    startDate: v.optional(v.number()),
    startTime: v.optional(v.string()),
    endDate: v.optional(v.number()),
    endTime: v.optional(v.string()),
    rateOverride: v.optional(v.number()),
    rateType: v.optional(enums.CrewRateType),
    estimatedHours: v.optional(v.number()),
    estimatedCost: v.optional(v.number()),
    notes: v.optional(v.string()),
    internalNotes: v.optional(v.string()),
    responseToken: v.optional(v.string()),
    offeredAt: v.optional(v.number()),
    respondedAt: v.optional(v.number()),
    responseNote: v.optional(v.string()),
    confirmedAt: v.optional(v.number()),
    confirmedById: v.optional(v.string()),
    serviceId: v.optional(v.string()),
    createdAt: v.optional(v.number()),
    updatedAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await requireService(ctx);
    const existing = await ctx.db.query("crewAssignments").withIndex("by_cuid", (q) => q.eq("id", args.id)).unique();
    if (existing) return { _id: existing._id, created: false };
    const _id = await ctx.db.insert("crewAssignments", args);
    await bumpCountersForTable(ctx, "crewAssignments", null, args);
    return { _id, created: true };
  },
});

export const update = mutation({
  args: {
    id: v.string(),
    patch: v.object({
      organizationId: v.optional(v.string()),
      projectId: v.optional(v.string()),
      crewMemberId: v.optional(v.string()),
      crewRoleId: v.optional(v.string()),
      status: v.optional(enums.AssignmentStatus),
      phase: v.optional(enums.ProjectPhase),
      isProjectManager: v.optional(v.boolean()),
      startDate: v.optional(v.number()),
      startTime: v.optional(v.string()),
      endDate: v.optional(v.number()),
      endTime: v.optional(v.string()),
      rateOverride: v.optional(v.number()),
      rateType: v.optional(enums.CrewRateType),
      estimatedHours: v.optional(v.number()),
      estimatedCost: v.optional(v.number()),
      notes: v.optional(v.string()),
      internalNotes: v.optional(v.string()),
      responseToken: v.optional(v.string()),
      offeredAt: v.optional(v.number()),
      respondedAt: v.optional(v.number()),
      responseNote: v.optional(v.string()),
      confirmedAt: v.optional(v.number()),
      confirmedById: v.optional(v.string()),
      serviceId: v.optional(v.string()),
      createdAt: v.optional(v.number()),
      updatedAt: v.optional(v.number()),
    }),
  },
  handler: async (ctx, { id, patch }) => {
    await requireService(ctx);
    const doc = await ctx.db.query("crewAssignments").withIndex("by_cuid", (q) => q.eq("id", id)).unique();
    if (!doc) throw new ConvexError("crewAssignments not found: " + id);
    const safePatch = { ...patch };
    delete safePatch.organizationId;
    await ctx.db.patch(doc._id, safePatch);
    await bumpCountersForTable(ctx, "crewAssignments", doc, { ...doc, ...safePatch });
    return doc._id;
  },
});

export const remove = mutation({
  args: { id: v.string() },
  handler: async (ctx, { id }) => {
    await requireService(ctx);
    const doc = await ctx.db.query("crewAssignments").withIndex("by_cuid", (q) => q.eq("id", id)).unique();
    if (!doc) throw new ConvexError("crewAssignments not found: " + id);
    await ctx.db.delete(doc._id);
    await bumpCountersForTable(ctx, "crewAssignments", doc, null);
  },
});

// ─── CUSTOM (crew-scheduling write-inversion, Phase C — re-add on a `pnpm convex:crud` regen) ───

const assignmentPatchFields = {
  projectId: v.optional(v.string()),
  crewMemberId: v.optional(v.string()),
  crewRoleId: v.optional(v.string()),
  status: v.optional(enums.AssignmentStatus),
  phase: v.optional(enums.ProjectPhase),
  isProjectManager: v.optional(v.boolean()),
  startDate: v.optional(v.number()),
  startTime: v.optional(v.string()),
  endDate: v.optional(v.number()),
  endTime: v.optional(v.string()),
  rateOverride: v.optional(v.number()),
  rateType: v.optional(enums.CrewRateType),
  estimatedHours: v.optional(v.number()),
  estimatedCost: v.optional(v.number()),
  notes: v.optional(v.string()),
  internalNotes: v.optional(v.string()),
  responseToken: v.optional(v.string()),
  offeredAt: v.optional(v.number()),
  respondedAt: v.optional(v.number()),
  responseNote: v.optional(v.string()),
  confirmedAt: v.optional(v.number()),
  confirmedById: v.optional(v.string()),
  serviceId: v.optional(v.string()),
  updatedAt: v.optional(v.number()),
};

/**
 * Patch an assignment with explicit field clears. `clear` names are removed
 * (`undefined` in a Convex patch deletes the field) — needed for the status-machine
 * transitions that null `responseToken` (single-use) / `confirmedAt`/`confirmedById`
 * / `crewRoleId`, which the generated `update` can't express (toConvexDoc drops nulls).
 */
export const patchAssignment = mutation({
  args: {
    id: v.string(),
    set: v.object(assignmentPatchFields),
    clear: v.optional(v.array(v.string())),
  },
  handler: async (ctx, { id, set, clear }) => {
    await requireService(ctx);
    const doc = await ctx.db.query("crewAssignments").withIndex("by_cuid", (q) => q.eq("id", id)).unique();
    if (!doc) throw new ConvexError("crewAssignments not found: " + id);
    const patch: Record<string, unknown> = { ...set };
    for (const k of clear ?? []) patch[k] = undefined;
    await ctx.db.patch(doc._id, patch);
    await bumpCountersForTable(ctx, "crewAssignments", doc, { ...doc, ...patch });
    return doc._id;
  },
});

/**
 * Delete an assignment + its shifts + its (linked) time entries — atomic. Extracted
 * as a plain function so mutations that can't call another mutation (Convex forbids
 * mutation→mutation) — e.g. projectWrites.deleteNative — reuse the EXACT shift +
 * time-entry purge AND the pendingCrewOffers counter bump. Caller org-scopes `doc`
 * before invoking. Standalone time entries (no assignmentId) are kept.
 */
export async function deleteCrewAssignmentCascadeCore(ctx: MutationCtx, doc: Doc<"crewAssignments">): Promise<void> {
  const id = doc.id;
  const shifts = await ctx.db.query("crewShifts").withIndex("by_assignmentId", (q) => q.eq("assignmentId", id)).collect();
  for (const s of shifts) await ctx.db.delete(s._id);
  const entries = await ctx.db.query("crewTimeEntries").withIndex("by_assignmentId", (q) => q.eq("assignmentId", id)).collect();
  for (const e of entries) await ctx.db.delete(e._id);
  await ctx.db.delete(doc._id);
  await bumpCountersForTable(ctx, "crewAssignments", doc, null);
}

/** Delete an assignment + its shifts + its (linked) time entries — atomic. Replaces
 *  the dropped Prisma FK cascade. Standalone time entries (no assignmentId) are kept. */
export const deleteCascade = mutation({
  args: { id: v.string() },
  handler: async (ctx, { id }) => {
    await requireService(ctx);
    const doc = await ctx.db.query("crewAssignments").withIndex("by_cuid", (q) => q.eq("id", id)).unique();
    if (!doc) throw new ConvexError("crewAssignments not found: " + id);
    await deleteCrewAssignmentCascadeCore(ctx, doc);
  },
});

// ─── Bulk (multi-select) operations ────────────────────────────────────────
// Collapse an N-assignment bulk action into ONE mutation round-trip: the loop
// runs backend-local instead of one server→Convex call per row. Org-scoped per
// row (by_cuid is global); foreign rows skipped and reported.

/** Bulk cascade-delete N assignments (+ shifts + linked time entries) in one pass. */
export const deleteManyCascade = mutation({
  args: { ids: v.array(v.string()), orgId: v.string() },
  handler: async (ctx, { ids, orgId }) => {
    await requireService(ctx);
    const projectIds = new Set<string>();
    let deleted = 0;
    let skipped = 0;
    for (const id of ids) {
      const doc = await ctx.db.query("crewAssignments").withIndex("by_cuid", (q) => q.eq("id", id)).unique();
      if (!doc || doc.organizationId !== orgId) { skipped++; continue; }
      const shifts = await ctx.db.query("crewShifts").withIndex("by_assignmentId", (q) => q.eq("assignmentId", id)).collect();
      for (const s of shifts) await ctx.db.delete(s._id);
      const entries = await ctx.db.query("crewTimeEntries").withIndex("by_assignmentId", (q) => q.eq("assignmentId", id)).collect();
      for (const e of entries) await ctx.db.delete(e._id);
      await ctx.db.delete(doc._id);
      await bumpCountersForTable(ctx, "crewAssignments", doc, null);
      projectIds.add(doc.projectId);
      deleted++;
    }
    return { deleted, skipped, projectIds: [...projectIds] };
  },
});

/** Bulk status change across N assignments in one pass. Mirrors updateAssignmentStatus'
 *  first-transition CONFIRMED stamp per row. */
export const patchManyStatus = mutation({
  args: {
    ids: v.array(v.string()),
    orgId: v.string(),
    status: enums.AssignmentStatus,
    confirmedById: v.string(),
    now: v.number(),
  },
  handler: async (ctx, { ids, orgId, status, confirmedById, now }) => {
    await requireService(ctx);
    const projectIds = new Set<string>();
    let updated = 0;
    let skipped = 0;
    for (const id of ids) {
      const doc = await ctx.db.query("crewAssignments").withIndex("by_cuid", (q) => q.eq("id", id)).unique();
      if (!doc || doc.organizationId !== orgId) { skipped++; continue; }
      const patch: Record<string, unknown> = { status, updatedAt: now };
      if (status === "CONFIRMED" && !doc.confirmedAt) {
        patch.confirmedAt = now;
        patch.confirmedById = confirmedById;
      }
      await ctx.db.patch(doc._id, patch);
      await bumpCountersForTable(ctx, "crewAssignments", doc, { ...doc, ...patch });
      projectIds.add(doc.projectId);
      updated++;
    }
    return { updated, skipped, projectIds: [...projectIds] };
  },
});

/**
 * Create a service-derived assignment, enforcing the partial-unique invariant
 * `(projectId, crewMemberId, serviceId)` (the Prisma
 * `crew_assignment_project_member_service_key` WHERE serviceId IS NOT NULL).
 * Race-safe: Convex mutations are serializable, so a concurrent insert conflicts on
 * the by_serviceId read range. Returns `{ created, id }` — `created:false` if a row
 * for the same (project, member, service) already exists.
 */
export const createServiceAssignment = mutation({
  args: {
    id: v.string(),
    organizationId: v.string(),
    projectId: v.string(),
    crewMemberId: v.string(),
    serviceId: v.string(),
    crewRoleId: v.optional(v.string()),
    status: v.optional(enums.AssignmentStatus),
    phase: v.optional(enums.ProjectPhase),
    startDate: v.optional(v.number()),
    startTime: v.optional(v.string()),
    endDate: v.optional(v.number()),
    endTime: v.optional(v.string()),
    rateOverride: v.optional(v.number()),
    rateType: v.optional(enums.CrewRateType),
    estimatedHours: v.optional(v.number()),
    estimatedCost: v.optional(v.number()),
    notes: v.optional(v.string()),
    createdAt: v.optional(v.number()),
    updatedAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await requireService(ctx);
    const dupe = await ctx.db
      .query("crewAssignments")
      .withIndex("by_serviceId", (q) => q.eq("serviceId", args.serviceId))
      .filter((q) => q.and(q.eq(q.field("projectId"), args.projectId), q.eq(q.field("crewMemberId"), args.crewMemberId)))
      .first();
    if (dupe) return { created: false, id: dupe.id };
    await ctx.db.insert("crewAssignments", args);
    await bumpCountersForTable(ctx, "crewAssignments", null, args);
    return { created: true, id: args.id };
  },
});

/**
 * Create N service-derived crew assignments in ONE array mutation (bulk single-call
 * invariant, Phase 3) — replaces the server firing one `createServiceAssignment` per
 * selected crew member when assigning multiple crew to a service (N round-trips).
 * `organizationId` is stamped from the ARG onto every row (a caller can't smuggle a
 * per-row org). Each row honours the same partial-unique
 * `(projectId, crewMemberId, serviceId)` invariant as the single mutation: an existing
 * row for that triple is skipped (idempotent on retry). Returns how many were created.
 */
export const createManyServiceAssignments = mutation({
  args: {
    organizationId: v.string(),
    rows: v.array(
      v.object({
        id: v.string(),
        projectId: v.string(),
        crewMemberId: v.string(),
        serviceId: v.string(),
        crewRoleId: v.optional(v.string()),
        status: v.optional(enums.AssignmentStatus),
        phase: v.optional(enums.ProjectPhase),
        startDate: v.optional(v.number()),
        startTime: v.optional(v.string()),
        endDate: v.optional(v.number()),
        endTime: v.optional(v.string()),
        rateOverride: v.optional(v.number()),
        rateType: v.optional(enums.CrewRateType),
        estimatedHours: v.optional(v.number()),
        estimatedCost: v.optional(v.number()),
        notes: v.optional(v.string()),
        createdAt: v.optional(v.number()),
        updatedAt: v.optional(v.number()),
      }),
    ),
  },
  handler: async (ctx, { organizationId, rows }) => {
    await requireService(ctx);
    let created = 0;
    for (const r of rows) {
      const dupe = await ctx.db
        .query("crewAssignments")
        .withIndex("by_serviceId", (q) => q.eq("serviceId", r.serviceId))
        .filter((q) => q.and(q.eq(q.field("projectId"), r.projectId), q.eq(q.field("crewMemberId"), r.crewMemberId)))
        .first();
      if (dupe) continue;
      const doc = { ...r, organizationId };
      await ctx.db.insert("crewAssignments", doc);
      await bumpCountersForTable(ctx, "crewAssignments", null, doc);
      created++;
    }
    return { created };
  },
});
