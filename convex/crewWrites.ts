import { v, ConvexError } from "convex/values";
import { mutation } from "./_generated/server";
import { requireOrgPermission, resolveActor } from "./lib/auth";
import type { AgentOpsAnnotations } from "./lib/agentOps";
import { assertRefInOrg, assertMemberInOrg } from "./lib/orgRef";
import { assertWritesEnabled } from "./lib/writeGuard";
import { enforceBrowserWriteLimit } from "./lib/rateLimiter";
import { sanitizeClientSet } from "./lib/sanitizeSet";
import { writeActivityLog } from "./lib/audit";
import { bumpCrewMemberCounters, bumpCountersForTable } from "./lib/counters";
import { buildChanges } from "./lib/auditChanges";
import { assertStrLen, assertNumRange } from "./lib/fieldGuards";
import * as enums from "./lib/validators";

/** Fields diffed for the crew-member UPDATE audit (parity with the old updateCrewMember). */
const CREW_AUDIT_FIELDS = ["firstName", "lastName", "email", "phone", "type", "status", "department", "defaultDayRate", "defaultHourlyRate", "address", "isActive"];

/**
 * Mirrors `crewMemberSchema` (src/lib/validations/crew.ts) string-length + rate bounds,
 * plus its lat/long-together `.refine()` — `v.string()`/`v.number()` only enforce type,
 * not these business constraints, so a browser-direct caller bypassing the client Zod
 * parse would otherwise skip them entirely (R-8.6.2). Shared by createNative (full
 * fields) and updateNative (the `set` patch) — every field is optional here because a
 * patch may only touch a subset.
 */
function assertCrewMemberFields(f: {
  firstName?: string;
  lastName?: string;
  email?: string;
  phone?: string;
  department?: string;
  currency?: string;
  address?: string;
  addressLatitude?: number;
  addressLongitude?: number;
  emergencyContactName?: string;
  emergencyContactPhone?: string;
  abnOrGst?: string;
  notes?: string;
  defaultDayRate?: number;
  defaultHourlyRate?: number;
  overtimeMultiplier?: number;
}): void {
  // firstName/lastName are required (min 1) whenever supplied — both createNative
  // (always sends them) and updateNative (only when actually being changed).
  if (f.firstName !== undefined) assertStrLen(f.firstName, "firstName", { min: 1, max: 200 });
  if (f.lastName !== undefined) assertStrLen(f.lastName, "lastName", { min: 1, max: 200 });
  assertStrLen(f.email, "email", { max: 200 });
  assertStrLen(f.phone, "phone", { max: 50 });
  assertStrLen(f.department, "department", { max: 100 });
  assertStrLen(f.currency, "currency", { max: 10 });
  assertStrLen(f.address, "address", { max: 500 });
  assertStrLen(f.emergencyContactName, "emergencyContactName", { max: 200 });
  assertStrLen(f.emergencyContactPhone, "emergencyContactPhone", { max: 50 });
  assertStrLen(f.abnOrGst, "abnOrGst", { max: 50 });
  assertStrLen(f.notes, "notes", { max: 2000 });
  assertNumRange(f.defaultDayRate, "defaultDayRate", { min: 0 });
  assertNumRange(f.defaultHourlyRate, "defaultHourlyRate", { min: 0 });
  assertNumRange(f.overtimeMultiplier, "overtimeMultiplier", { min: 0 });
  if (f.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(f.email)) {
    throw new ConvexError({ code: "INVALID_FIELD", message: "email must be a valid email address." });
  }
  // crewMemberSchema .refine(): latitude/longitude must both be present or both absent.
  if ((f.addressLatitude != null) !== (f.addressLongitude != null)) {
    throw new ConvexError({ code: "INVALID_FIELD", message: "Both latitude and longitude must be provided together." });
  }
}

/**
 * Native CREW write mutations (Phase 5) — same pattern as assetWrites/kitWrites:
 * RBAC(requireOrgPermission "crew") + atomic audit(writeActivityLog) in one
 * transaction. Additive; the generated convex/crewMembers.ts service mutations are
 * untouched. Browser-direct (the NATIVE_CREW_WRITES legacy server-action gate was removed in the cutover).
 *
 * Covers create + update (crew has no unique-tag invariant). deleteCrewMember has a
 * multi-table scheduling cascade (assignments → shifts/time-entries, availability) —
 * a separate slice.
 */

const actorValidator = v.object({ userId: v.string(), userName: v.string() });

