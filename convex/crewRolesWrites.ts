import { v, ConvexError } from "convex/values";
import { mutation } from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import { requireOrgPermission, resolveActor, type Actor } from "./lib/auth";
import type { AgentOpsAnnotations } from "./lib/agentOps";
import { assertWritesEnabled } from "./lib/writeGuard";
import { enforceBrowserWriteLimit } from "./lib/rateLimiter";
import { writeActivityLog } from "./lib/audit";
import { assertStrLen, assertNumRange } from "./lib/fieldGuards";
import { crewRoleUsage } from "./lib/crewRoleUsage";
import * as enums from "./lib/validators";

/**
 * Native CREW-ROLE write mutations (WS10 #949 — labour charge rates & margin).
 * `crewRoles` previously had zero write path: `convex/crewRoles.ts`'s mutations all
 * gate on `requireService` (trusted-backend-only) with no caller anywhere in `src/`
 * — a fully generated, never-wired CRUD stub. This file is the missing browser-
 * direct admin surface, standard shape (4 guards + per-row org re-check + atomic
 * audit), same pattern as `categoriesWrites.ts`. Gates on `crew:create`/`crew:update`
 * — per `rolePermissions` (convex/lib/permissionsCore.ts) only owner/admin/manager
 * hold those, so the write surface is already manager+-only; `crew:read` (held by
 * every role) is enough to VIEW the page, with cost/charge columns additionally
 * gated per-viewer (see `crewRoles.ts` `listForSettings`).
 *
 * No hard delete: a CrewRole is referenced from `crewMembers.crewRoleId`,
 * `crewAssignments.crewRoleId`, and `projectServices.crewRoleId` — deleting one
 * would either cascade (unacceptable — a role isn't "owned" by any single row) or
 * leave dangling FK references. `archiveNative` (isActive toggle) is the only
 * lifecycle op; it returns the current usage counts so the UI can show a
 * confirmation ("used by N crew members / M assignments") without the mutation
 * itself blocking anything — archiving is non-destructive (existing rows keep
 * their role; only new-assignment pickers stop offering it).
 */

const actorValidator = v.object({ userId: v.string(), userName: v.string() });

export const crewRoleFields = {
  name: v.string(),
  description: v.optional(v.string()),
  department: v.optional(v.string()),
  color: v.optional(v.string()),
  defaultRate: v.optional(v.number()),
  rateType: v.optional(enums.CrewRateType),
  chargeRate: v.optional(v.number()),
  sortOrder: v.optional(v.number()),
};

/**
 * Mirrors `crewRoleSchema` (src/lib/validations/crew.ts) string-length + rate
 * bounds — `v.string()`/`v.number()` only enforce type, not these business
 * constraints, so a browser-direct caller bypassing the client Zod parse would
 * otherwise skip them entirely (R-8.6.2).
 */
function assertCrewRoleFields(f: {
  name: string;
  description?: string;
  department?: string;
  color?: string;
  defaultRate?: number;
  chargeRate?: number;
  sortOrder?: number;
}): void {
  assertStrLen(f.name, "name", { min: 1, max: 100 });
  assertStrLen(f.description, "description", { max: 500 });
  assertStrLen(f.department, "department", { max: 100 });
  assertStrLen(f.color, "color", { max: 20 });
  assertNumRange(f.defaultRate, "defaultRate", { min: 0 });
  assertNumRange(f.chargeRate, "chargeRate", { min: 0 });
  assertNumRange(f.sortOrder, "sortOrder", { min: 0, integer: true });
}

async function logCrewRole(
  ctx: MutationCtx,
  a: { orgId: string; actor: Actor; auditId: string; now: number; action: string; id: string; name: string; summary: string },
) {
  await writeActivityLog(ctx, {
    id: a.auditId,
    organizationId: a.orgId,
    action: a.action,
    entityType: "crew_role",
    entityId: a.id,
    entityName: a.name,
    userId: a.actor.userId,
    userName: a.actor.userName,
    summary: a.summary,
    createdAt: a.now,
  });
}

