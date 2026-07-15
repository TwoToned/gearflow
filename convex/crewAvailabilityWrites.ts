import { v, ConvexError } from "convex/values";
import { mutation } from "./_generated/server";
import { requireOrgPermission, resolveActor } from "./lib/auth";
import { assertWritesEnabled } from "./lib/writeGuard";
import { enforceBrowserWriteLimit } from "./lib/rateLimiter";
import { writeActivityLog } from "./lib/audit";
import * as enums from "./lib/validators";

/**
 * Native CREW-AVAILABILITY write mutations (Phase 3 browser-direct — replaces
 * addAvailability/removeAvailability in src/server/crew-availability.ts). Gates on
 * crew:update. Availability scopes via the crew member, so both ops verify the member
 * belongs to the caller's org. Dates arrive as epoch-ms from the hook.
 */

const actorValidator = v.object({ userId: v.string(), userName: v.string() });

export const addNative = mutation({
  returns: v.object({ id: v.string() }),
  args: {
    id: v.string(),
    orgId: v.string(),
    crewMemberId: v.string(),
    startDate: v.number(),
    endDate: v.number(),
    type: enums.AvailabilityType,
    reason: v.optional(v.string()),
    isAllDay: v.boolean(),
    startTime: v.optional(v.string()),
    endTime: v.optional(v.string()),
    now: v.number(),
    actor: actorValidator,
    auditId: v.string(),
  },
  handler: async (ctx, a) => {
    await assertWritesEnabled(ctx, "crewAvailability");
    await enforceBrowserWriteLimit(ctx);
    await requireOrgPermission(ctx, a.orgId, "crew", "update");
    const actor = await resolveActor(ctx, a.actor);

    // Boundary validation (parity with crewAvailabilitySchema — the mutation is the
    // public boundary; the hook's zod runs client-side only).
    if (a.reason !== undefined && a.reason.length > 500) throw new ConvexError("Reason must be 500 characters or fewer");
    if (a.startTime !== undefined && a.startTime.length > 5) throw new ConvexError("Invalid start time");
    if (a.endTime !== undefined && a.endTime.length > 5) throw new ConvexError("Invalid end time");

    const member = await ctx.db.query("crewMembers").withIndex("by_cuid", (q) => q.eq("id", a.crewMemberId)).first();
    if (!member || member.organizationId !== a.orgId) throw new ConvexError("Crew member not found");

    const dup = await ctx.db.query("crewAvailabilities").withIndex("by_cuid", (q) => q.eq("id", a.id)).first();
    if (dup) throw new ConvexError("Availability record already exists");

    await ctx.db.insert("crewAvailabilities", {
      id: a.id, crewMemberId: a.crewMemberId, organizationId: a.orgId,
      startDate: a.startDate, endDate: a.endDate, type: a.type,
      reason: a.reason || undefined, isAllDay: a.isAllDay,
      startTime: a.startTime || undefined, endTime: a.endTime || undefined,
      createdAt: a.now, updatedAt: a.now,
    });

    await writeActivityLog(ctx, {
      id: a.auditId, organizationId: a.orgId, action: "UPDATE", entityType: "crew_member",
      entityId: a.crewMemberId, entityName: `${member.firstName} ${member.lastName}`,
      userId: actor.userId, userName: actor.userName,
      summary: `Added ${a.type.toLowerCase()} availability for ${member.firstName} ${member.lastName}`, createdAt: a.now,
    });
    return { id: a.id };
  },
});

export const removeNative = mutation({
  returns: v.object({ ok: v.boolean() }),
  args: { id: v.string(), orgId: v.string(), now: v.number(), actor: actorValidator },
  handler: async (ctx, a) => {
    await assertWritesEnabled(ctx, "crewAvailability");
    await enforceBrowserWriteLimit(ctx);
    await requireOrgPermission(ctx, a.orgId, "crew", "update");
    await resolveActor(ctx, a.actor);

    const record = await ctx.db.query("crewAvailabilities").withIndex("by_cuid", (q) => q.eq("id", a.id)).first();
    if (!record) throw new ConvexError("Availability record not found");
    // Availability scopes via its crew member — confirm the member is in this org.
    const member = await ctx.db.query("crewMembers").withIndex("by_cuid", (q) => q.eq("id", record.crewMemberId)).first();
    if (!member || member.organizationId !== a.orgId) throw new ConvexError("Availability record not found");

    await ctx.db.delete(record._id);
    return { ok: true };
  },
});
