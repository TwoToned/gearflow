import { v, ConvexError } from "convex/values";
import { mutation } from "./_generated/server";
import { requireOrgPermission, resolveActor } from "./lib/auth";
import { assertWritesEnabled } from "./lib/writeGuard";
import { enforceBrowserWriteLimit } from "./lib/rateLimiter";
import { writeActivityLog } from "./lib/audit";
import { assertRefInOrg } from "./lib/orgRef";
import { assertStrLen, assertNumRange } from "./lib/fieldGuards";

/**
 * Native ServiceSchedule write mutations (WS6 #945 — recurring preventative
 * maintenance). A schedule is model-wide, fixed-calendar cadence (interval
 * months + anchor date) — see convex/lib/serviceScheduleCore.ts for the due-date
 * math and convex/maintenanceScheduleGeneration.ts for the daily cron that reads
 * these rows to generate cycles.
 *
 * Gated on the `maintenance` resource (create/update/delete) — schedules are
 * part of the maintenance domain, same as the records they generate; there is
 * no separate `serviceSchedule` RESOURCES entry (R-8.4.4 — reuse, don't fork,
 * the permission map for a sibling concept in the same domain).
 *
 * Security bar (CLAUDE.md order): assertWritesEnabled -> enforceBrowserWriteLimit
 * -> requireOrgPermission -> resolveActor. Every doc fetched by the GLOBAL
 * by_cuid index is re-checked against the caller's org. ConvexError only.
 */

const actorValidator = v.object({ userId: v.string(), userName: v.string() });

function assertScheduleFields(a: { name: string; intervalMonths: number; instructions?: string }): void {
  assertStrLen(a.name, "name", { min: 1, max: 200 });
  assertNumRange(a.intervalMonths, "intervalMonths", { min: 1, max: 120, integer: true });
  assertStrLen(a.instructions, "instructions", { max: 5000 });
}

export const createNative = mutation({
  returns: v.object({ id: v.string() }),
  args: {
    orgId: v.string(),
    id: v.string(),
    modelId: v.string(),
    name: v.string(),
    intervalMonths: v.number(),
    anchorDate: v.number(),
    instructions: v.optional(v.string()),
    isActive: v.optional(v.boolean()),
    now: v.number(),
    actor: actorValidator,
    auditId: v.string(),
  },
  handler: async (ctx, a) => {
    await assertWritesEnabled(ctx, "maintenance");
    await enforceBrowserWriteLimit(ctx);
    await requireOrgPermission(ctx, a.orgId, "maintenance", "create");
    const actor = await resolveActor(ctx, a.actor);
    assertScheduleFields(a);

    await assertRefInOrg(ctx, "models", a.modelId, a.orgId);

    const dup = await ctx.db.query("serviceSchedules").withIndex("by_cuid", (q) => q.eq("id", a.id)).first();
    if (dup) throw new ConvexError("Service schedule already exists");

    await ctx.db.insert("serviceSchedules", {
      id: a.id,
      organizationId: a.orgId,
      modelId: a.modelId,
      name: a.name,
      intervalMonths: a.intervalMonths,
      anchorDate: a.anchorDate,
      instructions: a.instructions || undefined,
      isActive: a.isActive ?? true,
      createdAt: a.now,
      updatedAt: a.now,
    });

    await writeActivityLog(ctx, {
      id: a.auditId,
      organizationId: a.orgId,
      action: "CREATE",
      entityType: "serviceSchedule",
      entityId: a.id,
      entityName: a.name,
      userId: actor.userId,
      userName: actor.userName,
      summary: `Created service schedule: ${a.name}`,
      createdAt: a.now,
    });
    return { id: a.id };
  },
});

export const updateNative = mutation({
  returns: v.object({ id: v.string() }),
  args: {
    orgId: v.string(),
    id: v.string(),
    name: v.string(),
    intervalMonths: v.number(),
    anchorDate: v.number(),
    instructions: v.optional(v.string()),
    isActive: v.optional(v.boolean()),
    now: v.number(),
    actor: actorValidator,
    auditId: v.string(),
  },
  handler: async (ctx, a) => {
    await assertWritesEnabled(ctx, "maintenance");
    await enforceBrowserWriteLimit(ctx);
    await requireOrgPermission(ctx, a.orgId, "maintenance", "update");
    const actor = await resolveActor(ctx, a.actor);
    assertScheduleFields(a);

    const doc = await ctx.db.query("serviceSchedules").withIndex("by_cuid", (q) => q.eq("id", a.id)).unique();
    if (!doc || doc.organizationId !== a.orgId) throw new ConvexError("Service schedule not found");

    // modelId is NOT editable post-create (the schedule's identity is tied to a
    // model; re-pointing it would silently orphan already-generated cycles'
    // provenance) — only cadence/name/instructions/active state change here.
    await ctx.db.patch(doc._id, {
      name: a.name,
      intervalMonths: a.intervalMonths,
      anchorDate: a.anchorDate,
      instructions: a.instructions || undefined,
      isActive: a.isActive ?? true,
      updatedAt: a.now,
    });

    await writeActivityLog(ctx, {
      id: a.auditId,
      organizationId: a.orgId,
      action: "UPDATE",
      entityType: "serviceSchedule",
      entityId: a.id,
      entityName: a.name,
      userId: actor.userId,
      userName: actor.userName,
      summary: `Updated service schedule: ${a.name}`,
      createdAt: a.now,
    });
    return { id: a.id };
  },
});

/**
 * Deactivate (soft-delete) a schedule — never a hard delete, so historical
 * generated cycles keep a valid `serviceScheduleId` reference. Deactivating
 * stops future generation (the cron only sweeps `isActive !== false` rows); it
 * does NOT touch any already-generated maintenanceRecords rows.
 */
export const deactivateNative = mutation({
  returns: v.object({ id: v.string() }),
  args: {
    orgId: v.string(),
    id: v.string(),
    now: v.number(),
    actor: actorValidator,
    auditId: v.string(),
  },
  handler: async (ctx, a) => {
    await assertWritesEnabled(ctx, "maintenance");
    await enforceBrowserWriteLimit(ctx);
    await requireOrgPermission(ctx, a.orgId, "maintenance", "delete");
    const actor = await resolveActor(ctx, a.actor);

    const doc = await ctx.db.query("serviceSchedules").withIndex("by_cuid", (q) => q.eq("id", a.id)).unique();
    if (!doc || doc.organizationId !== a.orgId) throw new ConvexError("Service schedule not found");

    await ctx.db.patch(doc._id, { isActive: false, updatedAt: a.now });

    await writeActivityLog(ctx, {
      id: a.auditId,
      organizationId: a.orgId,
      action: "DELETE",
      entityType: "serviceSchedule",
      entityId: a.id,
      entityName: doc.name,
      userId: actor.userId,
      userName: actor.userName,
      summary: `Deactivated service schedule: ${doc.name}`,
      createdAt: a.now,
    });
    return { id: a.id };
  },
});