export const createNative = mutation({
  returns: v.object({ id: v.string() }),
  args: {
    id: v.string(),
    organizationId: v.string(),
    firstName: v.string(),
    lastName: v.string(),
    email: v.optional(v.string()),
    phone: v.optional(v.string()),
    image: v.optional(v.string()),
    userId: v.optional(v.string()),
    type: v.optional(enums.CrewMemberType),
    status: v.optional(enums.CrewMemberStatus),
    department: v.optional(v.string()),
    defaultDayRate: v.optional(v.number()),
    defaultHourlyRate: v.optional(v.number()),
    overtimeMultiplier: v.optional(v.number()),
    currency: v.optional(v.string()),
    address: v.optional(v.string()),
    addressLatitude: v.optional(v.number()),
    addressLongitude: v.optional(v.number()),
    emergencyContactName: v.optional(v.string()),
    emergencyContactPhone: v.optional(v.string()),
    dateOfBirth: v.optional(v.number()),
    abnOrGst: v.optional(v.string()),
    notes: v.optional(v.string()),
    tags: v.optional(v.array(v.string())),
    icalEnabled: v.optional(v.boolean()),
    icalToken: v.optional(v.string()),
    crewRoleId: v.optional(v.string()),
    skillIds: v.optional(v.array(v.string())),
    createdAt: v.optional(v.number()),
    updatedAt: v.optional(v.number()),
    isActive: v.optional(v.boolean()),
    actor: actorValidator,
    auditId: v.string(),
  },
  handler: async (ctx, args) => {
    const { actor: suppliedActor, auditId, ...fields } = args;
    await assertWritesEnabled(ctx, "crew");
    await enforceBrowserWriteLimit(ctx);
    await requireOrgPermission(ctx, fields.organizationId, "crew", "create");
    const actor = await resolveActor(ctx, suppliedActor);

    // Org-validate the client-supplied FKs written onto the crew member row (both are
    // resolved via GLOBAL by_cuid/by_org_user elsewhere without re-checking org).
    if (fields.crewRoleId) await assertRefInOrg(ctx, "crewRoles", fields.crewRoleId, fields.organizationId);
    if (fields.userId) await assertMemberInOrg(ctx, fields.organizationId, fields.userId);

    // Server-side boundary parity with crewMemberSchema (R-8.6.2) — the form's
    // zodResolver + the hook's .parse cover the UI path only; this guards any caller
    // invoking the mutation directly. firstName/lastName are always sent by the hook, so
    // require them here too (createNative, unlike updateNative's partial patch).
    if (!fields.firstName || fields.firstName.length < 1) throw new ConvexError("First name is required");
    if (!fields.lastName || fields.lastName.length < 1) throw new ConvexError("Last name is required");
    assertCrewMemberFields(fields);

    // Idempotent by cuid (mirror convention — a retried create can't duplicate). A
    // cuid belonging to ANOTHER org is a cross-tenant collision → reject (else a false
    // CREATE audit lands in this org for a foreign row).
    const existing = await ctx.db
      .query("crewMembers")
      .withIndex("by_cuid", (q) => q.eq("id", fields.id))
      .first();
    if (existing && existing.organizationId !== fields.organizationId) throw new ConvexError("Crew member id already exists");
    if (!existing) {
      await ctx.db.insert("crewMembers", fields);
      await bumpCrewMemberCounters(ctx, fields.organizationId, null, fields);
    }

    await writeActivityLog(ctx, {
      id: auditId,
      organizationId: fields.organizationId,
      action: "CREATE",
      entityType: "crew_member",
      entityId: fields.id,
      entityName: `${fields.firstName} ${fields.lastName}`,
      userId: actor.userId,
      userName: actor.userName,
      summary: `Created crew member ${fields.firstName} ${fields.lastName}`,
      createdAt: fields.createdAt ?? fields.updatedAt ?? 0,
    });

    return { id: fields.id };
  },
});

export const updateNative = mutation({
  returns: v.object({ id: v.string() }),
  args: {
    id: v.string(),
    orgId: v.string(),
    // patchMember uses `set: v.any()` + clear[]; mirror it.
    set: v.any(),
    clear: v.array(v.string()),
    actor: actorValidator,
    auditId: v.string(),
    now: v.number(),
  },
  handler: async (ctx, { id, orgId, set, clear, actor: suppliedActor, auditId, now }) => {
    await assertWritesEnabled(ctx, "crew");
    await enforceBrowserWriteLimit(ctx);
    await requireOrgPermission(ctx, orgId, "crew", "update");
    const actor = await resolveActor(ctx, suppliedActor);

    const doc = await ctx.db.query("crewMembers").withIndex("by_cuid", (q) => q.eq("id", id)).first();
    if (!doc) throw new ConvexError("Crew member not found: " + id);
    if (doc.organizationId !== orgId) throw new ConvexError("Forbidden: organization mismatch.");

    // Apply set (+ clear-to-null) — the patchMember pattern.
    const NEVER_CLEAR = new Set(["id", "organizationId"]);
    const setObj = sanitizeClientSet(set); // strip organizationId/id — no cross-tenant reassign
    // R-8.6.2 — the create path already re-enforces crewMemberSchema's bounds; a
    // direct-mutation caller could otherwise skip them on update by only ever calling
    // updateNative with an out-of-bound value.
    assertCrewMemberFields(setObj);
    // Org-validate reassigned FKs; the linked user is validated only when CHANGED so a
    // former member on an existing row can still be re-saved.
    if (typeof setObj.crewRoleId === "string") await assertRefInOrg(ctx, "crewRoles", setObj.crewRoleId, orgId);
    if (typeof setObj.userId === "string" && setObj.userId !== doc.userId) await assertMemberInOrg(ctx, orgId, setObj.userId);
    const { _id, _creationTime, ...beforeRest } = doc;
    const afterRest: Record<string, unknown> = { ...beforeRest, ...setObj };
    for (const k of clear) { if (!NEVER_CLEAR.has(k)) delete afterRest[k]; }
    if (clear.length === 0) {
      await ctx.db.patch(doc._id, setObj);
      await bumpCrewMemberCounters(ctx, orgId, doc, { ...doc, ...setObj });
    } else {
      await ctx.db.replace(doc._id, afterRest as typeof beforeRest);
      await bumpCrewMemberCounters(ctx, orgId, doc, afterRest);
    }

    // Compute the audit field-diff in-transaction (parity — the old updateCrewMember
    // built `details.changes` from before→after over CREW_AUDIT_FIELDS).
    const entityName = `${afterRest.firstName ?? doc.firstName} ${afterRest.lastName ?? doc.lastName}`;
    const changes = buildChanges(beforeRest, afterRest, CREW_AUDIT_FIELDS);
    await writeActivityLog(ctx, {
      id: auditId,
      organizationId: orgId,
      action: "UPDATE",
      entityType: "crew_member",
      entityId: id,
      entityName,
      userId: actor.userId,
      userName: actor.userName,
      summary: `Updated crew member ${entityName}`,
      details: changes.length > 0 ? { changes } : undefined,
      createdAt: now,
    });

    return { id };
  },
});

