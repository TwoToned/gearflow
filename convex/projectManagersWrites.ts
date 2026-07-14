import { v, ConvexError } from "convex/values";
import { mutation } from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import { requireOrgPermission, resolveActor, type Actor } from "./lib/auth";
import { assertWritesEnabled } from "./lib/writeGuard";
import { enforceBrowserWriteLimit } from "./lib/rateLimiter";
import { writeActivityLog } from "./lib/audit";

/**
 * Native PROJECT-MANAGER write mutations (Phase 3 browser-direct — replaces the
 * addProjectManager/removeProjectManager/setProjectManagers server actions in
 * src/server/project-managers.ts). Gates on `project:manage` (owner-only via the shared
 * permissionsCore wildcard — exact parity with the deleted action's requirePermission).
 *
 * The old actions kept a Prisma seam (member validation + user-label lookup on the Better
 * Auth `member`/`user` tables). Those are MIRRORED into Convex (`members` by_org_user,
 * `users` by_cuid — the same mirrors requireOrgPermission/resolveActor already use), so
 * this is fully browser-direct with NO server round-trip. Standard shape: 4 guards +
 * per-row org re-check on the project + membership validation + atomic per-change audit.
 */

const actorValidator = v.object({ userId: v.string(), userName: v.string() });

/** Confirm the project exists in the caller's org (by_cuid is global). */
async function requireProjectInOrg(ctx: MutationCtx, projectId: string, orgId: string) {
  const project = await ctx.db.query("projects").withIndex("by_cuid", (q) => q.eq("id", projectId)).first();
  if (!project || project.organizationId !== orgId) throw new ConvexError("Project not found");
  return project;
}

/**
 * Reject only if the project EXISTS in a DIFFERENT org (a missing/deleted project stays
 * removable so an orphaned assignment can still be cleaned up). Used by removeNative so a
 * caller can't delete an org-scoped row that references another org's project + emit a
 * cross-org audit — without the strict "must exist" check blocking orphan cleanup.
 */
async function assertProjectNotInOtherOrg(ctx: MutationCtx, projectId: string, orgId: string) {
  const project = await ctx.db.query("projects").withIndex("by_cuid", (q) => q.eq("id", projectId)).first();
  if (project && project.organizationId !== orgId) throw new ConvexError("Project not found");
}

/** Throw unless `userId` is a member of `orgId` (Better Auth member, mirrored to Convex). */
async function assertOrgMember(ctx: MutationCtx, orgId: string, userId: string) {
  const member = await ctx.db
    .query("members")
    .withIndex("by_org_user", (q) => q.eq("organizationId", orgId).eq("userId", userId))
    .first();
  if (!member) throw new ConvexError("User is not a member of this organization");
}

/**
 * Resolve a user's audit label from the users mirror (name → email → id). Uses `||`,
 * not `??`: the Convex `users.name` is a required string that stores "" for a user with
 * no name, so a blank name must fall back to email (parity with the Prisma-nullable
 * `user.name ?? user.email` the deleted action used).
 */
async function userLabel(ctx: MutationCtx, userId: string): Promise<string> {
  const u = await ctx.db.query("users").withIndex("by_cuid", (q) => q.eq("id", userId)).first();
  return u?.name || u?.email || userId;
}

async function logManagerChange(
  ctx: MutationCtx,
  args: { orgId: string; projectId: string; actor: Actor; auditId: string; now: number; label: string; verb: "Added" | "Removed" },
) {
  await writeActivityLog(ctx, {
    id: args.auditId,
    organizationId: args.orgId,
    action: "updated",
    entityType: "project",
    entityId: args.projectId,
    projectId: args.projectId,
    entityName: args.label,
    userId: args.actor.userId,
    userName: args.actor.userName,
    summary: `${args.verb} ${args.label} as project manager`,
    createdAt: args.now,
  });
}

export const addNative = mutation({
  returns: v.object({ ok: v.boolean() }),
  args: {
    id: v.string(),
    projectId: v.string(),
    orgId: v.string(),
    userId: v.string(),
    now: v.number(),
    actor: actorValidator,
    auditId: v.string(),
  },
  handler: async (ctx, { id, projectId, orgId, userId, now, actor: suppliedActor, auditId }) => {
    await assertWritesEnabled(ctx, "projectManager");
    await enforceBrowserWriteLimit(ctx);
    await requireOrgPermission(ctx, orgId, "project", "manage");
    const actor = await resolveActor(ctx, suppliedActor);

    await requireProjectInOrg(ctx, projectId, orgId);
    await assertOrgMember(ctx, orgId, userId);

    // Dedupe on (projectId, userId) — idempotent add (matches createIfMissing intent).
    const existing = await ctx.db
      .query("projectManagers")
      .withIndex("by_projectId_userId", (q) => q.eq("projectId", projectId).eq("userId", userId))
      .first();
    if (existing) return { ok: true };

    await ctx.db.insert("projectManagers", { id, organizationId: orgId, projectId, userId, addedAt: now });
    await logManagerChange(ctx, { orgId, projectId, actor, auditId, now, label: await userLabel(ctx, userId), verb: "Added" });
    return { ok: true };
  },
});