export const createNative = mutation({
  returns: v.object({ id: v.string() }),
  args: {
    id: v.string(),
    orgId: v.string(),
    ...crewRoleFields,
    isActive: v.optional(v.boolean()),
    now: v.number(),
    actor: actorValidator,
    auditId: v.string(),
  },
  handler: async (ctx, a) => {
    await assertWritesEnabled(ctx, "crewRole");
    await enforceBrowserWriteLimit(ctx);
    await requireOrgPermission(ctx, a.orgId, "crew", "create");
    const actor = await resolveActor(ctx, a.actor);

    if (!a.name) throw new ConvexError("Name is required");
    assertCrewRoleFields(a);

    const existing = await ctx.db.query("crewRoles").withIndex("by_cuid", (q) => q.eq("id", a.id)).first();
    if (existing) {
      if (existing.organizationId !== a.orgId) throw new ConvexError("Crew role already exists");
      return { id: a.id }; // idempotent retry
    }

    const roles = await ctx.db.query("crewRoles").withIndex("by_organizationId", (q) => q.eq("organizationId", a.orgId)).collect(); // r9.8-ok: bounded per-org config set — see docs/exceptions.md R-8.3.3
    const sortOrder = a.sortOrder ?? roles.reduce((m, r) => Math.max(m, r.sortOrder ?? 0), -1) + 1;

    await ctx.db.insert("crewRoles", {
      id: a.id,
      organizationId: a.orgId,
      name: a.name,
      ...(a.description ? { description: a.description } : {}),
      ...(a.department ? { department: a.department } : {}),
      ...(a.color ? { color: a.color } : {}),
      ...(a.defaultRate != null ? { defaultRate: a.defaultRate } : {}),
      ...(a.rateType ? { rateType: a.rateType } : {}),
      ...(a.chargeRate != null ? { chargeRate: a.chargeRate } : {}),
      sortOrder,
      isActive: a.isActive ?? true,
    });

    await logCrewRole(ctx, { orgId: a.orgId, actor, auditId: a.auditId, now: a.now, action: "CREATE", id: a.id, name: a.name, summary: `Created crew role ${a.name}` });
    return { id: a.id };
  },
});

export const updateNative = mutation({
  returns: v.object({ id: v.string() }),
  args: {
    id: v.string(),
    orgId: v.string(),
    ...crewRoleFields,
    now: v.number(),
    actor: actorValidator,
    auditId: v.string(),
  },
  handler: async (ctx, a) => {
    await assertWritesEnabled(ctx, "crewRole");
    await enforceBrowserWriteLimit(ctx);
    await requireOrgPermission(ctx, a.orgId, "crew", "update");
    const actor = await resolveActor(ctx, a.actor);

    const doc = await ctx.db.query("crewRoles").withIndex("by_cuid", (q) => q.eq("id", a.id)).first();
    if (!doc || doc.organizationId !== a.orgId) throw new ConvexError("Crew role not found");

    if (!a.name) throw new ConvexError("Name is required");
    assertCrewRoleFields(a);

    // Clears use `undefined` (Convex removes the optional; the schema rejects null).
    await ctx.db.patch(doc._id, {
      name: a.name,
      description: a.description || undefined,
      department: a.department || undefined,
      color: a.color || undefined,
      defaultRate: a.defaultRate ?? undefined,
      rateType: a.rateType || undefined,
      chargeRate: a.chargeRate ?? undefined,
      sortOrder: a.sortOrder ?? doc.sortOrder ?? 0,
    });

    await logCrewRole(ctx, { orgId: a.orgId, actor, auditId: a.auditId, now: a.now, action: "UPDATE", id: a.id, name: a.name, summary: `Updated crew role ${a.name}` });
    return { id: a.id };
  },
});

/**
 * Toggle `isActive` (the only lifecycle op — see file header for why there's no
 * hard delete). Returns current usage counts (org-scoped) so the caller can show
 * a "used by N crew / M assignments / P services" confirmation BEFORE archiving —
 * archiving itself never blocks on usage, it's non-destructive.
 */
export const archiveNative = mutation({
  returns: v.object({
    id: v.string(),
    isActive: v.boolean(),
    usage: v.object({ crewMembers: v.number(), crewAssignments: v.number(), projectServices: v.number() }),
  }),
  args: { id: v.string(), orgId: v.string(), isActive: v.boolean(), now: v.number(), actor: actorValidator, auditId: v.string() },
  handler: async (ctx, a) => {
    await assertWritesEnabled(ctx, "crewRole");
    await enforceBrowserWriteLimit(ctx);
    await requireOrgPermission(ctx, a.orgId, "crew", "update");
    const actor = await resolveActor(ctx, a.actor);

    const doc = await ctx.db.query("crewRoles").withIndex("by_cuid", (q) => q.eq("id", a.id)).first();
    if (!doc || doc.organizationId !== a.orgId) throw new ConvexError("Crew role not found");

    await ctx.db.patch(doc._id, { isActive: a.isActive });
    const usage = await crewRoleUsage(ctx, a.id, a.orgId);

    const action = a.isActive ? "restored" : "archived";
    await logCrewRole(ctx, { orgId: a.orgId, actor, auditId: a.auditId, now: a.now, action: action.toUpperCase(), id: a.id, name: doc.name, summary: `${a.isActive ? "Restored" : "Archived"} crew role ${doc.name}` });
    return { id: a.id, isActive: a.isActive, usage };
  },
});

export const agentOps: AgentOpsAnnotations = {
  // Toggles isActive (archive/restore) — archive/lifecycle category is high
  // by rule regardless of this particular toggle's non-destructiveness.
  archiveNative: { danger: "high" },
  createNative: { danger: "medium" },
  updateNative: { danger: "medium" },
};
