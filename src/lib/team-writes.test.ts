// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Team writes (UX Phase 17, D58/D59) against an in-memory Prisma. What this
 * pins: the role policy is enforced per row on the SERVER (the owner is never
 * demoted or removed, an admin can't raise anyone to admin or touch an admin),
 * a bulk call reports skips instead of failing, Resend extends the SAME row (one
 * live token), and every Undo is exact: signed token only, author only, once,
 * compare-and-set, and it refuses once the row has moved on.
 */

type Row = Record<string, unknown>;
const db = vi.hoisted(() => ({
  members: [] as Row[],
  invitations: [] as Row[],
  markers: new Set<string>(),
  calls: [] as string[],
  emails: [] as Row[],
  now: 0,
  /** The Convex member mirror: userId -> role. */
  mirror: {} as Record<string, string>,
  failMirror: false,
  /** Runs while the Undo reads the mirror, i.e. between its pre-check and its apply. */
  onMirrorRead: null as null | ((userId: string) => void),
  /** Throw from the next Prisma member write for this id (an infrastructure error). */
  failMemberWriteFor: null as null | string,
  /** A concurrent writer acts while we are inside the mirror call (after our Prisma read, before our next write). */
  onMirrorRemove: null as null | (() => void),
  onMirrorUpsert: null as null | (() => void),
}));

const { table } = vi.hoisted(() => {
  const withUser = (r: Record<string, unknown>) => ({ ...r, user: { email: r.userEmail ?? null, name: r.userName ?? null } });
  function matches(row: Record<string, unknown>, where: Record<string, unknown>): boolean {
    return Object.entries(where).every(([k, v]) => {
      if (k === "user") return (row.userEmail as string) === (v as { email: string }).email;
      if (v && typeof v === "object" && "in" in (v as object)) return ((v as { in: unknown[] }).in).includes(row[k]);
      if (v instanceof Date) return (row[k] as Date)?.getTime() === v.getTime();
      return row[k] === v;
    });
  }
  const table = (rows: () => Record<string, unknown>[]) => ({
    findMany: async ({ where }: { where: Record<string, unknown> }) => rows().filter((r) => matches(r, where)).map(withUser),
    findFirst: async ({ where }: { where: Record<string, unknown> }) => rows().filter((r) => matches(r, where)).map(withUser)[0] ?? null,
    updateMany: async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
      const hit = rows().filter((r) => matches(r, where));
      hit.forEach((r) => Object.assign(r, data));
      return { count: hit.length };
    },
  });
  return { table };
});

