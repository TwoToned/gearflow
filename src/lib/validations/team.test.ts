import { describe, expect, it } from "vitest";

import { MAX_TEAM_BULK } from "@/lib/member-role-policy";
import { changeRolesSchema, inviteSchema, invitationIdsSchema, memberIdsSchema, undoTeamSchema } from "@/lib/validations/team";

const ids = (n: number) => Array.from({ length: n }, (_, i) => `id${i}`);

describe("Team write bodies (R-8.6.2)", () => {
  it("the bulk cap is 50 and enforced by the schema, not the UI", () => {
    expect(MAX_TEAM_BULK).toBe(50);
    expect(memberIdsSchema.safeParse({ memberIds: ids(50) }).success).toBe(true);
    expect(memberIdsSchema.safeParse({ memberIds: ids(51) }).success).toBe(false);
    expect(invitationIdsSchema.safeParse({ invitationIds: ids(51) }).success).toBe(false);
    expect(changeRolesSchema.safeParse({ memberIds: ids(51), role: "viewer" }).success).toBe(false);
    expect(memberIdsSchema.safeParse({ memberIds: [] }).success).toBe(false);
  });

  it("de-duplicates ids so 60 copies of one id can't dodge or inflate the cap", () => {
    const parsed = memberIdsSchema.parse({ memberIds: Array.from({ length: 50 }, () => "same") });
    expect(parsed.memberIds).toEqual(["same"]);
  });

  it("rejects an oversized or empty id", () => {
    expect(memberIdsSchema.safeParse({ memberIds: [""] }).success).toBe(false);
    expect(memberIdsSchema.safeParse({ memberIds: ["x".repeat(65)] }).success).toBe(false);
  });

  it("a role must be EXACTLY an assignable role: never owner, compound, unknown or cased differently", () => {
    for (const ok of ["admin", "manager", "member", "warehouse", "viewer"]) {
      expect(changeRolesSchema.safeParse({ memberIds: ["a"], role: ok }).success).toBe(true);
    }
    for (const bad of ["owner", "admin,member", "owner,admin", "Admin", "", "root"]) {
      expect(changeRolesSchema.safeParse({ memberIds: ["a"], role: bad }).success).toBe(false);
      expect(inviteSchema.safeParse({ email: "a@b.co", role: bad }).success).toBe(false);
    }
  });

  it("the invite email is trimmed, lower-cased and validated", () => {
    expect(inviteSchema.parse({ email: "  New@X.CO ", role: "member" }).email).toBe("new@x.co");
    expect(inviteSchema.safeParse({ email: "nope", role: "member" }).success).toBe(false);
  });

  it("the Undo token is bounded", () => {
    expect(undoTeamSchema.safeParse({ token: "x".repeat(4001) }).success).toBe(false);
    expect(undoTeamSchema.safeParse({ token: "short" }).success).toBe(false);
  });
});
