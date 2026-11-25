import { v, ConvexError } from "convex/values";
import { mutation } from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
import { requireOrgPermission, resolveActor } from "./lib/auth";
import type { AgentOpsAnnotations } from "./lib/agentOps";
import { diffFields, recordFieldEdit, undoFieldEdit } from "./lib/fieldEditUndo";
import { assertMemberInOrg } from "./lib/orgRef";
import { assertBulkSizeOk, enforceBrowserWriteLimit } from "./lib/rateLimiter";
import { assertWritesEnabled } from "./lib/writeGuard";
import { isOpenMaintenance } from "./lib/maintenanceOpen";

/**
 * UX Phase 14 (14a-3) bulk verbs on the Maintenance list: `Reschedule…` and `Assign…`. Each changes ONE field
 * on every selected OPEN record (a finished or cancelled record is skipped and counted, never edited), writes
 * one field-edit audit row per changed record (`convex/lib/fieldEditUndo.ts`), and returns those ids: the
 * toast's Undo (`undoBulkEditNative`) takes ids only, refuses the whole batch, changing nothing, unless every
 * row is the caller's, inside the window, first undo, and nothing changed since.
 *
 * Neither verb moves an asset: a record's hold on its assets follows its STATUS, which these do not touch.
 */

const actorValidator = v.object({ userId: v.string(), userName: v.string() });

/** The fields these verbs write, so the Undo restores nothing else. */
const BULK_FIELDS = ["scheduledDate", "assignedToId"] as const;

interface BulkResult {
  count: number;
  skipped: number;
  auditIds: string[];
}

/** Org-checked record by cuid (`by_cuid` is global), or null. */
async function orgRecord(ctx: MutationCtx, orgId: string, id: string): Promise<Doc<"maintenanceRecords"> | null> {
  const doc = await ctx.db.query("maintenanceRecords").withIndex("by_cuid", (q) => q.eq("id", id)).first();
  return doc && doc.organizationId === orgId ? doc : null;
}

/** Apply one field change to every selected open record; one audit row per record that actually changed. */
async function applyBulk(
  ctx: MutationCtx,
  a: { orgId: string; ids: string[]; auditId: string; now: number; actor: { userId: string; userName: string } },
  field: (typeof BULK_FIELDS)[number],
  value: number | string | undefined,
  label: string,
): Promise<BulkResult> {
  const ids = [...new Set(a.ids)];
  if (ids.length === 0) throw new ConvexError("Nothing selected");
  const result: BulkResult = { count: 0, skipped: 0, auditIds: [] };
  for (const id of ids) {
    const doc = await orgRecord(ctx, a.orgId, id);
    if (!doc) throw new ConvexError("Maintenance record not found");
    if (!isOpenMaintenance(doc.status)) {
      result.skipped++;
      continue;
    }
    const diff = diffFields(doc, { ...doc, [field]: value }, [field]);
    if (!diff) continue;
    await ctx.db.patch(doc._id, { [field]: value, updatedAt: a.now });
    const auditId = `${a.auditId}:${doc.id}`;
    await recordFieldEdit(ctx, { orgId: a.orgId, entityType: "maintenance", entityId: doc.id, entityName: doc.title, auditId, actor: a.actor, summary: `${label} on ${doc.title}`, diff, now: a.now });
    result.auditIds.push(auditId);
    result.count++;
  }
  return result;
}

const resultValidator = v.object({ count: v.number(), skipped: v.number(), auditIds: v.array(v.string()) });

export const bulkRescheduleNative = mutation({
  returns: resultValidator,
  args: { orgId: v.string(), ids: v.array(v.string()), scheduledDate: v.number(), now: v.number(), actor: actorValidator, auditId: v.string() },
  handler: async (ctx, a) => {
    await assertWritesEnabled(ctx, "maintenance");
    await enforceBrowserWriteLimit(ctx);
    await requireOrgPermission(ctx, a.orgId, "maintenance", "update");
    const actor = await resolveActor(ctx, a.actor);
    await assertBulkSizeOk(ctx, a.ids.length);
    if (!Number.isFinite(a.scheduledDate) || a.scheduledDate <= 0) throw new ConvexError("Choose a valid date");
    return applyBulk(ctx, { ...a, actor }, "scheduledDate", a.scheduledDate, "Rescheduled");
  },
});

export const bulkAssignNative = mutation({
  returns: resultValidator,
  args: { orgId: v.string(), ids: v.array(v.string()), assignedToId: v.union(v.string(), v.null()), now: v.number(), actor: actorValidator, auditId: v.string() },
  handler: async (ctx, a) => {
    await assertWritesEnabled(ctx, "maintenance");
    await enforceBrowserWriteLimit(ctx);
    await requireOrgPermission(ctx, a.orgId, "maintenance", "update");
    const actor = await resolveActor(ctx, a.actor);
    await assertBulkSizeOk(ctx, a.ids.length);
    if (a.assignedToId) await assertMemberInOrg(ctx, a.orgId, a.assignedToId);
    return applyBulk(ctx, { ...a, actor }, "assignedToId", a.assignedToId ?? undefined, a.assignedToId ? "Assigned" : "Unassigned");
  },
});

/** The exact Undo of both verbs (ids only, all or nothing). */
export const undoBulkEditNative = mutation({
  returns: v.object({ restored: v.number() }),
  args: { orgId: v.string(), auditIds: v.array(v.string()), now: v.number(), actor: actorValidator },
  handler: async (ctx, a) => {
    await assertWritesEnabled(ctx, "maintenance");
    await enforceBrowserWriteLimit(ctx);
    await requireOrgPermission(ctx, a.orgId, "maintenance", "update");
    const actor = await resolveActor(ctx, a.actor);
    await assertBulkSizeOk(ctx, a.auditIds.length);
    if (a.auditIds.length === 0) throw new ConvexError("Nothing to undo");
    const unique = [...new Set(a.auditIds)];
    for (const auditId of unique) {
      const row = await ctx.db.query("activityLogs").withIndex("by_cuid", (q) => q.eq("id", auditId)).first();
      if (!row || row.organizationId !== a.orgId || row.entityType !== "maintenance") throw new ConvexError("This change can't be undone");
      await undoFieldEdit(ctx, {
        orgId: a.orgId, entityType: "maintenance", entityId: row.entityId, entityName: row.entityName, auditId, actor, now: a.now,
        load: async () => orgRecord(ctx, a.orgId, row.entityId),
        apply: async (doc, plan) => {
          const unsupported = [...Object.keys(plan.set), ...plan.clear].filter((f) => !(BULK_FIELDS as readonly string[]).includes(f));
          if (unsupported.length > 0) throw new ConvexError("This change can't be undone");
          // The record moved on (completed, cancelled): putting an old date or assignee back would rewrite its history.
          if (!isOpenMaintenance(doc.status)) throw new ConvexError({ code: "CHANGED_SINCE", message: "Can't undo: that record was completed or closed since." });
          const patch: Record<string, unknown> = { ...plan.set, updatedAt: a.now };
          for (const f of plan.clear) patch[f] = undefined;
          await ctx.db.patch(doc._id, patch);
        },
      });
    }
    return { restored: unique.length };
  },
});

export const agentOps: AgentOpsAnnotations = {
  bulkRescheduleNative: { danger: "medium", summary: "Move the scheduled date of several open maintenance records (finished ones are skipped)." },
  bulkAssignNative: { danger: "medium", summary: "Assign (or unassign) several open maintenance records to a member (finished ones are skipped)." },
  undoBulkEditNative: { danger: "high", summary: "Exactly undo a recent bulk reschedule or assign by its audit ids (refuses if a field changed since)." },
};