/**
 * deleteNative — remove a crew member row + DELETE audit, atomic. RBAC(crew, delete).
 * Option A: the server action runs the scheduling cascade (assignments→shifts/time-
 * entries, availability) via the existing mutations first; this does the final member-
 * row delete + audit.
 */
export const deleteNative = mutation({
  returns: v.object({ id: v.string() }),
  args: {
    id: v.string(),
    orgId: v.string(),
    actor: actorValidator,
    auditId: v.string(),
    now: v.number(),
  },
  handler: async (ctx, { id, orgId, actor: suppliedActor, auditId, now }) => {
    await assertWritesEnabled(ctx, "crew");
    await enforceBrowserWriteLimit(ctx);
    await requireOrgPermission(ctx, orgId, "crew", "delete");
    const actor = await resolveActor(ctx, suppliedActor);
    const doc = await ctx.db.query("crewMembers").withIndex("by_cuid", (q) => q.eq("id", id)).first();
    if (!doc) throw new ConvexError({ code: "NOT_FOUND", message: "Crew member not found." });
    if (doc.organizationId !== orgId) throw new ConvexError("Forbidden: organization mismatch.");
    const name = `${doc.firstName} ${doc.lastName}`;

    // Scheduling cascade (folded in — was 3 separate server round-trips). All by
    // by_crewMemberId (GLOBAL) → org-filtered. Assignments cascade to their shifts +
    // linked time entries; then the member's standalone time entries + availabilities.
    const assignments = (await ctx.db.query("crewAssignments").withIndex("by_crewMemberId", (q) => q.eq("crewMemberId", id)).collect())
      .filter((a) => a.organizationId === orgId);
    for (const a of assignments) {
      const shifts = await ctx.db.query("crewShifts").withIndex("by_assignmentId", (q) => q.eq("assignmentId", a.id)).collect();
      for (const s of shifts) await ctx.db.delete(s._id);
      const linked = (await ctx.db.query("crewTimeEntries").withIndex("by_assignmentId", (q) => q.eq("assignmentId", a.id)).collect())
        .filter((e) => e.organizationId === orgId);
      for (const e of linked) await ctx.db.delete(e._id);
      await ctx.db.delete(a._id);
      await bumpCountersForTable(ctx, "crewAssignments", a, null);
    }
    const standalone = (await ctx.db.query("crewTimeEntries").withIndex("by_crewMemberId", (q) => q.eq("crewMemberId", id)).collect())
      .filter((t) => t.organizationId === orgId && t.assignmentId == null);
    for (const t of standalone) await ctx.db.delete(t._id);
    const avails = (await ctx.db.query("crewAvailabilities").withIndex("by_crewMemberId", (q) => q.eq("crewMemberId", id)).collect())
      .filter((av) => av.organizationId == null || av.organizationId === orgId);
    for (const av of avails) await ctx.db.delete(av._id);

    await ctx.db.delete(doc._id);
    await bumpCrewMemberCounters(ctx, orgId, doc, null);

    await writeActivityLog(ctx, {
      id: auditId,
      organizationId: orgId,
      action: "DELETE",
      entityType: "crew_member",
      entityId: id,
      entityName: name,
      userId: actor.userId,
      userName: actor.userName,
      summary: `Deleted crew member ${name}`,
      details: { deleted: { name } },
      createdAt: now,
    });

    return { id };
  },
});

export const agentOps: AgentOpsAnnotations = {
  createNative: { danger: "medium" },
  // Cascades into assignments, shifts, linked time entries, and
  // availabilities on top of the member row itself — delete category.
  deleteNative: { danger: "high" },
  updateNative: { danger: "medium" },
};
