import { rolePermissions } from "@/lib/permissions";
import { ASSIGNABLE_ROLE_OPTIONS } from "@/lib/role-descriptions";

/**
 * Who may give which role to whom — the ONE rule (R-3.1), read by the invite,
 * the single and bulk role change, the removal and the Undo. Pure: no I/O.
 *
 * The rights comparison reads `rolePermissions` directly (never a second
 * ranking table): an actor may only hand out a role whose rights are a STRICT
 * subset of their own, and may only touch a member whose rights are a strict
 * subset of their own. That is what stops an Admin raising anyone to Admin or
 * above, or demoting/removing another Admin; only the Owner manages Admins.
 * The Owner is never a target and never assignable (ownership is transferred),
 * so the last Owner can't be demoted or removed through any path.
 */

/** The roles that can be assigned: derived from the options the UI offers. */
export const ASSIGNABLE_ROLES: readonly string[] = ASSIGNABLE_ROLE_OPTIONS.map((r) => r.value);

/** Hard cap for any bulk Team write (the cap must be server-side, R-9.3). */
export const MAX_TEAM_BULK = 50;

function rightsOf(role: string): Set<string> {
  const out = new Set<string>();
  const map = rolePermissions[role];
  if (!map) return out;
  for (const [resource, actions] of Object.entries(map)) {
    for (const a of actions ?? []) out.add(`${resource}:${a}`);
  }
  return out;
}

/** True when every right of `inner` is held by `outer`, and `outer` holds more. */
function strictlyWithin(inner: string, outer: string): boolean {
  const a = rightsOf(inner);
  const b = rightsOf(outer);
  if (a.size >= b.size) return false;
  for (const r of a) if (!b.has(r)) return false;
  return true;
}

export type RoleVerdict = { ok: true } | { ok: false; reason: string };

/** May `actorRole` give someone `newRole`? */
export function canAssignRole(actorRole: string | null | undefined, newRole: string): RoleVerdict {
  if (!ASSIGNABLE_ROLES.includes(newRole)) return { ok: false, reason: "Invalid role" };
  if (actorRole === "owner") return { ok: true };
  if (actorRole && strictlyWithin(newRole, actorRole)) return { ok: true };
  return { ok: false, reason: "Only the owner can give out the admin role." };
}

/** May `actorRole` change or remove a member who currently holds `targetRole`? */
export function canManageMember(actorRole: string | null | undefined, targetRole: string): RoleVerdict {
  if (targetRole === "owner") {
    return { ok: false, reason: "The owner can't be changed or removed. Transfer ownership instead." };
  }
  if (actorRole === "owner") return { ok: true };
  if (actorRole && strictlyWithin(targetRole, actorRole)) return { ok: true };
  return { ok: false, reason: "Only the owner can manage admins." };
}

/** Role change: target is manageable, new role assignable, and never yourself. */
export function roleChangeVerdict(input: {
  actorRole: string | null | undefined;
  targetRole: string;
  newRole: string;
  isSelf: boolean;
}): RoleVerdict {
  if (input.isSelf) return { ok: false, reason: "You can't change your own role." };
  const manage = canManageMember(input.actorRole, input.targetRole);
  if (!manage.ok) return manage;
  return canAssignRole(input.actorRole, input.newRole);
}

/** Removal: target is manageable and never yourself. */
export function removeMemberVerdict(input: {
  actorRole: string | null | undefined;
  targetRole: string;
  isSelf: boolean;
}): RoleVerdict {
  if (input.isSelf) return { ok: false, reason: "You can't remove yourself. Use Leave organisation instead." };
  return canManageMember(input.actorRole, input.targetRole);
}
