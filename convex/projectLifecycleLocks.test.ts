// @vitest-environment node
import { convexTest } from "convex-test";
import { describe, test, expect } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";
import { register as registerRateLimiter } from "@convex-dev/rate-limiter/test";
import { register as registerShardedCounter } from "@convex-dev/sharded-counter/test";

/**
 * Integration coverage for the #957 lifecycle-lock program (#791 finance
 * soft-lock, #793 ON_SITE justification gate, #792 hard-lock + snapshots).
 * Exercises the shared `assertLifecycleGuard` through real mutations rather
 * than re-testing its pure logic (see convex/lib/projectLocks.test.ts).
 */
const modules = import.meta.glob("./**/*.ts");
function makeT() {
  const t = convexTest(schema, modules);
  registerRateLimiter(t, "rateLimiter");
  registerShardedCounter(t, "shardedCounter");
  return t;
}

const ORG = "org_1";
const USER = "user_1";
const NOW = 1_700_000_000_000;
const asUser = () => ({ subject: USER, orgId: ORG });
const ACTOR = { userId: USER, userName: "Alice" };
const JUSTIFICATION = "Client requested a change on site during load-in.";

async function member(t: ReturnType<typeof makeT>, role: string) {
  await t.run(async (ctx) => {
    const existing = await ctx.db.query("members").withIndex("by_org_user", (q) => q.eq("organizationId", ORG).eq("userId", USER)).first();
    if (existing) await ctx.db.patch(existing._id, { role });
    else await ctx.db.insert("members", { id: "m", organizationId: ORG, userId: USER, role });
  });
}

async function project(t: ReturnType<typeof convexTest>, status: string, extra: Record<string, unknown> = {}) {
  await t.run(async (ctx) => {
    await ctx.db.insert("projects", {
      id: "p1", organizationId: ORG, projectNumber: "P-1", name: "Test Gig",
      status, isTemplate: false, taxRate: 10, discountPercent: 0,
      createdAt: NOW, updatedAt: NOW, ...extra,
    });
  });
}

describe("#791 finance soft-lock — projectWrites.updateNative", () => {
  test("member cannot edit a locked money field on a CONFIRMED project with no open session", async () => {
    const t = makeT();
    await member(t, "member");
    await project(t, "CONFIRMED");
    await expect(
      t.withIdentity(asUser()).mutation(api.projectWrites.updateNative, {
        id: "p1", orgId: ORG, set: { taxRate: 20 }, clear: [], actor: ACTOR, auditId: "log1", now: NOW,
      }),
    ).rejects.toThrow(/FINANCIALS_LOCKED|locked/i);
  });

  test("non-money fields stay editable on a CONFIRMED project", async () => {
    const t = makeT();
    await member(t, "member");
    await project(t, "CONFIRMED");
    await t.withIdentity(asUser()).mutation(api.projectWrites.updateNative, {
      id: "p1", orgId: ORG, set: { name: "Renamed Gig" }, clear: [], actor: ACTOR, auditId: "log1", now: NOW,
    });
    await t.run(async (ctx) => {
      const p = await ctx.db.query("projects").withIndex("by_cuid", (q) => q.eq("id", "p1")).first();
      expect(p?.name).toBe("Renamed Gig");
    });
  });

  test("with an open FINANCIAL session, the money field edit succeeds and is tagged with the session id", async () => {
    const t = makeT();
    await member(t, "member");
    await project(t, "CONFIRMED");
    const { sessionId } = await t.withIdentity(asUser()).mutation(api.projectUnlockSessionsWrites.openNative, {
      projectId: "p1", orgId: ORG, scope: "FINANCIAL", justification: JUSTIFICATION, actor: ACTOR, auditId: "openlog", now: NOW,
    });
    await t.withIdentity(asUser()).mutation(api.projectWrites.updateNative, {
      id: "p1", orgId: ORG, set: { taxRate: 20 }, clear: [], actor: ACTOR, auditId: "log2", now: NOW + 1,
    });
    await t.run(async (ctx) => {
      const p = await ctx.db.query("projects").withIndex("by_cuid", (q) => q.eq("id", "p1")).first();
      expect(Number(p?.taxRate)).toBe(20);
      const log = await ctx.db.query("activityLogs").withIndex("by_cuid", (q) => q.eq("id", "log2")).first();
      expect((log?.metadata as { unlockSessionId?: string } | undefined)?.unlockSessionId).toBe(sessionId);
    });
  });

  test("an OPEN-tier project is never gated", async () => {
    const t = makeT();
    await member(t, "member");
    await project(t, "QUOTED");
    await t.withIdentity(asUser()).mutation(api.projectWrites.updateNative, {
      id: "p1", orgId: ORG, set: { taxRate: 20 }, clear: [], actor: ACTOR, auditId: "log1", now: NOW,
    });
    await t.run(async (ctx) => {
      const p = await ctx.db.query("projects").withIndex("by_cuid", (q) => q.eq("id", "p1")).first();
      expect(Number(p?.taxRate)).toBe(20);
    });
  });
});

