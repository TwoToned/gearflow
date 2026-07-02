import { v, ConvexError } from "convex/values";
import { mutation } from "./_generated/server";
import { requireOrgPermission } from "./lib/auth";
import { writeActivityLog } from "./lib/audit";
import * as enums from "./lib/validators";

/**
 * Native CREW write mutations (Phase 5) — same pattern as assetWrites/kitWrites:
 * RBAC(requireOrgPermission "crew") + atomic audit(writeActivityLog) in one
 * transaction. Additive; the generated convex/crewMembers.ts service mutations are
 * untouched. Gated behind NATIVE_CREW_WRITES in src/server/crew.ts.
 *
 * Covers create + update (crew has no unique-tag invariant). deleteCrewMember has a
 * multi-table scheduling cascade (assignments → shifts/time-entries, availability) —
 * a separate slice.
 */

const actorValidator = v.object({ userId: v.string(), userName: v.string() });

export const createNative = mutation({
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
    const { actor, auditId, ...fields } = args;
    await requireOrgPermission(ctx, fields.organizationId, "crew", "create");

    // Idempotent by cuid (mirror convention — a retried create can't duplicate).
    const existing = await ctx.db
      .query("crewMembers")
      .withIndex("by_cuid", (q) => q.eq("id", fields.id))
      .first();
    if (!existing) {
      await ctx.db.insert("crewMembers", fields);
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
  args: {
    id: v.string(),
    orgId: v.string(),
    // patchMember uses `set: v.any()` + clear[]; mirror it.
    set: v.any(),
    clear: v.array(v.string()),
    entityName: v.string(),
    details: v.optional(v.any()),
    actor: actorValidator,
    auditId: v.string(),
    now: v.number(),
  },
  handler: async (ctx, { id, orgId, set, clear, entityName, details, actor, auditId, now }) => {
    await requireOrgPermission(ctx, orgId, "crew", "update");

    const doc = await ctx.db.query("crewMembers").withIndex("by_cuid", (q) => q.eq("id", id)).first();
    if (!doc) throw new ConvexError("Crew member not found: " + id);
    if (doc.organizationId !== orgId) throw new ConvexError("Forbidden: organization mismatch.");

    // Apply set (+ clear-to-null) — the patchMember pattern.
    const NEVER_CLEAR = new Set(["id", "organizationId"]);
    if (clear.length === 0) {
      await ctx.db.patch(doc._id, set as Record<string, unknown>);
    } else {
      const { _id, _creationTime, ...rest } = doc;
      const merged: Record<string, unknown> = { ...rest, ...(set as Record<string, unknown>) };
      for (const k of clear) {
        if (NEVER_CLEAR.has(k)) continue;
        delete merged[k];
      }
      await ctx.db.replace(doc._id, merged as typeof rest);
    }

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
      details,
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
  args: {
    id: v.string(),
    orgId: v.string(),
    name: v.string(),
    actor: actorValidator,
    auditId: v.string(),
    now: v.number(),
  },
  handler: async (ctx, { id, orgId, name, actor, auditId, now }) => {
    await requireOrgPermission(ctx, orgId, "crew", "delete");
    const doc = await ctx.db.query("crewMembers").withIndex("by_cuid", (q) => q.eq("id", id)).first();
    if (!doc) throw new ConvexError({ code: "NOT_FOUND", message: "Crew member not found." });
    if (doc.organizationId !== orgId) throw new ConvexError("Forbidden: organization mismatch.");

    await ctx.db.delete(doc._id);

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
