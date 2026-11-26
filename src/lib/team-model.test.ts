import { describe, expect, it, vi } from "vitest";

import { hasPermission, RESOURCES } from "@/lib/permissions";
import { buildRolesGrid, GRID_ROLES } from "@/lib/roles-grid";
import {
  assignableRoles,
  inviteBulkActions,
  inviteRow,
  inviteStatus,
  memberBulkActions,
  memberMenu,
  memberRow,
  teamToast,
  type TeamMemberSource,
} from "@/lib/team-model";

const H = { onChangeRole: vi.fn(), onRemove: vi.fn() };
const member = (over: Partial<TeamMemberSource> = {}): TeamMemberSource => ({
  id: "m1", userId: "u1", name: "Max", email: "max@x.co", role: "manager", createdAt: "2026-01-02T00:00:00Z", ...over,
});
const keys = (items: { key: string }[]) => items.map((i) => i.key);

describe("team menus: absent, never disabled, from the one role policy", () => {
  it("an owner sees Change role (every other role) and a red Remove on a manager", () => {
    const items = memberMenu(member(), { userId: "me", role: "owner" }, H);
    expect(keys(items)).toEqual(["change-role", "remove"]);
    expect(keys(items[0].children!)).toEqual(["role-admin", "role-member", "role-warehouse", "role-viewer"]);
    expect(items[1].danger).toBe(true);
    expect(items[1].confirm?.body).toMatch(/can't be undone/i);
  });

  it("an admin never sees `Admin` as a target role, and sees nothing at all for another admin or the owner", () => {
    const viewer = { userId: "me", role: "admin" };
    expect(keys(memberMenu(member(), viewer, H)[0].children!)).not.toContain("role-admin");
    expect(memberMenu(member({ role: "admin" }), viewer, H)).toEqual([]);
    expect(memberMenu(member({ role: "owner" }), viewer, H)).toEqual([]);
    expect(memberRow(member({ role: "owner" }), viewer, H).menu).toBeUndefined();
  });

  it("you get no menu on your own row", () => {
    expect(memberMenu(member({ userId: "me" }), { userId: "me", role: "owner" }, H)).toEqual([]);
  });

  it("a role that can't hand out anything is offered no role menu and no bulk change", () => {
    expect(assignableRoles("viewer")).toEqual([]);
    expect(keys(memberBulkActions({ userId: "me", role: "viewer" }, { onChangeRoles: vi.fn(), onRemoveMany: vi.fn() }))).toEqual(["remove"]);
  });

  it("the invite menu has Resend and a red Revoke; an admin has neither on an admin invite", () => {
    const inv = { id: "i1", email: "new@x.co", role: "member", expiresAt: "2026-12-30T00:00:00Z" };
    const now = new Date("2026-12-01").getTime();
    expect(keys(inviteRow(inv, { userId: "me", role: "admin" }, now, { onResend: vi.fn(), onRevoke: vi.fn() }).menu!.items)).toEqual(["resend", "revoke"]);
    expect(inviteRow({ ...inv, role: "admin" }, { userId: "me", role: "admin" }, now, { onResend: vi.fn(), onRevoke: vi.fn() }).menu).toBeUndefined();
  });

  it("bulk verbs carry the count, destructive last and confirmed", () => {
    const bulk = inviteBulkActions({ onResendMany: vi.fn(), onRevokeMany: vi.fn() });
    expect(bulk.map((b) => b.label(3))).toEqual(["Resend 3", "Revoke 3"]);
    expect(bulk[1].danger && bulk[1].confirm).toBeTruthy();
    const mb = memberBulkActions({ userId: "me", role: "owner" }, { onChangeRoles: vi.fn(), onRemoveMany: vi.fn() });
    expect(mb.map((b) => b.label(2))).toEqual(["Change role… 2", "Remove 2"]);
  });
});

describe("derived words", () => {
  it("an invite is Pending until expiresAt passes, then Expired (never stored)", () => {
    const now = new Date("2026-12-10").getTime();
    expect(inviteStatus("2026-12-20T00:00:00Z", now).label).toBe("Pending");
    expect(inviteStatus("2026-12-01T00:00:00Z", now).label).toBe("Expired");
  });

  it("the toast names what changed and what was skipped, with the first reason", () => {
    const t = teamToast("role", { changed: 2, skipped: [{ id: "a", label: "Olive", reason: "The owner can't be changed." }] }, "viewer");
    expect(t.title).toBe("Changed 2 members to Viewer · skipped Olive: The owner can't be changed.");
    expect(teamToast("revoke", { changed: 0, skipped: [{ id: "a", label: "x@y.co", reason: "Not pending" }] }).title).toMatch(/^Nothing changed/);
    expect(teamToast("resend", { changed: 1, skipped: [] }).undoneTitle).toMatch(/already sent/i);
  });
});

describe("the roles grid reads the real permission tables (D58)", () => {
  const grid = buildRolesGrid();

  it("has a row per RESOURCE and a column per role, owner first, warehouse included", () => {
    expect(grid.rows.map((r) => r.resource)).toEqual([...RESOURCES]);
    expect(GRID_ROLES).toEqual(["owner", "admin", "manager", "member", "warehouse", "viewer"]);
    expect(grid.roles.map((r) => r.key)).toEqual([...GRID_ROLES]);
  });

  it("every cell agrees with hasPermission for every action (no second copy)", () => {
    for (const row of grid.rows) {
      for (const role of GRID_ROLES) {
        for (const a of row.cells[role].actions) {
          expect(a.granted).toBe(hasPermission(role, row.resource as (typeof RESOURCES)[number], a.key));
        }
      }
    }
  });

  it("prints All, n/m or a dash, and the footer totals add up", () => {
    expect(grid.rows.find((r) => r.resource === "orgMembers")!.cells.owner.text).toBe("All");
    expect(grid.rows.find((r) => r.resource === "orgMembers")!.cells.viewer.text).toBe("—");
    const texts = new Set(grid.rows.flatMap((r) => GRID_ROLES.map((role) => r.cells[role].text)));
    expect([...texts].some((t) => /^\d+\/\d+$/.test(t))).toBe(true);
    for (const r of grid.roles) {
      expect(r.granted).toBe(grid.rows.reduce((n, row) => n + row.cells[r.key].granted, 0));
      expect(r.granted).toBeLessThanOrEqual(r.total);
    }
    expect(grid.roles[0].granted).toBe(grid.roles[0].total); // the owner holds everything
    expect(grid.roles.at(-1)!.granted).toBeLessThan(grid.roles[1].granted); // viewer < admin
  });
});
