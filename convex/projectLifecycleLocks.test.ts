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
      status, isTemplate: false, taxRate: 10, discountPercent: 0, revision: 1,
      createdAt: NOW, updatedAt: NOW, ...extra,
    });
  });
}

/** #986 — advancing to CONFIRMED now requires an ACCEPTED quote revision (or an
 *  admin override with a justification). Tests below whose subject is snapshot
 *  capture, not the acceptance gate, satisfy it directly rather than routing
 *  through the whole send/accept flow. The gate itself is covered in
 *  convex/projectWrites.test.ts. */
async function acceptedQuote(t: ReturnType<typeof convexTest>) {
  await t.run(async (ctx) => {
    await ctx.db.insert("quotes", {
      id: "q1", organizationId: ORG, projectId: "p1", version: 1, status: "ACCEPTED",
      snapshot: null, sentAt: NOW, acceptedAt: NOW,
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
      // The Unpriced badge's real signal (bug fix, follow-up to #990): stored at
      // insert time, not inferred later from "currently locked + currently $0".
      expect(li?.pricedUnderLock).toBe(true);
    });
  });

  test("unlocked (OPEN tier): the client's price is kept, and pricedUnderLock is never set", async () => {
    const t = makeT();
    await member(t, "member");
    await project(t, "QUOTED");
    await t.withIdentity(asUser()).mutation(api.lineItemWrites.addCustomNative, {
      id: "li1", organizationId: ORG, projectId: "p1", fields, actor: ACTOR, auditId: "log1", now: NOW,
    });
    await t.run(async (ctx) => {
      const li = await ctx.db.query("projectLineItems").withIndex("by_cuid", (q) => q.eq("id", "li1")).first();
      expect(Number(li?.unitPrice)).toBe(500);
      expect(li?.pricedUnderLock).toBeFalsy();
    });
  });

  test("inside an open session, auto-pricing resumes (the client's price is kept), pricedUnderLock stays unset", async () => {
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
      expect(li?.pricedUnderLock).toBeFalsy();
    });
  });
});

