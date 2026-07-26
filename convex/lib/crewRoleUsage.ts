import type { QueryCtx, MutationCtx } from "../_generated/server";

/**
 * Usage counts for a CrewRole, org-scoped (WS10 #949 — archive-with-usage-guard).
 * Shared by `crewRoles.ts`'s read-only `usage` query (the pre-check the settings
 * page calls before confirming an archive) and `crewRolesWrites.ts`'s
 * `archiveNative` (which returns the post-toggle counts too) — one implementation,
 * not two hand-maintained copies of the same three-index scan (R-3.1).
 */
export async function crewRoleUsage(
  ctx: QueryCtx | MutationCtx,
  roleId: string,
  orgId: string,
): Promise<{ crewMembers: number; crewAssignments: number; projectServices: number }> {
  const [members, assignments, services] = await Promise.all([
    ctx.db.query("crewMembers").withIndex("by_crewRoleId", (q) => q.eq("crewRoleId", roleId)).collect(),
    ctx.db.query("crewAssignments").withIndex("by_crewRoleId", (q) => q.eq("crewRoleId", roleId)).collect(),
    ctx.db.query("projectServices").withIndex("by_crewRoleId", (q) => q.eq("crewRoleId", roleId)).collect(),
  ]);
  return {
    crewMembers: members.filter((m) => m.organizationId === orgId).length,
    crewAssignments: assignments.filter((r) => r.organizationId === orgId).length,
    projectServices: services.filter((s) => s.organizationId === orgId).length,
  };
}
