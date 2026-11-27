import type { PermissionMap } from "@/lib/permissions";
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
 *
 * FAILS CLOSED. A role is only meaningful when it is EXACTLY a `rolePermissions`
 * key. An unknown role ("bogus"), an empty one, or a comma-compound one
 * ("admin,member", written by a path that doesn't validate) has no rights we can
 * compare, so as a TARGET it is refused, as an ACTOR it can do nothing, and as an
 * assigned role it is rejected. Any compound containing "owner" is treated as the
 * owner. (Better Auth stores multi-roles as a comma string; its stock endpoints are
 * switched off in `auth-disabled-paths.ts`, this is the second line.)
 */

/** The roles that can be assigned: derived from the options the UI offers. */
export const ASSIGNABLE_ROLES: readonly string[] = ASSIGNABLE_ROLE_OPTIONS.map((r) => r.value);

/** Hard cap for any bulk Team write (the cap must be server-side, R-9.3). */
export const MAX_TEAM_BULK = 50;

export type RoleVerdict = { ok: true } | { ok: false; reason: string };

const OWNER_REFUSED = "The owner can't be changed or removed. Transfer ownership instead.";
const UNKNOWN_ROLE = "This member has a role Flow doesn't recognise, so it can't be changed here.";
const ADMIN_ONLY = "Only the owner can manage admins.";

/** A role string that names the owner, alone or inside a comma-compound ("admin, owner"). */
function namesOwner(role: string): boolean {
  return role.split(",").some((r) => r.trim() === "owner");
}

/**
 * The policy over one permission table. The app uses the real `rolePermissions`;
 * tests build it over a synthetic table to prove cases the real data never produces
 * (a smaller role that is NOT a subset).
 */
export function makeRolePolicy(table: Record<string, PermissionMap>, assignable: readonly string[]) {
  const isKnown = (role: string | null | undefined): role is string =>
    typeof role === "string" && Object.prototype.hasOwnProperty.call(table, role);

  function rightsOf(role: string): Set<string> {
    const out = new Set<string>();
    for (const [resource, actions] of Object.entries(table[role] ?? {})) {
      for (const a of actions ?? []) out.add(`${resource}:${a}`);
    }
    return out;
  }

  /** `inner` has strictly fewer rights than `outer` AND every one of them is also held by `outer`. */
  function strictlyWithin(inner: string, outer: string): boolean {
    if (!isKnown(inner) || !isKnown(outer)) return false;
    const a = rightsOf(inner);
    const b = rightsOf(outer);
    if (a.size === 0 || a.size >= b.size) return false;
    for (const r of a) if (!b.has(r)) return false;
    return true;
  }

  function canAssignRole(actorRole: string | null | undefined, newRole: string): RoleVerdict {
    if (!assignable.includes(newRole) || !isKnown(newRole)) return { ok: false, reason: "Invalid role" };
    if (actorRole === "owner") return { ok: true };
    if (isKnown(actorRole) && strictlyWithin(newRole, actorRole)) return { ok: true };
    return { ok: false, reason: "Only the owner can give out the admin role." };
  }

  function canManageMember(actorRole: string | null | undefined, targetRole: string): RoleVerdict {
    if (namesOwner(targetRole)) return { ok: false, reason: OWNER_REFUSED };
    if (!isKnown(targetRole)) return { ok: false, reason: UNKNOWN_ROLE };
    if (actorRole === "owner") return { ok: true };
    if (isKnown(actorRole) && strictlyWithin(targetRole, actorRole)) return { ok: true };
    return { ok: false, reason: ADMIN_ONLY };
  }

  function roleChangeVerdict(input: {
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

  function removeMemberVerdict(input: {
    actorRole: string | null | undefined;
    targetRole: string;
    isSelf: boolean;
  }): RoleVerdict {
    if (input.isSelf) return { ok: false, reason: "You can't remove yourself. Use Leave organisation instead." };
    return canManageMember(input.actorRole, input.targetRole);
  }

  return { canAssignRole, canManageMember, roleChangeVerdict, removeMemberVerdict };
}

const policy = makeRolePolicy(rolePermissions, ASSIGNABLE_ROLES);
export const { canAssignRole, canManageMember, roleChangeVerdict, removeMemberVerdict } = policy;