describe("#791 $0 default on add — lineItemWrites.addCustomNative", () => {
  const fields = { description: "Extra cable", quantity: 1, unitPrice: 500, discount: 50 };

  test("locked with no session: unitPrice is forced to 0 server-side (ignores the client value)", async () => {
    const t = makeT();
    await member(t, "member");
    await project(t, "CONFIRMED");
    await t.withIdentity(asUser()).mutation(api.lineItemWrites.addCustomNative, {
      id: "li1", organizationId: ORG, projectId: "p1", fields, actor: ACTOR, auditId: "log1", now: NOW,
    });
    await t.run(async (ctx) => {
      const li = await ctx.db.query("projectLineItems").withIndex("by_cuid", (q) => q.eq("id", "li1")).first();
      expect(li?.unitPrice).toBe(0);
      expect(li?.discount).toBeUndefined();
    });
  });

  test("unlocked (OPEN tier): the client's price is kept", async () => {
    const t = makeT();
    await member(t, "member");
    await project(t, "QUOTED");
    await t.withIdentity(asUser()).mutation(api.lineItemWrites.addCustomNative, {
      id: "li1", organizationId: ORG, projectId: "p1", fields, actor: ACTOR, auditId: "log1", now: NOW,
    });
    await t.run(async (ctx) => {
      const li = await ctx.db.query("projectLineItems").withIndex("by_cuid", (q) => q.eq("id", "li1")).first();
      expect(Number(li?.unitPrice)).toBe(500);
    });
  });

  test("inside an open session, auto-pricing resumes (the client's price is kept)", async () => {
    const t = makeT();
    await member(t, "member");
    await project(t, "CONFIRMED");
    await t.withIdentity(asUser()).mutation(api.projectUnlockSessionsWrites.openNative, {
      projectId: "p1", orgId: ORG, scope: "FINANCIAL", justification: JUSTIFICATION, actor: ACTOR, auditId: "openlog", now: NOW,
    });
    await t.withIdentity(asUser()).mutation(api.lineItemWrites.addCustomNative, {
      id: "li1", organizationId: ORG, projectId: "p1", fields, actor: ACTOR, auditId: "log1", now: NOW + 1,
    });
    await t.run(async (ctx) => {
      const li = await ctx.db.query("projectLineItems").withIndex("by_cuid", (q) => q.eq("id", "li1")).first();
      expect(Number(li?.unitPrice)).toBe(500);
    });
  });
});