vi.mock("@/lib/prisma", () => {
  const memberTable = table(() => db.members);
  const prisma = {
    member: {
      ...memberTable,
      updateMany: async (args: { where: Row; data: Row }) => {
        if (db.failMemberWriteFor && args.where.id === db.failMemberWriteFor) throw new Error("db exploded");
        db.calls.push(`prisma.cas:${args.where.id}:${args.data.role}`);
        return memberTable.updateMany(args);
      },
      deleteMany: async ({ where }: { where: Row }) => {
        const hit = db.members.filter((m) => m.id === where.id && m.organizationId === where.organizationId && m.role === where.role);
        db.members = db.members.filter((m) => !hit.includes(m));
        db.calls.push(`prisma.delete:${where.id}:${hit.length}`);
        return { count: hit.length };
      },
    },
    invitation: table(() => db.invitations),
    organization: { findUnique: async () => ({ name: "Acme" }) },
    // An interactive transaction that rolls back every write if the callback throws.
    $transaction: async (fn: (tx: unknown) => Promise<unknown>) => {
      const snap = structuredClone({ m: db.members, i: db.invitations });
      try {
        return await fn(prisma);
      } catch (e) {
        db.members = snap.m;
        db.invitations = snap.i;
        throw e;
      }
    },
  };
  return { prisma };
});
vi.mock("@/lib/member-mirror", () => ({
  upsertMemberMirror: vi.fn(async (row: Row, opts: Row) => {
    db.calls.push(`mirror.upsert:${row.id}:${row.role}:${opts?.strict ? "strict" : "lax"}`);
    db.onMirrorUpsert?.();
    if (db.failMirror) throw new Error("convex down");
    db.mirror[row.userId as string] = row.role as string;
  }),
  removeMemberMirror: vi.fn(async (a: Row, opts: Row) => {
    db.calls.push(`mirror.remove:${a.userId}:${opts?.strict ? "strict" : "lax"}`);
    db.onMirrorRemove?.();
    if (db.failMirror) throw new Error("convex down");
    delete db.mirror[a.userId as string];
  }),
}));
vi.mock("@/lib/activity-log", () => ({ logActivity: vi.fn(async () => {}) }));
vi.mock("@/lib/convex-client", () => ({
  getConvexClient: async () => ({
    query: async (_fn: unknown, args: { userId: string }) => {
      const role = db.mirror[args.userId];
      const out = role === undefined ? null : { role };
      db.onMirrorRead?.(args.userId);
      return out;
    },
    mutation: async (_fn: unknown, args: { id: string }) => {
      const created = !db.markers.has(args.id);
      db.markers.add(args.id);
      return { created };
    },
  }),
}));
vi.mock("@/lib/email", () => ({
  sendEmail: vi.fn(async (m: Row) => {
    db.emails.push(m);
  }),
  roleChangedEmail: () => ({ subject: "role", html: "" }),
  removedFromOrgEmail: () => ({ subject: "removed", html: "" }),
}));
vi.mock("@/lib/email-templates", () => ({
  invitationEmail: (a: { acceptUrl: string }) => ({ subject: "invite", html: a.acceptUrl }),
}));
vi.mock("@/lib/platform", () => ({ getPlatformName: async () => "Flow" }));
vi.mock("@/lib/logger", () => ({ logger: { error: vi.fn() } }));
vi.mock("@/env", () => ({ env: { BETTER_AUTH_SECRET: "test-secret", NEXT_PUBLIC_APP_URL: "https://flow.test" } }));

import {
  changeMemberRoles,
  removeMembers,
  resendInvitations,
  revokeInvitations,
  undoTeamChange,
  type TeamActor,
} from "@/lib/team-writes";
import { createTeamUndoToken } from "@/lib/team-undo-token";

const ORG = "org1";
const owner: TeamActor = { organizationId: ORG, userId: "u-owner", userName: "Olive", role: "owner" };
const admin: TeamActor = { organizationId: ORG, userId: "u-admin", userName: "Adam", role: "admin" };
const DAY = 86_400_000;
const replayNew = (token: string) => JSON.parse(Buffer.from(token.split(".")[0], "base64url").toString()).body.items[0].newExpiresAt as number;

function seed() {
  db.members = [
    { id: "m-owner", organizationId: ORG, userId: "u-owner", role: "owner", userEmail: "o@x.co", userName: "Olive", createdAt: new Date(1) },
    { id: "m-admin", organizationId: ORG, userId: "u-admin", role: "admin", userEmail: "a@x.co", userName: "Adam", createdAt: new Date(2) },
    { id: "m-admin2", organizationId: ORG, userId: "u-admin2", role: "admin", userEmail: "a2@x.co", userName: "Ada", createdAt: new Date(3) },
    { id: "m-mgr", organizationId: ORG, userId: "u-mgr", role: "manager", userEmail: "m@x.co", userName: "Max", createdAt: new Date(4) },
    { id: "m-view", organizationId: ORG, userId: "u-view", role: "viewer", userEmail: "v@x.co", userName: "Vi", createdAt: new Date(5) },
    { id: "m-other", organizationId: "org2", userId: "u-other", role: "viewer", userEmail: "x@y.co", userName: "Xan", createdAt: new Date(6) },
  ];
  db.invitations = [
    { id: "inv-1", organizationId: ORG, email: "new@x.co", role: "member", status: "pending", expiresAt: new Date(db.now + 2 * DAY) },
    { id: "inv-old", organizationId: ORG, email: "old@x.co", role: "viewer", status: "pending", expiresAt: new Date(db.now - 3 * DAY) },
    { id: "inv-adm", organizationId: ORG, email: "adm@x.co", role: "admin", status: "pending", expiresAt: new Date(db.now + 2 * DAY) },
    { id: "inv-other", organizationId: "org2", email: "z@y.co", role: "member", status: "pending", expiresAt: new Date(db.now + DAY) },
  ];
  db.markers = new Set();
  db.calls = [];
  db.emails = [];
  db.failMirror = false;
  db.onMirrorRead = null;
  db.failMemberWriteFor = null;
  db.onMirrorRemove = null;
  db.onMirrorUpsert = null;
  db.mirror = Object.fromEntries(db.members.map((m) => [m.userId as string, m.role as string]));
}
const role = (id: string) => db.members.find((m) => m.id === id)?.role;
const inv = (id: string) => db.invitations.find((i) => i.id === id)!;

