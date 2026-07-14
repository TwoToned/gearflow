// @vitest-environment node
//
// convex/clientWrites.ts — browser-direct client write mutations. Verifies the
// standard wave-2 CRUD shape: create/update/notes/archive with RBAC, per-row org
// re-check (no cross-tenant write), and atomic audit.
import { convexTest } from "convex-test";
import { register as registerRateLimiter } from "@convex-dev/rate-limiter/test";
import { describe, test, expect } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";

const modules = import.meta.glob("./**/*.ts");
const ORG = "org_1";
const OTHER = "org_2";
const USER = "user_1";
const NOW = 1_700_000_000_000;
const actor = { userId: USER, userName: "Alice" };
const asUser = { subject: USER, orgId: ORG };

function makeT() {
  const t = convexTest(schema, modules);
  registerRateLimiter(t, "rateLimiter");
  return t;
}

async function seedMember(t: ReturnType<typeof makeT>) {
  await t.run(async (ctx) => {
    await ctx.db.insert("members", { id: "m1", organizationId: ORG, userId: USER, role: "owner" });
  });
}

const getClient = (t: ReturnType<typeof makeT>, id: string) =>
  t.run(async (ctx) => ctx.db.query("clients").withIndex("by_cuid", (q) => q.eq("id", id)).first());

describe("clientWrites", () => {
  test("create → update → notes → archive, with audit", async () => {
    const t = makeT();
    await seedMember(t);

    await t.withIdentity(asUser).mutation(api.clientWrites.createNative, {
      id: "c1", organizationId: ORG, name: "Acme", type: "COMPANY",
      createdAt: NOW, updatedAt: NOW, actor, auditId: "a1",
    });
    expect((await getClient(t, "c1"))?.name).toBe("Acme");

    await t.withIdentity(asUser).mutation(api.clientWrites.updateNative, {
      id: "c1", orgId: ORG, patch: { name: "Acme Ltd", contactEmail: "x@y.z" }, actor, auditId: "a2", now: NOW + 1,
    });
    const updated = await getClient(t, "c1");
    expect(updated?.name).toBe("Acme Ltd");
    expect(updated?.contactEmail).toBe("x@y.z");

    await t.withIdentity(asUser).mutation(api.clientWrites.updateNotesNative, {
      id: "c1", orgId: ORG, notes: "VIP", actor, auditId: "a3", now: NOW + 2,
    });
    expect((await getClient(t, "c1"))?.notes).toBe("VIP");

    await t.withIdentity(asUser).mutation(api.clientWrites.archiveNative, {
      id: "c1", orgId: ORG, actor, auditId: "a4", now: NOW + 3,
    });
    expect((await getClient(t, "c1"))?.isActive).toBe(false);

    // audit rows written for each action
    const logs = await t.run(async (ctx) =>
      ctx.db.query("activityLogs").withIndex("by_cuid", (q) => q.eq("id", "a1")).collect(),
    );
    expect(logs.length).toBe(1);
  });

  test("update rejects a client in another org (no cross-tenant write)", async () => {
    const t = makeT();
    await seedMember(t);
    await t.run(async (ctx) => {
      await ctx.db.insert("clients", { id: "cX", organizationId: OTHER, name: "Other", createdAt: NOW, updatedAt: NOW });
    });
    await expect(
      t.withIdentity(asUser).mutation(api.clientWrites.updateNative, {
        id: "cX", orgId: ORG, patch: { name: "hijack" }, actor, auditId: "a9", now: NOW,
      }),
    ).rejects.toThrow(/Forbidden|organization/i);
    expect((await getClient(t, "cX"))?.name).toBe("Other");
  });

  test("create rejects a non-member (RBAC)", async () => {
    const t = makeT();
    // no member row for USER
    await expect(
      t.withIdentity(asUser).mutation(api.clientWrites.createNative, {
        id: "c2", organizationId: ORG, name: "Nope", actor, auditId: "a10",
      }),
    ).rejects.toThrow();
  });

  test("archiveMany: bulk-archives own clients, skips foreign, idempotent, one audit each", async () => {
    const t = makeT();
    await seedMember(t);
    await t.run(async (ctx) => {
      await ctx.db.insert("clients", { id: "c1", organizationId: ORG, name: "Acme", isActive: true, createdAt: NOW, updatedAt: NOW });
      await ctx.db.insert("clients", { id: "c2", organizationId: ORG, name: "Beta", isActive: true, createdAt: NOW, updatedAt: NOW });
      await ctx.db.insert("clients", { id: "c3", organizationId: ORG, name: "Gone", isActive: false, createdAt: NOW, updatedAt: NOW }); // already archived
      await ctx.db.insert("clients", { id: "cX", organizationId: OTHER, name: "Other", isActive: true, createdAt: NOW, updatedAt: NOW });
    });

    const res = await t.withIdentity(asUser).mutation(api.clientWrites.archiveManyNative, {
      orgId: ORG,
      items: [
        { id: "c1", auditId: "b1" },
        { id: "c2", auditId: "b2" },
        { id: "c3", auditId: "b3" }, // already archived → counted, not re-audited
        { id: "cX", auditId: "bx" }, // foreign org → skipped
        { id: "missing", auditId: "bm" }, // missing → skipped
      ],
      actor,
      now: NOW + 1,
    });
    // c1, c2, c3 are org-matched → counted (3); cX + missing skipped.
    expect(res).toEqual({ archived: 3 });

    expect((await getClient(t, "c1"))?.isActive).toBe(false);
    expect((await getClient(t, "c2"))?.isActive).toBe(false);
    expect((await getClient(t, "cX"))?.isActive).toBe(true); // untouched

    // One audit row per NEWLY-archived client (c1, c2 only — c3 was already archived).
    const audits = await t.run(async (ctx) =>
      ctx.db.query("activityLogs").withIndex("by_organizationId", (q) => q.eq("organizationId", ORG)).collect(),
    );
    const archiveAudits = audits.filter((a) => a.entityType === "client" && a.action === "DELETE");
    expect(archiveAudits.map((a) => a.entityId).sort()).toEqual(["c1", "c2"]);
  });

  test("archiveMany rejects a non-member (RBAC)", async () => {
    const t = makeT();
    await t.run(async (ctx) => {
      await ctx.db.insert("clients", { id: "c1", organizationId: ORG, name: "Acme", isActive: true, createdAt: NOW, updatedAt: NOW });
    });
    await expect(
      t.withIdentity(asUser).mutation(api.clientWrites.archiveManyNative, {
        orgId: ORG, items: [{ id: "c1", auditId: "b1" }], actor, now: NOW,
      }),
    ).rejects.toThrow();
  });
});