describe("#793 ON_SITE justification gate", () => {
  const fields = { description: "Extra cable", quantity: 1 };

  test("a structural add on an ON_SITE project without a justification is rejected", async () => {
    const t = makeT();
    await member(t, "member");
    await project(t, "ON_SITE");
    await expect(
      t.withIdentity(asUser()).mutation(api.lineItemWrites.addCustomNative, {
        id: "li1", organizationId: ORG, projectId: "p1", fields, actor: ACTOR, auditId: "log1", now: NOW,
      }),
    ).rejects.toThrow(/JUSTIFICATION_REQUIRED|describe why/i);
  });

  test("a too-short justification is also rejected", async () => {
    const t = makeT();
    await member(t, "member");
    await project(t, "ON_SITE");
    await expect(
      t.withIdentity(asUser()).mutation(api.lineItemWrites.addCustomNative, {
        id: "li1", organizationId: ORG, projectId: "p1", fields, justification: "too short", actor: ACTOR, auditId: "log1", now: NOW,
      }),
    ).rejects.toThrow(/JUSTIFICATION_REQUIRED|describe why/i);
  });

  test("a valid justification succeeds and is persisted to the audit row", async () => {
    const t = makeT();
    await member(t, "member");
    await project(t, "ON_SITE");
    await t.withIdentity(asUser()).mutation(api.lineItemWrites.addCustomNative, {
      id: "li1", organizationId: ORG, projectId: "p1", fields, justification: JUSTIFICATION, actor: ACTOR, auditId: "log1", now: NOW,
    });
    await t.run(async (ctx) => {
      const log = await ctx.db.query("activityLogs").withIndex("by_cuid", (q) => q.eq("id", "log1")).first();
      expect((log?.metadata as { justification?: string } | undefined)?.justification).toBe(JUSTIFICATION);
    });
  });

  test("an open session suppresses the per-edit justification prompt (no double-prompt)", async () => {
    const t = makeT();
    await member(t, "member");
    await project(t, "ON_SITE");
    await t.withIdentity(asUser()).mutation(api.projectUnlockSessionsWrites.openNative, {
      projectId: "p1", orgId: ORG, scope: "FINANCIAL", justification: JUSTIFICATION, actor: ACTOR, auditId: "openlog", now: NOW,
    });
    await t.withIdentity(asUser()).mutation(api.lineItemWrites.addCustomNative, {
      id: "li1", organizationId: ORG, projectId: "p1", fields, actor: ACTOR, auditId: "log1", now: NOW + 1,
    });
    await t.run(async (ctx) => {
      const li = await ctx.db.query("projectLineItems").withIndex("by_cuid", (q) => q.eq("id", "li1")).first();
      expect(li).not.toBeNull();
    });
  });

  test("crew-assignment create on ON_SITE requires justification too", async () => {
    const t = makeT();
    await member(t, "manager"); // crew:create needs manager+
    await project(t, "ON_SITE");
    await t.run(async (ctx) => {
      await ctx.db.insert("crewMembers", { id: "cm1", organizationId: ORG, firstName: "Sam", lastName: "Rigger" });
    });
    await expect(
      t.withIdentity(asUser()).mutation(api.crewAssignmentsWrites.createNative, {
        id: "asg1", orgId: ORG, projectId: "p1", crewMemberId: "cm1", now: NOW, actor: ACTOR, auditId: "log1",
      }),
    ).rejects.toThrow(/JUSTIFICATION_REQUIRED/i);
  });
});