export const removeNative = mutation({
  returns: v.object({ ok: v.boolean() }),
  args: {
    projectId: v.string(),
    orgId: v.string(),
    userId: v.string(),
    now: v.number(),
    actor: actorValidator,
    auditId: v.string(),
  },
  handler: async (ctx, { projectId, orgId, userId, now, actor: suppliedActor, auditId }) => {
    await assertWritesEnabled(ctx, "projectManager");
    await enforceBrowserWriteLimit(ctx);
    await requireOrgPermission(ctx, orgId, "project", "manage");
    const actor = await resolveActor(ctx, suppliedActor);

    await assertProjectNotInOtherOrg(ctx, projectId, orgId);
    const row = await ctx.db
      .query("projectManagers")
      .withIndex("by_projectId_userId", (q) => q.eq("projectId", projectId).eq("userId", userId))
      .first();
    if (!row || row.organizationId !== orgId) throw new ConvexError("Project manager assignment not found");

    await ctx.db.delete(row._id);
    await logManagerChange(ctx, { orgId, projectId, actor, auditId, now, label: await userLabel(ctx, userId), verb: "Removed" });
    return { ok: true };
  },
});

/**
 * Set a project's managers to exactly `userIds` in ONE atomic mutation (the wizard's
 * bulk sync). Diff is computed server-side; every added user must be an org member.
 * Per-add / per-remove audit rows (labels resolved from the users mirror).
 */
export const setNative = mutation({
  returns: v.object({ added: v.array(v.string()), removed: v.array(v.string()) }),
  args: {
    projectId: v.string(),
    orgId: v.string(),
    userIds: v.array(v.string()),
    now: v.number(),
    actor: actorValidator,
    auditPrefix: v.string(),
  },
  handler: async (ctx, { projectId, orgId, userIds, now, actor: suppliedActor, auditPrefix }) => {
    await assertWritesEnabled(ctx, "projectManager");
    await enforceBrowserWriteLimit(ctx);
    await requireOrgPermission(ctx, orgId, "project", "manage");
    const actor = await resolveActor(ctx, suppliedActor);
    await requireProjectInOrg(ctx, projectId, orgId);

    const desired = [...new Set(userIds)];
    const desiredSet = new Set(desired);
    const current = await ctx.db
      .query("projectManagers")
      .withIndex("by_projectId", (q) => q.eq("projectId", projectId))
      .collect();
    const currentOrg = current.filter((r) => r.organizationId === orgId);
    const currentUserIds = new Set(currentOrg.map((r) => r.userId));

    const toAdd = desired.filter((uid) => !currentUserIds.has(uid));
    const toRemove = currentOrg.filter((r) => !desiredSet.has(r.userId));

    // Validate every added user is an org member before mutating anything.
    for (const uid of toAdd) await assertOrgMember(ctx, orgId, uid);

    let i = 0;
    for (const uid of toAdd) {
      // Re-check dedupe on (projectId, userId) in case of a concurrent add.
      const dup = await ctx.db
        .query("projectManagers")
        .withIndex("by_projectId_userId", (q) => q.eq("projectId", projectId).eq("userId", uid))
        .first();
      if (!dup) {
        await ctx.db.insert("projectManagers", { id: `${auditPrefix}_pm_${i}`, organizationId: orgId, projectId, userId: uid, addedAt: now });
      }
      await logManagerChange(ctx, { orgId, projectId, actor, auditId: `${auditPrefix}_a_${i}`, now, label: await userLabel(ctx, uid), verb: "Added" });
      i += 1;
    }
    for (const r of toRemove) {
      await ctx.db.delete(r._id);
      await logManagerChange(ctx, { orgId, projectId, actor, auditId: `${auditPrefix}_r_${i}`, now, label: await userLabel(ctx, r.userId), verb: "Removed" });
      i += 1;
    }

    return { added: toAdd, removed: toRemove.map((r) => r.userId) };
  },
});