beforeEach(() => {
  vi.useFakeTimers();
  db.now = Date.now();
  seed();
});

describe("bulk role change, enforced server-side", () => {
  it("an owner changes several members at once and gets one signed Undo", async () => {
    const r = await changeMemberRoles(owner, ["m-mgr", "m-view"], "member");
    expect(r.changed).toBe(2);
    expect(r.skipped).toEqual([]);
    expect(role("m-mgr")).toBe("member");
    expect(role("m-view")).toBe("member");
    expect(r.undoToken).toBeTruthy();
  });

  it("Prisma is the source of truth: written FIRST with a compare-and-set, then the Convex mirror (strict)", async () => {
    await changeMemberRoles(owner, ["m-mgr"], "viewer");
    expect(db.calls).toEqual(["prisma.cas:m-mgr:viewer", "mirror.upsert:m-mgr:viewer:strict"]);
    expect(db.mirror["u-mgr"]).toBe("viewer");
  });

  it("forward compare-and-set: a role that changed after we read it is NOT overwritten", async () => {
    // Move the role between our read and our write (a colleague's concurrent change).
    const pending = changeMemberRoles(owner, ["m-mgr"], "viewer");
    db.members.find((m) => m.id === "m-mgr")!.role = "warehouse"; // lands before the CAS runs
    const r = await pending;
    expect(r.changed).toBe(0);
    expect(r.skipped[0].reason).toMatch(/changed while saving/i);
    expect(role("m-mgr")).toBe("warehouse");
    expect(r.undoToken).toBeNull();
  });

  it("if the Convex mirror fails, the Prisma write is reverted and the row is REPORTED, not hidden", async () => {
    db.failMirror = true;
    const r = await changeMemberRoles(owner, ["m-mgr", "m-view"], "member");
    expect(r.changed).toBe(0);
    expect(r.skipped).toHaveLength(2);
    expect(r.skipped[0].reason).toMatch(/couldn't sync permissions/i);
    expect(role("m-mgr")).toBe("manager");
    expect(role("m-view")).toBe("viewer");
  });

  it("the mirror-failure revert is itself a compare-and-set: a colleague's newer role is NOT clobbered", async () => {
    // Our mirror write fails, and meanwhile a colleague moves the member again.
    db.failMirror = true;
    db.onMirrorUpsert = () => {
      db.members.find((m) => m.id === "m-mgr")!.role = "warehouse";
    };
    const r = await changeMemberRoles(owner, ["m-mgr"], "member");
    expect(r.changed).toBe(0);
    expect(r.skipped[0].reason).toMatch(/out of sync/i);
    expect(role("m-mgr")).toBe("warehouse"); // the colleague's change survives; we did not revert over it
  });

  it("a later row that throws is skipped with its message; the rows that DID change keep their Undo", async () => {
    db.failMemberWriteFor = "m-view";
    const r = await changeMemberRoles(owner, ["m-mgr", "m-view"], "member");
    expect(r.changed).toBe(1);
    expect(r.skipped.map((s) => s.id)).toEqual(["m-view"]);
    expect(r.skipped[0].reason).toMatch(/db exploded/);
    expect(r.undoToken).toBeTruthy();
    db.failMemberWriteFor = null;
    expect(await undoTeamChange(owner, r.undoToken!)).toEqual({ restored: 1 });
    expect(role("m-mgr")).toBe("manager");
  });

  it("fails closed on a target with an unknown or compound role", async () => {
    db.members.push({ id: "m-odd", organizationId: ORG, userId: "u-odd", role: "admin,member", userEmail: "odd@x.co", userName: "Odd", createdAt: new Date(8) });
    db.members.push({ id: "m-odd2", organizationId: ORG, userId: "u-odd2", role: "bogus", userEmail: "odd2@x.co", userName: "Odd2", createdAt: new Date(9) });
    db.members.push({ id: "m-odd3", organizationId: ORG, userId: "u-odd3", role: "member,owner", userEmail: "odd3@x.co", userName: "Odd3", createdAt: new Date(10) });
    for (const actor of [admin, owner]) {
      const r = await changeMemberRoles(actor, ["m-odd", "m-odd2", "m-odd3"], "viewer");
      expect(r.changed).toBe(0);
      expect(role("m-odd")).toBe("admin,member");
      expect(role("m-odd3")).toBe("member,owner");
    }
    expect((await removeMembers(owner, ["m-odd", "m-odd2", "m-odd3"])).changed).toBe(0);
    expect(db.members.some((m) => m.id === "m-odd")).toBe(true);
  });

  it("the owner can't be demoted: skipped, never written (an admin, a co-owner, or the owner themself acting)", async () => {
    db.members.push({ id: "m-owner2", organizationId: ORG, userId: "u-owner2", role: "owner", userEmail: "o2@x.co", userName: "Oz", createdAt: new Date(7) });
    const byAdmin = await changeMemberRoles(admin, ["m-owner"], "viewer");
    expect(byAdmin.skipped[0].reason).toMatch(/owner can't be changed/i);
    const byCoOwner = await changeMemberRoles(owner, ["m-owner2"], "admin");
    expect(byCoOwner.skipped[0].reason).toMatch(/owner can't be changed/i);
    const bySelf = await changeMemberRoles(owner, ["m-owner"], "admin");
    expect(bySelf.skipped[0].reason).toMatch(/own role/i);
    for (const r of [byAdmin, byCoOwner, bySelf]) expect(r.changed).toBe(0);
    expect(role("m-owner")).toBe("owner");
    expect(role("m-owner2")).toBe("owner");
  });

  it("an admin can't raise anyone to admin, and can't touch another admin", async () => {
    const r = await changeMemberRoles(admin, ["m-mgr", "m-admin2"], "admin");
    expect(r.changed).toBe(0);
    expect(role("m-mgr")).toBe("manager");
    const demote = await changeMemberRoles(admin, ["m-admin2"], "viewer");
    expect(demote.changed).toBe(0);
    expect(role("m-admin2")).toBe("admin");
  });

  it("an admin CAN move a manager down to viewer; the rest of a mixed batch is skipped, not failed", async () => {
    const r = await changeMemberRoles(admin, ["m-mgr", "m-admin2", "m-owner"], "viewer");
    expect(r.changed).toBe(1);
    expect(r.skipped.map((s) => s.id).sort()).toEqual(["m-admin2", "m-owner"]);
    expect(role("m-mgr")).toBe("viewer");
  });

  it("owner is never assignable, an unknown role is refused, and you can't change yourself", async () => {
    expect((await changeMemberRoles(owner, ["m-mgr"], "owner")).changed).toBe(0);
    expect((await changeMemberRoles(owner, ["m-mgr"], "root")).changed).toBe(0);
    expect((await changeMemberRoles(admin, ["m-admin"], "viewer")).changed).toBe(0);
  });

  it("another org's member is reported as not found and untouched", async () => {
    const r = await changeMemberRoles(owner, ["m-other"], "member");
    expect(r.changed).toBe(0);
    expect(r.skipped[0].reason).toBe("Member not found");
    expect(role("m-other")).toBe("viewer");
  });

  it("removal skips the owner, yourself and an admin (for an admin), has NO Undo", async () => {
    const r = await removeMembers(admin, ["m-owner", "m-admin", "m-admin2", "m-view"]);
    expect(r.changed).toBe(1);
    expect(r.skipped.map((s) => s.id).sort()).toEqual(["m-admin", "m-admin2", "m-owner"]);
    expect(r.undoToken).toBeNull();
    expect(db.members.some((m) => m.id === "m-view")).toBe(false);
    expect(db.calls[0]).toBe("mirror.remove:u-view:strict");
  });

  it("lost CAS because someone else REMOVED the member: the mirror ends with NO grant (never re-created)", async () => {
    // While we drop the mirror, a concurrent removal deletes the Prisma row.
    db.onMirrorRemove = () => {
      db.members = db.members.filter((m) => m.id !== "m-view");
    };
    const r = await removeMembers(owner, ["m-view"]);
    expect(r.changed).toBe(0);
    expect(r.skipped[0].reason).toMatch(/changed while removing/i);
    expect(db.members.some((m) => m.id === "m-view")).toBe(false);
    expect(db.mirror["u-view"]).toBeUndefined();
    expect(db.calls.some((c) => c.startsWith("mirror.upsert:m-view"))).toBe(false);
  });

  it("lost CAS because someone else CHANGED the role: the mirror ends on the ACTUAL current role, never the stale one", async () => {
    // We read the manager; a concurrent change makes them a viewer while we drop the mirror.
    db.onMirrorRemove = () => {
      db.members.find((m) => m.id === "m-mgr")!.role = "viewer";
    };
    const r = await removeMembers(owner, ["m-mgr"]);
    expect(r.changed).toBe(0);
    expect(role("m-mgr")).toBe("viewer");
    expect(db.mirror["u-mgr"]).toBe("viewer"); // not "manager"
  });

  it("a revocation fails CLOSED: if the mirror can't be removed nothing is deleted", async () => {
    db.failMirror = true;
    const r = await removeMembers(owner, ["m-view"]);
    expect(r.changed).toBe(0);
    expect(db.members.some((m) => m.id === "m-view")).toBe(true);
  });
});

describe("Resend re-issues without a second live token", () => {
  it("extends the SAME invitation and emails the same link; the row count never grows", async () => {
    const before = db.invitations.length;
    const r = await resendInvitations(owner, ["inv-old"]);
    expect(r.changed).toBe(1);
    expect(db.invitations).toHaveLength(before);
    expect(inv("inv-old").status).toBe("pending");
    expect((inv("inv-old").expiresAt as Date).getTime()).toBeGreaterThan(db.now + 6 * DAY);
    expect(db.emails[0].html).toBe("https://flow.test/invite/inv-old");
  });

  it("another org's invitation and a non-pending one are skipped; an admin can't resend an admin invite", async () => {
    inv("inv-1").status = "cancelled";
    const r = await resendInvitations(admin, ["inv-other", "inv-1", "inv-adm"]);
    expect(r.changed).toBe(0);
    expect(r.skipped).toHaveLength(3);
  });

  it("Undo restores exactly the prior expiry, once", async () => {
    const prev = (inv("inv-old").expiresAt as Date).getTime();
    const r = await resendInvitations(owner, ["inv-old"]);
    expect(await undoTeamChange(owner, r.undoToken!)).toEqual({ restored: 1 });
    expect((inv("inv-old").expiresAt as Date).getTime()).toBe(prev);
    // Replay: the state matches again (an ABA), so only the once-marker stops it.
    inv("inv-old").expiresAt = new Date(replayNew(r.undoToken!));
    await expect(undoTeamChange(owner, r.undoToken!)).rejects.toThrow(/already undone/i);
  });

  it("cooldown: at most one resend per invitation per 10 minutes, enforced on the server", async () => {
    const first = await resendInvitations(owner, ["inv-old"]);
    expect(first.changed).toBe(1);
    const again = await resendInvitations(owner, ["inv-old"]);
    expect(again.changed).toBe(0);
    expect(again.skipped[0].reason).toMatch(/sent just now/i);
    expect(db.emails).toHaveLength(1);
    vi.setSystemTime(Date.now() + 11 * 60 * 1000);
    const later = await resendInvitations(owner, ["inv-old"]);
    expect(later.changed).toBe(1);
    expect(db.emails).toHaveLength(2);
  });

  it("cooldown holds across an Undo: resend -> Undo -> resend can't mail someone in a loop", async () => {
    const first = await resendInvitations(owner, ["inv-old"]);
    await undoTeamChange(owner, first.undoToken!);
    const again = await resendInvitations(owner, ["inv-old"]);
    expect(again.changed).toBe(0);
    expect(db.emails).toHaveLength(1);
  });

  it("a freshly created invitation (sent just now) can't be resent immediately either", async () => {
    inv("inv-1").expiresAt = new Date(Date.now() + 7 * DAY);
    const r = await resendInvitations(owner, ["inv-1"]);
    expect(r.changed).toBe(0);
    expect(r.skipped[0].reason).toMatch(/sent just now/i);
  });

  it("Undo refuses when the invitation has moved on since", async () => {
    const r = await resendInvitations(owner, ["inv-1"]);
    inv("inv-1").status = "accepted";
    await expect(undoTeamChange(owner, r.undoToken!)).rejects.toThrow(/changed since/i);
  });
});

describe("Revoke Undo brings back the same row only when that is safe", () => {
  it("restores the identical invitation (same id, same expiry)", async () => {
    const prev = (inv("inv-1").expiresAt as Date).getTime();
    const r = await revokeInvitations(owner, ["inv-1"]);
    expect(inv("inv-1").status).toBe("cancelled");
    await undoTeamChange(owner, r.undoToken!);
    expect(inv("inv-1").status).toBe("pending");
    expect((inv("inv-1").expiresAt as Date).getTime()).toBe(prev);
  });

  it("refuses when the same email was invited again, or has joined, in the meantime", async () => {
    const r = await revokeInvitations(owner, ["inv-1"]);
    db.invitations.push({ id: "inv-new", organizationId: ORG, email: "new@x.co", role: "member", status: "pending", expiresAt: new Date(db.now + DAY) });
    await expect(undoTeamChange(owner, r.undoToken!)).rejects.toThrow(/invited again or has joined/i);
    expect(inv("inv-1").status).toBe("cancelled");

    db.invitations.pop();
    const r2 = await revokeInvitations(owner, ["inv-old"]);
    db.members.push({ id: "m-new", organizationId: ORG, userId: "u-new", role: "member", userEmail: "old@x.co" });
    await expect(undoTeamChange(owner, r2.undoToken!)).rejects.toThrow(/invited again or has joined/i);
  });
});

describe("role Undo is exact and guarded", () => {
  it("restores each member to the role they held, and only the author can", async () => {
    const r = await changeMemberRoles(owner, ["m-mgr", "m-view"], "member");
    await expect(undoTeamChange(admin, r.undoToken!)).rejects.toThrow(/only the person who made/i);
    expect(await undoTeamChange(owner, r.undoToken!)).toEqual({ restored: 2 });
    expect(role("m-mgr")).toBe("manager");
    expect(role("m-view")).toBe("viewer");
  });

  it("refuses all-or-nothing when any member's role moved on since", async () => {
    const r = await changeMemberRoles(owner, ["m-mgr", "m-view"], "member");
    db.members.find((m) => m.id === "m-view")!.role = "warehouse";
    await expect(undoTeamChange(owner, r.undoToken!)).rejects.toThrow(/changed since/i);
    expect(role("m-mgr")).toBe("member");
  });

  it("pre-checks EVERY row before writing anything, and a refused Undo does not burn the token", async () => {
    const r = await changeMemberRoles(owner, ["m-mgr", "m-view"], "member");
    db.members.find((m) => m.id === "m-view")!.role = "warehouse";
    db.mirror["u-view"] = "warehouse";
    await expect(undoTeamChange(owner, r.undoToken!)).rejects.toThrow(/changed since/i);
    expect(role("m-mgr")).toBe("member"); // the first row was NOT restored
    expect(db.markers.size).toBe(0); // the once-marker was never claimed
    // Put the second row back as the write left it: the same token now works.
    db.members.find((m) => m.id === "m-view")!.role = "member";
    db.mirror["u-view"] = "member";
    expect(await undoTeamChange(owner, r.undoToken!)).toEqual({ restored: 2 });
  });

  it("refuses when Prisma and the Convex mirror disagree about a member", async () => {
    const r = await changeMemberRoles(owner, ["m-mgr"], "member");
    db.mirror["u-mgr"] = "admin"; // the mirror drifted
    await expect(undoTeamChange(owner, r.undoToken!)).rejects.toThrow(/out of sync/i);
    expect(role("m-mgr")).toBe("member");
    expect(db.markers.size).toBe(0);
  });

  it("apply is one transaction: a role that moves between the pre-check and the write rolls EVERYTHING back", async () => {
    const r = await changeMemberRoles(owner, ["m-mgr", "m-view"], "member");
    // While the Undo reads the mirror for the second member (after its Prisma pre-check), another
    // writer changes the FIRST member: the in-transaction compare-and-set must catch it.
    let reads = 0;
    db.onMirrorRead = () => {
      reads += 1;
      if (reads === 2) db.members.find((m) => m.id === "m-mgr")!.role = "warehouse";
    };
    await expect(undoTeamChange(owner, r.undoToken!)).rejects.toThrow(/changed since/i);
    expect(role("m-view")).toBe("member"); // not left half-restored
    expect(role("m-mgr")).toBe("warehouse");
  });

  it("if the mirror fails during the Undo, Prisma is put back and the failure is reported", async () => {
    const r = await changeMemberRoles(owner, ["m-mgr"], "member");
    db.failMirror = true;
    await expect(undoTeamChange(owner, r.undoToken!)).rejects.toThrow(/couldn't sync permissions/i);
    expect(role("m-mgr")).toBe("member");
  });

  it("refuses after the 10 minute server window", async () => {
    const r = await changeMemberRoles(owner, ["m-mgr"], "member");
    vi.setSystemTime(Date.now() + 11 * 60 * 1000);
    await expect(undoTeamChange(owner, r.undoToken!)).rejects.toThrow(/within 10 minutes/i);
  });

  it("a tampered or forged token is refused: the client cannot choose what to restore", async () => {
    const r = await changeMemberRoles(owner, ["m-mgr"], "member");
    const [enc, sig] = r.undoToken!.split(".");
    const body = JSON.parse(Buffer.from(enc, "base64url").toString());
    body.body.items[0].from = "admin";
    const forged = `${Buffer.from(JSON.stringify(body)).toString("base64url")}.${sig}`;
    await expect(undoTeamChange(owner, forged)).rejects.toThrow(/no longer valid/i);

    const own = createTeamUndoToken({ orgId: ORG, actorId: owner.userId, body: { kind: "role", items: [{ memberId: "m-mgr", from: "admin", to: "member" }] } });
    expect(own.token).toBeTruthy(); // a genuine token for an escalating restore still can't pass the policy:
    await expect(undoTeamChange(admin, own.token)).rejects.toThrow();
  });

  it("an Undo can't be used to promote above the actor's rights (policy re-checked at undo time)", async () => {
    const r = await changeMemberRoles(admin, ["m-mgr"], "viewer");
    // The admin was demoted to member before undoing: restoring a manager is now above their rights.
    const demoted: TeamActor = { ...admin, role: "manager" };
    await expect(undoTeamChange(demoted, r.undoToken!)).rejects.toThrow();
    expect(role("m-mgr")).toBe("viewer");
  });

  it("an Undo from another org's session is refused", async () => {
    const r = await changeMemberRoles(owner, ["m-mgr"], "member");
    await expect(undoTeamChange({ ...owner, organizationId: "org2" }, r.undoToken!)).rejects.toThrow(/only the person who made/i);
  });
});