describe("#792 hard lock (COMPLETED/INVOICED)", () => {
  test("every gate site rejects without an open FULL session", async () => {
    const t = makeT();
    await member(t, "member");
    await project(t, "COMPLETED");
    await expect(
      t.withIdentity(asUser()).mutation(api.lineItemWrites.addCustomNative, {
        id: "li1", organizationId: ORG, projectId: "p1", fields: { description: "x", quantity: 1 }, actor: ACTOR, auditId: "log1", now: NOW,
      }),
    ).rejects.toThrow(/PROJECT_LOCKED/i);
  });

  test("opening a FULL session is denied to a plain member (not admin/owner/PM)", async () => {
    const t = makeT();
    await member(t, "member");
    await project(t, "COMPLETED");
    await expect(
      t.withIdentity(asUser()).mutation(api.projectUnlockSessionsWrites.openNative, {
        projectId: "p1", orgId: ORG, scope: "FULL", justification: JUSTIFICATION, actor: ACTOR, auditId: "openlog", now: NOW,
      }),
    ).rejects.toThrow(/FORBIDDEN_HARD_LOCK_OVERRIDE|not allowed/i);
  });

  test("an org admin CAN open a FULL session, and structural writes then succeed", async () => {
    const t = makeT();
    await member(t, "admin");
    await project(t, "COMPLETED");
    await t.withIdentity(asUser()).mutation(api.projectUnlockSessionsWrites.openNative, {
      projectId: "p1", orgId: ORG, scope: "FULL", justification: JUSTIFICATION, actor: ACTOR, auditId: "openlog", now: NOW,
    });
    await t.withIdentity(asUser()).mutation(api.lineItemWrites.addCustomNative, {
      id: "li1", organizationId: ORG, projectId: "p1", fields: { description: "x", quantity: 1, unitPrice: 100 }, actor: ACTOR, auditId: "log1", now: NOW + 1,
    });
    await t.run(async (ctx) => {
      const li = await ctx.db.query("projectLineItems").withIndex("by_cuid", (q) => q.eq("id", "li1")).first();
      expect(Number(li?.unitPrice)).toBe(100); // auto-pricing resumes inside an open session
    });
  });

  test("a project's assigned PM (not admin/owner) can also open a FULL session", async () => {
    const t = makeT();
    await member(t, "member");
    await project(t, "COMPLETED");
    await t.run(async (ctx) => {
      await ctx.db.insert("projectManagers", { id: "pm1", organizationId: ORG, projectId: "p1", userId: USER, addedAt: NOW });
    });
    await t.withIdentity(asUser()).mutation(api.projectUnlockSessionsWrites.openNative, {
      projectId: "p1", orgId: ORG, scope: "FULL", justification: JUSTIFICATION, actor: ACTOR, auditId: "openlog", now: NOW,
    });
    await t.run(async (ctx) => {
      const session = await ctx.db.query("projectUnlockSessions").withIndex("by_projectId_outcome", (q) => q.eq("projectId", "p1").eq("outcome", "OPEN")).first();
      expect(session?.scope).toBe("FULL");
    });
  });

  test("reverting status out of COMPLETED requires the same audience + a justification", async () => {
    const t = makeT();
    await member(t, "member");
    await project(t, "COMPLETED");
    await expect(
      t.withIdentity(asUser()).mutation(api.projectWrites.updateStatusNative, {
        id: "p1", orgId: ORG, status: "ON_SITE", actor: ACTOR, auditId: "log1", now: NOW,
      }),
    ).rejects.toThrow(/FORBIDDEN_HARD_LOCK_OVERRIDE|not allowed/i);

    await member(t, "admin");
    await expect(
      t.withIdentity(asUser()).mutation(api.projectWrites.updateStatusNative, {
        id: "p1", orgId: ORG, status: "ON_SITE", actor: ACTOR, auditId: "log2", now: NOW,
      }),
    ).rejects.toThrow(/JUSTIFICATION_REQUIRED/i);

    await t.withIdentity(asUser()).mutation(api.projectWrites.updateStatusNative, {
      id: "p1", orgId: ORG, status: "ON_SITE", justification: JUSTIFICATION, actor: ACTOR, auditId: "log3", now: NOW,
    });
    await t.run(async (ctx) => {
      const p = await ctx.db.query("projects").withIndex("by_cuid", (q) => q.eq("id", "p1")).first();
      expect(p?.status).toBe("ON_SITE");
    });
  });

  test("COMPLETED -> INVOICED is a normal forward move — no audience/justification gate", async () => {
    const t = makeT();
    await member(t, "member");
    await project(t, "COMPLETED");
    await t.withIdentity(asUser()).mutation(api.projectWrites.updateStatusNative, {
      id: "p1", orgId: ORG, status: "INVOICED", actor: ACTOR, auditId: "log1", now: NOW,
    });
    await t.run(async (ctx) => {
      const p = await ctx.db.query("projects").withIndex("by_cuid", (q) => q.eq("id", "p1")).first();
      expect(p?.status).toBe("INVOICED");
    });
  });
});

