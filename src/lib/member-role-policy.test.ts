import { describe, expect, it } from "vitest";

import {
  ASSIGNABLE_ROLES,
  canAssignRole,
  canManageMember,
  removeMemberVerdict,
  roleChangeVerdict,
} from "@/lib/member-role-policy";
import { rolePermissions } from "@/lib/permissions";

describe("member role policy", () => {
  it("the assignable list is the five roles the UI offers, warehouse included, owner never", () => {
    expect([...ASSIGNABLE_ROLES].sort()).toEqual(["admin", "manager", "member", "viewer", "warehouse"]);
    for (const r of ASSIGNABLE_ROLES) expect(rolePermissions[r]).toBeDefined();
  });

  it("an owner can assign any assignable role but never `owner`", () => {
    for (const r of ASSIGNABLE_ROLES) expect(canAssignRole("owner", r).ok).toBe(true);
    expect(canAssignRole("owner", "owner").ok).toBe(false);
    expect(canAssignRole("owner", "made-up").ok).toBe(false);
  });

  it("an admin can give every role below admin, but never admin (no raising above own rights)", () => {
    for (const r of ["manager", "member", "warehouse", "viewer"]) expect(canAssignRole("admin", r).ok).toBe(true);
    expect(canAssignRole("admin", "admin").ok).toBe(false);
    expect(canAssignRole("admin", "owner").ok).toBe(false);
  });

  it("a manager, member, warehouse or viewer can hand out nothing equal or above themselves", () => {
    expect(canAssignRole("manager", "admin").ok).toBe(false);
    expect(canAssignRole("manager", "manager").ok).toBe(false);
    expect(canAssignRole("viewer", "viewer").ok).toBe(false);
    expect(canAssignRole(null, "viewer").ok).toBe(false);
  });

  it("the owner is never a target, so the last owner can't be demoted or removed", () => {
    expect(canManageMember("owner", "owner").ok).toBe(false);
    expect(canManageMember("admin", "owner").ok).toBe(false);
    expect(roleChangeVerdict({ actorRole: "owner", targetRole: "owner", newRole: "admin", isSelf: false }).ok).toBe(false);
    expect(removeMemberVerdict({ actorRole: "owner", targetRole: "owner", isSelf: false }).ok).toBe(false);
  });

  it("an admin can't touch another admin, but can manage everyone below", () => {
    expect(canManageMember("admin", "admin").ok).toBe(false);
    for (const r of ["manager", "member", "warehouse", "viewer"]) expect(canManageMember("admin", r).ok).toBe(true);
    expect(canManageMember("owner", "admin").ok).toBe(true);
  });

  it("you can't change or remove yourself", () => {
    expect(roleChangeVerdict({ actorRole: "owner", targetRole: "admin", newRole: "member", isSelf: true }).ok).toBe(false);
    expect(removeMemberVerdict({ actorRole: "admin", targetRole: "member", isSelf: true }).ok).toBe(false);
  });

  it("a role change needs BOTH a manageable target and an assignable role", () => {
    // Admin demoting a manager to viewer is fine; promoting that manager to admin is not.
    expect(roleChangeVerdict({ actorRole: "admin", targetRole: "manager", newRole: "viewer", isSelf: false }).ok).toBe(true);
    expect(roleChangeVerdict({ actorRole: "admin", targetRole: "manager", newRole: "admin", isSelf: false }).ok).toBe(false);
    // Admin demoting an admin is refused even to a lower role.
    expect(roleChangeVerdict({ actorRole: "admin", targetRole: "admin", newRole: "viewer", isSelf: false }).ok).toBe(false);
  });
});