describe("pricedUnderLock — the Unpriced badge's real cause, not an inference (bug fix)", () => {
  test("a line item that's been $0 since BEFORE any lock existed does NOT retroactively earn the badge once the project locks", async () => {
    const t = makeT();
    await member(t, "member");
    // OPEN-tier project — a deliberate $0 line (e.g. no catalog rate, or a
    // genuinely free item) added with nothing locked yet.
    await project(t, "QUOTED");
    await t.withIdentity(asUser()).mutation(api.lineItemWrites.addCustomNative, {
      id: "li1", organizationId: ORG, projectId: "p1",
      fields: { description: "Freebie", quantity: 1, unitPrice: 0 },
      actor: ACTOR, auditId: "log1", now: NOW,
    });
    await t.run(async (ctx) => {
      const li = await ctx.db.query("projectLineItems").withIndex("by_cuid", (q) => q.eq("id", "li1")).first();
      expect(li?.unitPrice).toBe(0);
      expect(li?.pricedUnderLock).toBeFalsy();
    });
    // The project later locks (e.g. quote sent, status advances) — the row's
    // OWN pricedUnderLock is untouched by that transition; only a write to
    // the row itself can ever set it.
    await t.run(async (ctx) => {
      const p = await ctx.db.query("projects").withIndex("by_cuid", (q) => q.eq("id", "p1")).first();
      await ctx.db.patch(p!._id, { status: "CONFIRMED" });
    });
    await t.run(async (ctx) => {
      const li = await ctx.db.query("projectLineItems").withIndex("by_cuid", (q) => q.eq("id", "li1")).first();
      expect(li?.pricedUnderLock).toBeFalsy();
    });
  });

  test("patchNative's unitPrice edit clears a stale pricedUnderLock once a human deliberately prices the row", async () => {
    const t = makeT();
    await member(t, "member");
    await project(t, "CONFIRMED");
    await t.withIdentity(asUser()).mutation(api.lineItemWrites.addCustomNative, {
      id: "li1", organizationId: ORG, projectId: "p1",
      fields: { description: "Extra cable", quantity: 1, unitPrice: 500 },
      actor: ACTOR, auditId: "log1", now: NOW,
    });
    await t.run(async (ctx) => {
      const li = await ctx.db.query("projectLineItems").withIndex("by_cuid", (q) => q.eq("id", "li1")).first();
      expect(li?.pricedUnderLock).toBe(true);
    });
    const { sessionId } = await t.withIdentity(asUser()).mutation(api.projectUnlockSessionsWrites.openNative, {
      projectId: "p1", orgId: ORG, scope: "FINANCIAL", justification: JUSTIFICATION, actor: ACTOR, auditId: "openlog", now: NOW + 1,
    });
    expect(sessionId).toBeTruthy();
    await t.withIdentity(asUser()).mutation(api.lineItemWrites.patchNative, {
      id: "li1", orgId: ORG, entityName: "Extra cable", allowOverbook: false,
      set: { unitPrice: 120, updatedAt: NOW + 2 }, clear: [], actor: ACTOR, auditId: "log2", now: NOW + 2,
    });
    await t.run(async (ctx) => {
      const li = await ctx.db.query("projectLineItems").withIndex("by_cuid", (q) => q.eq("id", "li1")).first();
      expect(Number(li?.unitPrice)).toBe(120);
      expect(li?.pricedUnderLock).toBe(false);
    });
  });

  test("a browser-direct caller cannot set pricedUnderLock via patchNative's set object", async () => {
    const t = makeT();
    await member(t, "member");
    await project(t, "QUOTED");
    await t.withIdentity(asUser()).mutation(api.lineItemWrites.addCustomNative, {
      id: "li1", organizationId: ORG, projectId: "p1",
      fields: { description: "Cable", quantity: 1, unitPrice: 50 },
      actor: ACTOR, auditId: "log1", now: NOW,
    });
    await t.withIdentity(asUser()).mutation(api.lineItemWrites.patchNative, {
      id: "li1", orgId: ORG, entityName: "Cable", allowOverbook: false,
      // duration is a locked field but NOT unitPrice, so this stays a
      // "structural"-ish touch — pricedUnderLock must not flip just because
      // a caller stuffs it into `set`.
      set: { notes: "updated", pricedUnderLock: true, updatedAt: NOW + 1 } as Record<string, unknown>,
      clear: [], actor: ACTOR, auditId: "log2", now: NOW + 1,
    });
    await t.run(async (ctx) => {
      const li = await ctx.db.query("projectLineItems").withIndex("by_cuid", (q) => q.eq("id", "li1")).first();
      expect(li?.notes).toBe("updated");
      expect(li?.pricedUnderLock).toBeFalsy();
    });
  });

  test("a locked group create defaults price to $0 and sets pricedUnderLock; updateGroupPriceNative clears it", async () => {
    const t = makeT();
    await member(t, "member");
    await project(t, "CONFIRMED");
    await t.withIdentity(asUser()).mutation(api.projectGroupsWrites.createGroupNative, {
      id: "g1", orgId: ORG, projectId: "p1", title: "Wireless Mic Kit",
      price: 1400, discount: 210, discountMode: "$",
      now: NOW, actor: ACTOR, auditId: "log1",
    });
    await t.run(async (ctx) => {
      const g = await ctx.db.query("projectGroups").withIndex("by_cuid", (q) => q.eq("id", "g1")).first();
      expect(g?.price).toBeUndefined();
      expect(g?.pricedUnderLock).toBe(true);
    });
    const { sessionId } = await t.withIdentity(asUser()).mutation(api.projectUnlockSessionsWrites.openNative, {
      projectId: "p1", orgId: ORG, scope: "FINANCIAL", justification: JUSTIFICATION, actor: ACTOR, auditId: "openlog", now: NOW + 1,
    });
    expect(sessionId).toBeTruthy();
    // A deliberate discountMode toggle (the exact user report this fix covers) —
    // re-setting price/discount through the group's own price mutation must
    // clear the flag; a group's OWN price edit never touches sibling line items.
    await t.withIdentity(asUser()).mutation(api.projectGroupsWrites.updateGroupPriceNative, {
      id: "g1", orgId: ORG, price: 1400, discount: 15, discountMode: "%",
      now: NOW + 2, actor: ACTOR, auditId: "log2",
    });
    await t.run(async (ctx) => {
      const g = await ctx.db.query("projectGroups").withIndex("by_cuid", (q) => q.eq("id", "g1")).first();
      expect(Number(g?.price)).toBe(1400);
      expect(g?.discountMode).toBe("%");
      expect(g?.pricedUnderLock).toBe(false);
    });
  });

  test("addKitNative under lock flags the kit PARENT line, not its (already-excluded) member children", async () => {
    const t = makeT();
    await member(t, "member");
    await project(t, "CONFIRMED");
    await t.run(async (ctx) => {
      await ctx.db.insert("kits", { id: "k1", organizationId: ORG, assetTag: "TTP00001", name: "RF Kit 1", status: "AVAILABLE" });
    });
    await t.withIdentity(asUser()).mutation(api.lineItemWrites.addKitNative, {
      id: "kl1", organizationId: ORG, projectId: "p1", kitId: "k1",
      unitPrice: 400, pricingMode: "KIT_PRICE", kitLabel: "TTP00001 - RF Kit 1",
      actor: ACTOR, auditId: "log1", now: NOW,
    });
    await t.run(async (ctx) => {
      const parent = await ctx.db.query("projectLineItems").withIndex("by_cuid", (q) => q.eq("id", "kl1")).first();
      expect(parent?.unitPrice).toBe(0);
      expect(parent?.pricedUnderLock).toBe(true);
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
    await acceptedQuote(t);
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
    await acceptedQuote(t);
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

/**
 * #988 (Phase C) — the quote-send lock folds into `assertLifecycleGuard` as a
 * SECOND input, not a second mechanism: an OPEN-status project (ENQUIRY/
 * QUOTING/QUOTED) whose current revision has already been SENT resolves to
 * FINANCE_LOCKED too, with `reason: "QUOTE_SENT"`. Exercises the real quote
 * mutations rather than hand-inserted rows wherever the flow matters (the
 * sanctioned-exit tests) — see convex/lib/projectLocks.test.ts for the pure
 * `resolveLockTier` truth table.
 */
describe("#988 quote-derived lock tier", () => {
  async function sentQuote(t: ReturnType<typeof makeT>, version = 1, extra: Record<string, unknown> = {}) {
    await t.run(async (ctx) => {
      await ctx.db.insert("quotes", {
        id: `q${version}`, organizationId: ORG, projectId: "p1", version, status: "SENT",
        snapshot: null, sentAt: NOW, ...extra,
      });
    });
  }

  test("a SENT quote locks money fields on an otherwise-OPEN (QUOTED) project", async () => {
    const t = makeT();
    await member(t, "member");
    await project(t, "QUOTED");
    await sentQuote(t);
    await t.run(async (ctx) => {
      await ctx.db.insert("projectLineItems", { id: "li1", organizationId: ORG, projectId: "p1", description: "Speaker", unitPrice: 100, quantity: 1, isKitChild: false });
    });
    await expect(
      t.withIdentity(asUser()).mutation(api.lineItemWrites.patchNative, {
        id: "li1", orgId: ORG, set: { unitPrice: 200 }, clear: [], entityName: "Speaker", allowOverbook: false, actor: ACTOR, auditId: "log1", now: NOW,
      }),
    ).rejects.toThrow(/FINANCIALS_LOCKED|locked/i);
  });

  test("structural fields stay editable under a quote-derived lock (FINANCE_LOCKED's structural gate starts at ON_SITE, not here)", async () => {
    const t = makeT();
    await member(t, "member");
    await project(t, "QUOTED");
    await sentQuote(t);
    await t.run(async (ctx) => {
      await ctx.db.insert("projectLineItems", { id: "li1", organizationId: ORG, projectId: "p1", description: "Speaker", unitPrice: 100, quantity: 1, isKitChild: false });
    });
    await t.withIdentity(asUser()).mutation(api.lineItemWrites.patchNative, {
      id: "li1", orgId: ORG, set: { description: "Speaker (updated)" }, clear: [], entityName: "Speaker", allowOverbook: false, actor: ACTOR, auditId: "log1", now: NOW,
    });
    await t.run(async (ctx) => {
      const li = await ctx.db.query("projectLineItems").withIndex("by_cuid", (q) => q.eq("id", "li1")).first();
      expect(li?.description).toBe("Speaker (updated)");
    });
  });

  test("a new add $0-defaults under a quote-derived lock, exactly like a CONFIRMED project", async () => {
    const t = makeT();
    await member(t, "member");
    await project(t, "QUOTED");
    await sentQuote(t);
    await t.withIdentity(asUser()).mutation(api.lineItemWrites.addCustomNative, {
      id: "li1", organizationId: ORG, projectId: "p1",
      fields: { description: "Extra cable", quantity: 1, unitPrice: 500 },
      actor: ACTOR, auditId: "log1", now: NOW,
    });
    await t.run(async (ctx) => {
      const li = await ctx.db.query("projectLineItems").withIndex("by_cuid", (q) => q.eq("id", "li1")).first();
      expect(li?.unitPrice).toBe(0);
    });
  });

  test("an unlock session is still a valid exit while the quote is sent", async () => {
    const t = makeT();
    await member(t, "member");
    await project(t, "QUOTED");
    await sentQuote(t);
    await t.withIdentity(asUser()).mutation(api.projectUnlockSessionsWrites.openNative, {
      projectId: "p1", orgId: ORG, scope: "FINANCIAL", justification: JUSTIFICATION, actor: ACTOR, auditId: "openlog", now: NOW,
    });
    await t.withIdentity(asUser()).mutation(api.lineItemWrites.addCustomNative, {
      id: "li1", organizationId: ORG, projectId: "p1",
      fields: { description: "Extra cable", quantity: 1, unitPrice: 500 },
      actor: ACTOR, auditId: "log1", now: NOW + 1,
    });
    await t.run(async (ctx) => {
      const li = await ctx.db.query("projectLineItems").withIndex("by_cuid", (q) => q.eq("id", "li1")).first();
      expect(Number(li?.unitPrice)).toBe(500); // auto-pricing resumes inside an open session
    });
  });

  test("a sent quote on an ALREADY status-locked (COMPLETED) project softens nothing", async () => {
    const t = makeT();
    await member(t, "member");
    await project(t, "COMPLETED");
    await sentQuote(t);
    await expect(
      t.withIdentity(asUser()).mutation(api.lineItemWrites.addCustomNative, {
        id: "li1", organizationId: ORG, projectId: "p1", fields: { description: "x", quantity: 1 }, actor: ACTOR, auditId: "log1", now: NOW,
      }),
    ).rejects.toThrow(/PROJECT_LOCKED/i);
  });

  test("sanctioned exit: newVersionNative is NOT blocked by the very lock it's cutting past", async () => {
    const t = makeT();
    await member(t, "manager"); // invoice:publish
    await project(t, "QUOTED");
    await sentQuote(t); // v1 SENT — would otherwise raise the tier to FINANCE_LOCKED
    const res = await t.withIdentity(asUser()).mutation(api.quotesWrites.newVersionNative, {
      id: "q2", organizationId: ORG, projectId: "p1", actor: ACTOR, auditId: "logv2", now: NOW + 1,
    });
    expect(res.version).toBe(2);
    await t.run(async (ctx) => {
      const p = await ctx.db.query("projects").withIndex("by_cuid", (q) => q.eq("id", "p1")).first();
      expect(p?.revision).toBe(2);
      const q2 = await ctx.db.query("quotes").withIndex("by_cuid", (q) => q.eq("id", "q2")).first();
      expect(q2?.status).toBe("DRAFT");
    });
  });

  test("after cutting v2, pricing is open again — the current revision's quote is a fresh DRAFT", async () => {
    const t = makeT();
    await member(t, "manager");
    await project(t, "QUOTED");
    await sentQuote(t);
    await t.withIdentity(asUser()).mutation(api.quotesWrites.newVersionNative, {
      id: "q2", organizationId: ORG, projectId: "p1", actor: ACTOR, auditId: "logv2", now: NOW + 1,
    });
    // No unlock session needed — v1's SENT lock no longer applies once v2 (a
    // fresh DRAFT) is the project's current revision.
    await t.withIdentity(asUser()).mutation(api.lineItemWrites.addCustomNative, {
      id: "li1", organizationId: ORG, projectId: "p1",
      fields: { description: "Extra cable", quantity: 1, unitPrice: 500 },
      actor: ACTOR, auditId: "log1", now: NOW + 2,
    });
    await t.run(async (ctx) => {
      const li = await ctx.db.query("projectLineItems").withIndex("by_cuid", (q) => q.eq("id", "li1")).first();
      expect(Number(li?.unitPrice)).toBe(500);
    });
  });

  test("sanctioned exit: sendNative isn't blocked sending v1 for the very first time", async () => {
    const t = makeT();
    await member(t, "manager");
    await project(t, "QUOTED"); // no quote row yet at all
    const res = await t.withIdentity(asUser()).mutation(api.quotesWrites.sendNative, {
      id: "q1", organizationId: ORG, projectId: "p1", quoteDate: NOW, actor: ACTOR, auditId: "logsend", now: NOW,
    });
    expect(res.version).toBe(1);
  });

  test("projectLocksRead.status reports reason QUOTE_SENT + the revision + quote state", async () => {
    const t = makeT();
    await member(t, "member");
    await project(t, "QUOTED");
    await sentQuote(t);
    const status = await t.withIdentity(asUser()).query(api.projectLocksRead.status, { projectId: "p1", orgId: ORG });
    expect(status?.tier).toBe("FINANCE_LOCKED");
    expect(status?.reason).toBe("QUOTE_SENT");
    expect(status?.revision).toBe(1);
    expect(status?.quoteState).toBe("SENT");
  });

  test("projectLocksRead.status reports STATUS-driven FINANCE_LOCKED unaffected by quote state on a CONFIRMED project", async () => {
    const t = makeT();
    await member(t, "member");
    await project(t, "CONFIRMED");
    const status = await t.withIdentity(asUser()).query(api.projectLocksRead.status, { projectId: "p1", orgId: ORG });
    expect(status?.tier).toBe("FINANCE_LOCKED");
    expect(status?.reason).toBe("STATUS");
    expect(status?.quoteState).toBeNull();
  });
});

/**
 * #1080/#1100 (Phase 5) — the QUOTE_SENT escalation must check the LIVE
 * revision's quote (`projectLiveRevision`), never the allocator's
 * (`projectRevision`, the high-water mark). Once a promote (#1089) has moved
 * `liveRevision` behind `revision` — e.g. a saved-but-never-sent v4 sitting
 * ahead of a promoted, SENT, live v2 — checking the allocator would read v4's
 * still-DRAFT quote and wrongly resolve OPEN even though v2 is out with the
 * client. This is the exact scenario recall-to-edit (Phase 5) has to gate
 * correctly: editing a promoted SENT revision must be refused (FINANCE_LOCKED)
 * so the recall-to-edit exit is even reachable.
 */
describe("#1080/#1100 the quote-sent lock follows liveRevision, not the allocator", () => {
  type QuoteStatus = "DRAFT" | "SENT" | "ACCEPTED" | "DECLINED" | "SUPERSEDED" | "EXPIRED" | "PUBLISHED";
  async function quoteAt(t: ReturnType<typeof makeT>, version: number, status: QuoteStatus, extra: Record<string, unknown> = {}) {
    await t.run(async (ctx) => {
      await ctx.db.insert("quotes", {
        id: `q${version}`, organizationId: ORG, projectId: "p1", version, status,
        snapshot: null, ...extra,
      });
    });
  }

  test("a promoted (non-allocator-max) live revision that's SENT still locks money fields", async () => {
    const t = makeT();
    await member(t, "member");
    // revision (allocator) sits at 4 — v3/v4 were saved-but-never-sent
    // versions — while liveRevision points back at v2, the promoted, SENT
    // revision actually live on the project (design decision 1).
    await project(t, "QUOTED", { revision: 4, liveRevision: 2 });
    await quoteAt(t, 1, "SUPERSEDED");
    await quoteAt(t, 2, "SENT", { sentAt: NOW });
    await quoteAt(t, 3, "DRAFT");
    await quoteAt(t, 4, "DRAFT");
    await t.run(async (ctx) => {
      await ctx.db.insert("projectLineItems", { id: "li1", organizationId: ORG, projectId: "p1", description: "Speaker", unitPrice: 100, quantity: 1, isKitChild: false });
    });
    await expect(
      t.withIdentity(asUser()).mutation(api.lineItemWrites.patchNative, {
        id: "li1", orgId: ORG, set: { unitPrice: 200 }, clear: [], entityName: "Speaker", allowOverbook: false, actor: ACTOR, auditId: "log1", now: NOW,
      }),
    ).rejects.toThrow(/FINANCIALS_LOCKED|locked/i);
  });

  test("projectLocksRead.status reports the LIVE revision's quote state and both revision numbers", async () => {
    const t = makeT();
    await member(t, "member");
    await project(t, "QUOTED", { revision: 4, liveRevision: 2 });
    await quoteAt(t, 2, "SENT", { sentAt: NOW });
    await quoteAt(t, 4, "DRAFT");
    const status = await t.withIdentity(asUser()).query(api.projectLocksRead.status, { projectId: "p1", orgId: ORG });
    expect(status?.tier).toBe("FINANCE_LOCKED");
    expect(status?.reason).toBe("QUOTE_SENT");
    expect(status?.revision).toBe(4);
    expect(status?.liveRevision).toBe(2);
    expect(status?.quoteState).toBe("SENT");
  });

  test("a promoted live revision that's still DRAFT (never sent) stays OPEN even with a SENT row at the allocator's max", async () => {
    const t = makeT();
    await member(t, "member");
    // Inverse of the bug: liveRevision (2) is an unsent DRAFT, while the
    // allocator's max (v4) happens to be SENT. The lock must follow the LIVE
    // revision and stay OPEN — a SENT row elsewhere never leaks in.
    await project(t, "QUOTED", { revision: 4, liveRevision: 2 });
    await quoteAt(t, 2, "DRAFT");
    await quoteAt(t, 4, "SENT", { sentAt: NOW });
    await t.withIdentity(asUser()).mutation(api.lineItemWrites.addCustomNative, {
      id: "li1", organizationId: ORG, projectId: "p1",
      fields: { description: "Extra cable", quantity: 1, unitPrice: 500 },
      actor: ACTOR, auditId: "log1", now: NOW,
    });
    await t.run(async (ctx) => {
      const li = await ctx.db.query("projectLineItems").withIndex("by_cuid", (q) => q.eq("id", "li1")).first();
      expect(Number(li?.unitPrice)).toBe(500); // not $0-defaulted — the project read as OPEN
    });
  });
});