describe("#792 snapshot capture at CONFIRMED/COMPLETED", () => {
  test("a forward crossing into CONFIRMED captures a snapshot with the project + its line items", async () => {
    const t = makeT();
    await member(t, "member");
    await project(t, "QUOTED");
    await t.run(async (ctx) => {
      await ctx.db.insert("projectLineItems", { id: "li1", organizationId: ORG, projectId: "p1", description: "Speaker", unitPrice: 100, quantity: 1 });
    });
    await t.withIdentity(asUser()).mutation(api.projectWrites.updateStatusNative, {
      id: "p1", orgId: ORG, status: "CONFIRMED", actor: ACTOR, auditId: "log1", now: NOW,
    });
    await t.run(async (ctx) => {
      const snaps = await ctx.db.query("projectSnapshots").withIndex("by_projectId", (q) => q.eq("projectId", "p1")).collect();
      expect(snaps).toHaveLength(1);
      expect(snaps[0].reason).toBe("CONFIRMED");
      const entries = await ctx.db.query("projectSnapshotEntries").withIndex("by_snapshotId", (q) => q.eq("snapshotId", snaps[0].id)).collect();
      const types = entries.map((e) => e.entityType).sort();
      expect(types).toContain("project");
      expect(types).toContain("lineItem");
    });
  });

  test("re-crossing into CONFIRMED takes a NEW snapshot (versioned, never overwritten)", async () => {
    const t = makeT();
    await member(t, "member");
    await project(t, "QUOTED");
    await t.withIdentity(asUser()).mutation(api.projectWrites.updateStatusNative, {
      id: "p1", orgId: ORG, status: "CONFIRMED", actor: ACTOR, auditId: "log1", now: NOW,
    });
    await t.withIdentity(asUser()).mutation(api.projectWrites.updateStatusNative, {
      id: "p1", orgId: ORG, status: "QUOTED", actor: ACTOR, auditId: "log2", now: NOW + 1,
    });
    await t.withIdentity(asUser()).mutation(api.projectWrites.updateStatusNative, {
      id: "p1", orgId: ORG, status: "CONFIRMED", actor: ACTOR, auditId: "log3", now: NOW + 2,
    });
    await t.run(async (ctx) => {
      const snaps = await ctx.db.query("projectSnapshots").withIndex("by_projectId", (q) => q.eq("projectId", "p1")).collect();
      expect(snaps).toHaveLength(2);
    });
  });
});

describe("#791 unlock-session lifecycle", () => {
  test("at most one open session per project", async () => {
    const t = makeT();
    await member(t, "member");
    await project(t, "CONFIRMED");
    await t.withIdentity(asUser()).mutation(api.projectUnlockSessionsWrites.openNative, {
      projectId: "p1", orgId: ORG, scope: "FINANCIAL", justification: JUSTIFICATION, actor: ACTOR, auditId: "log1", now: NOW,
    });
    await expect(
      t.withIdentity(asUser()).mutation(api.projectUnlockSessionsWrites.openNative, {
        projectId: "p1", orgId: ORG, scope: "FINANCIAL", justification: JUSTIFICATION, actor: ACTOR, auditId: "log2", now: NOW + 1,
      }),
    ).rejects.toThrow(/SESSION_ALREADY_OPEN/i);
  });

  test("save & relock commits the session; a subsequent edit is rejected again", async () => {
    const t = makeT();
    await member(t, "member");
    await project(t, "CONFIRMED");
    await t.withIdentity(asUser()).mutation(api.projectUnlockSessionsWrites.openNative, {
      projectId: "p1", orgId: ORG, scope: "FINANCIAL", justification: JUSTIFICATION, actor: ACTOR, auditId: "log1", now: NOW,
    });
    await t.withIdentity(asUser()).mutation(api.projectWrites.updateNative, {
      id: "p1", orgId: ORG, set: { taxRate: 20 }, clear: [], actor: ACTOR, auditId: "log2", now: NOW + 1,
    });
    await t.withIdentity(asUser()).mutation(api.projectUnlockSessionsWrites.commitNative, {
      projectId: "p1", orgId: ORG, actor: ACTOR, auditId: "log3", now: NOW + 2,
    });
    await t.run(async (ctx) => {
      const p = await ctx.db.query("projects").withIndex("by_cuid", (q) => q.eq("id", "p1")).first();
      expect(Number(p?.taxRate)).toBe(20); // committed change survives relock
    });
    await expect(
      t.withIdentity(asUser()).mutation(api.projectWrites.updateNative, {
        id: "p1", orgId: ORG, set: { taxRate: 30 }, clear: [], actor: ACTOR, auditId: "log4", now: NOW + 3,
      }),
    ).rejects.toThrow(/FINANCIALS_LOCKED/i);
  });

  test("discard restores the FINANCIAL fields captured at open, but keeps structural adds ($0)", async () => {
    const t = makeT();
    await member(t, "member");
    await project(t, "CONFIRMED");
    await t.withIdentity(asUser()).mutation(api.projectUnlockSessionsWrites.openNative, {
      projectId: "p1", orgId: ORG, scope: "FINANCIAL", justification: JUSTIFICATION, actor: ACTOR, auditId: "log1", now: NOW,
    });
    await t.withIdentity(asUser()).mutation(api.projectWrites.updateNative, {
      id: "p1", orgId: ORG, set: { taxRate: 20 }, clear: [], actor: ACTOR, auditId: "log2", now: NOW + 1,
    });
    await t.withIdentity(asUser()).mutation(api.lineItemWrites.addCustomNative, {
      id: "li1", organizationId: ORG, projectId: "p1", fields: { description: "Added mid-session", quantity: 1, unitPrice: 250 }, actor: ACTOR, auditId: "log3", now: NOW + 2,
    });
    const { conflicts } = await t.withIdentity(asUser()).mutation(api.projectUnlockSessionsWrites.discardNative, {
      projectId: "p1", orgId: ORG, actor: ACTOR, auditId: "log4", now: NOW + 3,
    });
    expect(conflicts).toEqual([]);
    await t.run(async (ctx) => {
      const p = await ctx.db.query("projects").withIndex("by_cuid", (q) => q.eq("id", "p1")).first();
      expect(Number(p?.taxRate)).toBe(10); // reverted to the pre-unlock value
      const li = await ctx.db.query("projectLineItems").withIndex("by_cuid", (q) => q.eq("id", "li1")).first();
      expect(li).not.toBeNull(); // the add survives (structural changes aren't rolled back)
      expect(li?.unitPrice).toBe(0); // but its price reverts to $0/unpriced
    });
  });

  test("a forward status transition auto-commits an open session", async () => {
    const t = makeT();
    await member(t, "member");
    await project(t, "CONFIRMED");
    await t.withIdentity(asUser()).mutation(api.projectUnlockSessionsWrites.openNative, {
      projectId: "p1", orgId: ORG, scope: "FINANCIAL", justification: JUSTIFICATION, actor: ACTOR, auditId: "log1", now: NOW,
    });
    await t.withIdentity(asUser()).mutation(api.projectWrites.updateStatusNative, {
      id: "p1", orgId: ORG, status: "PREPPING", actor: ACTOR, auditId: "log2", now: NOW + 1,
    });
    await t.run(async (ctx) => {
      const session = await ctx.db
        .query("projectUnlockSessions")
        .withIndex("by_projectId", (q) => q.eq("projectId", "p1"))
        .first();
      expect(session?.outcome).toBe("COMMITTED");
    });
  });
});
