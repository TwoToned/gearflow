// @vitest-environment node
import { convexTest } from "convex-test";
import { describe, test, expect } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";
import { register as registerRateLimiter } from "@convex-dev/rate-limiter/test";
import { register as registerShardedCounter } from "@convex-dev/sharded-counter/test";

/**
 * Integration coverage for the #1230 (Phase 4 of "Project versioning v2",
 * parent #1221) pricing-lock program — the SHRUNKEN successor to the deleted
 * 4-tier lock system (#791 finance soft-lock, #793 ON_SITE justification
 * gate, #792 hard-lock + unlock sessions) this file used to cover. Exercises
 * `assertPricingUnlocked`/`defaultsToZeroOnInsert` through real mutations
 * across every gated entity family, rather than re-testing the pure logic
 * (see `convex/lib/projectLocks.test.ts` for that).
 *
 * The truth table (design §4, D-table):
 *   non-live version           → money/structure/plan/warehouse all allowed
 *   live version, unlocked     → all allowed
 *   live version, locked       → money locked (one click to clear via
 *                                 unlockPricingNative); structure/plan/
 *                                 warehouse still allowed (new adds $0-default)
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

async function member(t: ReturnType<typeof makeT>, role: string) {
  await t.run(async (ctx) => {
    const existing = await ctx.db.query("members").withIndex("by_org_user", (q) => q.eq("organizationId", ORG).eq("userId", USER)).first();
    if (existing) await ctx.db.patch(existing._id, { role });
    else await ctx.db.insert("members", { id: "m", organizationId: ORG, userId: USER, role });
  });
}

/** A project with a live version `v-p1`, optionally `pricingLocked`, and
 *  optionally an ADDITIONAL non-live version `v-other` — the fixture every
 *  truth-table test needs to prove the non-live-version exemption. */
async function project(t: ReturnType<typeof convexTest>, status: string, extra: Record<string, unknown> = {}) {
  await t.run(async (ctx) => {
    await ctx.db.insert("projects", {
      id: "p1", organizationId: ORG, projectNumber: "P-1", name: "Test Gig",
      status, isTemplate: false, taxRate: 10, discountPercent: 0, revision: 1,
      createdAt: NOW, updatedAt: NOW, ...extra,
      liveVersionId: "v-p1",
    });
    await ctx.db.insert("projectVersions", { id: "v-p1", organizationId: ORG, projectId: "p1", number: 1, contentState: "ready", createdAt: NOW, createdById: "u1" });
    await ctx.db.insert("projectVersions", { id: "v-other", organizationId: ORG, projectId: "p1", number: 2, contentState: "ready", createdAt: NOW, createdById: "u1" });
  });
}

async function acceptedQuote(t: ReturnType<typeof convexTest>) {
  await t.run(async (ctx) => {
    await ctx.db.insert("quotes", {
      id: "q1", organizationId: ORG, projectId: "p1", version: 1, status: "ACCEPTED",
      snapshot: null, sentAt: NOW, acceptedAt: NOW,
    });
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// The truth table, exercised across every gated entity family.
// ─────────────────────────────────────────────────────────────────────────────
describe("assertPricingUnlocked truth table — project field (projectWrites.updateNative)", () => {
  test("live + unlocked: a money field (taxRate) is editable", async () => {
    const t = makeT();
    await member(t, "member");
    await project(t, "CONFIRMED");
    await t.withIdentity(asUser()).mutation(api.projectWrites.updateNative, {
      id: "p1", orgId: ORG, set: { taxRate: 20 }, clear: [], actor: ACTOR, auditId: "log1", now: NOW,
    });
    const p = await t.run((ctx) => ctx.db.query("projects").withIndex("by_cuid", (q) => q.eq("id", "p1")).first());
    expect(Number(p?.taxRate)).toBe(20);
  });

  test("live + locked: the same money field is rejected (PRICING_LOCKED)", async () => {
    const t = makeT();
    await member(t, "member");
    await project(t, "CONFIRMED", { pricingLocked: true });
    await expect(
      t.withIdentity(asUser()).mutation(api.projectWrites.updateNative, {
        id: "p1", orgId: ORG, set: { taxRate: 20 }, clear: [], actor: ACTOR, auditId: "log1", now: NOW,
      }),
    ).rejects.toThrow(/PRICING_LOCKED|pricing is locked/i);
  });

  test("live + locked: a non-money field (name) stays editable", async () => {
    const t = makeT();
    await member(t, "member");
    await project(t, "CONFIRMED", { pricingLocked: true });
    await t.withIdentity(asUser()).mutation(api.projectWrites.updateNative, {
      id: "p1", orgId: ORG, set: { name: "Renamed Gig" }, clear: [], actor: ACTOR, auditId: "log1", now: NOW,
    });
    const p = await t.run((ctx) => ctx.db.query("projects").withIndex("by_cuid", (q) => q.eq("id", "p1")).first());
    expect(p?.name).toBe("Renamed Gig");
  });

  test("clearing the lock (unlockPricingNative) writes an activity row and re-opens the money field", async () => {
    const t = makeT();
    await member(t, "owner");
    await project(t, "CONFIRMED", { pricingLocked: true, pricingLockedAt: NOW - 1000, pricingLockedById: USER, pricingLockedByName: "Alice" });
    await t.withIdentity(asUser()).mutation(api.projectPricingLockWrites.unlockPricingNative, {
      id: "p1", orgId: ORG, actor: ACTOR, auditId: "unlock1", now: NOW,
    });
    const p = await t.run((ctx) => ctx.db.query("projects").withIndex("by_cuid", (q) => q.eq("id", "p1")).first());
    expect(p?.pricingLocked).toBe(false);
    const log = await t.run((ctx) => ctx.db.query("activityLogs").withIndex("by_cuid", (q) => q.eq("id", "unlock1")).first());
    expect(log?.action).toBe("PRICING_UNLOCKED");

    await t.withIdentity(asUser()).mutation(api.projectWrites.updateNative, {
      id: "p1", orgId: ORG, set: { taxRate: 25 }, clear: [], actor: ACTOR, auditId: "log2", now: NOW + 1,
    });
    expect(Number((await t.run((ctx) => ctx.db.query("projects").withIndex("by_cuid", (q) => q.eq("id", "p1")).first()))?.taxRate)).toBe(25);
  });
});

describe("assertPricingUnlocked truth table — line item (lineItemWrites.patchNative)", () => {
  async function seedLine(t: ReturnType<typeof makeT>, versionId = "v-p1") {
    await t.run(async (ctx) => {
      await ctx.db.insert("projectLineItems", {
        id: "li1", organizationId: ORG, projectId: "p1", description: "Speaker", unitPrice: 100, quantity: 1,
        isKitChild: false, versionId, lineageId: "li1",
      });
    });
  }

  test("live + unlocked: unitPrice is editable", async () => {
    const t = makeT();
    await member(t, "member");
    await project(t, "CONFIRMED");
    await seedLine(t);
    await t.withIdentity(asUser()).mutation(api.lineItemWrites.patchNative, {
      id: "li1", orgId: ORG, set: { unitPrice: 200 }, clear: [], entityName: "Speaker", allowOverbook: false, actor: ACTOR, auditId: "log1", now: NOW,
    });
    const li = await t.run((ctx) => ctx.db.query("projectLineItems").withIndex("by_cuid", (q) => q.eq("id", "li1")).first());
    expect(Number(li?.unitPrice)).toBe(200);
  });

  test("live + locked: unitPrice is rejected", async () => {
    const t = makeT();
    await member(t, "member");
    await project(t, "CONFIRMED", { pricingLocked: true });
    await seedLine(t);
    await expect(
      t.withIdentity(asUser()).mutation(api.lineItemWrites.patchNative, {
        id: "li1", orgId: ORG, set: { unitPrice: 200 }, clear: [], entityName: "Speaker", allowOverbook: false, actor: ACTOR, auditId: "log1", now: NOW,
      }),
    ).rejects.toThrow(/PRICING_LOCKED|pricing is locked/i);
  });

  test("live + locked: a structural field (description) stays editable", async () => {
    const t = makeT();
    await member(t, "member");
    await project(t, "CONFIRMED", { pricingLocked: true });
    await seedLine(t);
    await t.withIdentity(asUser()).mutation(api.lineItemWrites.patchNative, {
      id: "li1", orgId: ORG, set: { description: "Speaker (updated)" }, clear: [], entityName: "Speaker", allowOverbook: false, actor: ACTOR, auditId: "log1", now: NOW,
    });
    const li = await t.run((ctx) => ctx.db.query("projectLineItems").withIndex("by_cuid", (q) => q.eq("id", "li1")).first());
    expect(li?.description).toBe("Speaker (updated)");
  });

  // THE single most important invariant of the whole phase: a non-live
  // version's own row is writable in every field family regardless of the
  // project's pricingLocked flag.
  test("locked project, but the row belongs to a NON-LIVE version: unitPrice is still editable", async () => {
    const t = makeT();
    await member(t, "member");
    await project(t, "CONFIRMED", { pricingLocked: true });
    await seedLine(t, "v-other");
    await t.withIdentity(asUser()).mutation(api.lineItemWrites.patchNative, {
      id: "li1", orgId: ORG, set: { unitPrice: 999 }, clear: [], entityName: "Speaker", allowOverbook: false, actor: ACTOR, auditId: "log1", now: NOW,
    });
    const li = await t.run((ctx) => ctx.db.query("projectLineItems").withIndex("by_cuid", (q) => q.eq("id", "li1")).first());
    expect(Number(li?.unitPrice)).toBe(999);
  });
});

describe("assertPricingUnlocked truth table — group price (projectGroupsWrites.updateGroupPriceNative)", () => {
  async function seedGroup(t: ReturnType<typeof makeT>, versionId = "v-p1") {
    await t.run(async (ctx) => {
      await ctx.db.insert("projectGroups", {
        id: "g1", organizationId: ORG, projectId: "p1", title: "Wireless Mic Kit", price: 1000, sortOrder: 0,
        versionId, lineageId: "g1",
      });
    });
  }

  test("live + unlocked: price is editable", async () => {
    const t = makeT();
    await member(t, "member");
    await project(t, "CONFIRMED");
    await seedGroup(t);
    await t.withIdentity(asUser()).mutation(api.projectGroupsWrites.updateGroupPriceNative, {
      id: "g1", orgId: ORG, price: 1400, now: NOW, actor: ACTOR, auditId: "log1",
    });
    const g = await t.run((ctx) => ctx.db.query("projectGroups").withIndex("by_cuid", (q) => q.eq("id", "g1")).first());
    expect(Number(g?.price)).toBe(1400);
  });

  test("live + locked: price is rejected", async () => {
    const t = makeT();
    await member(t, "member");
    await project(t, "CONFIRMED", { pricingLocked: true });
    await seedGroup(t);
    await expect(
      t.withIdentity(asUser()).mutation(api.projectGroupsWrites.updateGroupPriceNative, {
        id: "g1", orgId: ORG, price: 1400, now: NOW, actor: ACTOR, auditId: "log1",
      }),
    ).rejects.toThrow(/PRICING_LOCKED|pricing is locked/i);
  });

  test("locked project, but the group belongs to a NON-LIVE version: price is still editable", async () => {
    const t = makeT();
    await member(t, "member");
    await project(t, "CONFIRMED", { pricingLocked: true });
    await seedGroup(t, "v-other");
    await t.withIdentity(asUser()).mutation(api.projectGroupsWrites.updateGroupPriceNative, {
      id: "g1", orgId: ORG, price: 1400, now: NOW, actor: ACTOR, auditId: "log1",
    });
    const g = await t.run((ctx) => ctx.db.query("projectGroups").withIndex("by_cuid", (q) => q.eq("id", "g1")).first());
    expect(Number(g?.price)).toBe(1400);
  });
});

describe("assertPricingUnlocked truth table — crew assignment (crewAssignmentsWrites.updateNative, unversioned — always follows the live job)", () => {
  async function seedAssignment(t: ReturnType<typeof makeT>) {
    await t.run(async (ctx) => {
      await ctx.db.insert("crewMembers", { id: "c1", organizationId: ORG, firstName: "Bob", lastName: "Ryan", isActive: true });
      await ctx.db.insert("crewAssignments", {
        id: "a1", organizationId: ORG, projectId: "p1", crewMemberId: "c1", status: "PENDING", isProjectManager: false,
        createdAt: NOW, updatedAt: NOW,
      });
    });
  }
  const patchArgs = (rateOverride: number) => ({
    id: "a1", orgId: ORG, crewMemberId: "c1", status: "PENDING" as const, isProjectManager: false,
    rateOverride, now: NOW, actor: ACTOR, auditId: "log1",
  });

  test("live + unlocked: rateOverride is editable", async () => {
    const t = makeT();
    await member(t, "manager");
    await project(t, "CONFIRMED");
    await seedAssignment(t);
    await t.withIdentity(asUser()).mutation(api.crewAssignmentsWrites.updateNative, patchArgs(500));
    const a = await t.run((ctx) => ctx.db.query("crewAssignments").withIndex("by_cuid", (q) => q.eq("id", "a1")).first());
    expect(a?.rateOverride).toBe(500);
  });

  test("live + locked: rateOverride is rejected", async () => {
    const t = makeT();
    await member(t, "manager");
    await project(t, "CONFIRMED", { pricingLocked: true });
    await seedAssignment(t);
    await expect(
      t.withIdentity(asUser()).mutation(api.crewAssignmentsWrites.updateNative, patchArgs(500)),
    ).rejects.toThrow(/PRICING_LOCKED|pricing is locked/i);
  });

  test("live + locked: a structural field (status) stays editable", async () => {
    const t = makeT();
    await member(t, "manager");
    await project(t, "CONFIRMED", { pricingLocked: true });
    await seedAssignment(t);
    await t.withIdentity(asUser()).mutation(api.crewAssignmentsWrites.updateNative, {
      id: "a1", orgId: ORG, crewMemberId: "c1", status: "CONFIRMED" as const, isProjectManager: false,
      now: NOW, actor: ACTOR, auditId: "log1",
    });
    const a = await t.run((ctx) => ctx.db.query("crewAssignments").withIndex("by_cuid", (q) => q.eq("id", "a1")).first());
    expect(a?.status).toBe("CONFIRMED");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// $0 default on a structural add while locked — pricedUnderLock (the Unpriced
// badge's real signal, stored at insert time, never inferred later).
// ─────────────────────────────────────────────────────────────────────────────
describe("pricedUnderLock — $0-default on structural add while locked", () => {
  const fields = { description: "Extra cable", quantity: 1, unitPrice: 500, discount: 50 };

  test("locked: unitPrice is forced to 0 server-side (ignores the client value) and pricedUnderLock is stamped", async () => {
    const t = makeT();
    await member(t, "member");
    await project(t, "CONFIRMED", { pricingLocked: true });
    await t.withIdentity(asUser()).mutation(api.lineItemWrites.addCustomNative, {
      id: "li1", organizationId: ORG, projectId: "p1", fields, actor: ACTOR, auditId: "log1", now: NOW,
    });
    const li = await t.run((ctx) => ctx.db.query("projectLineItems").withIndex("by_cuid", (q) => q.eq("id", "li1")).first());
    expect(li?.unitPrice).toBe(0);
    expect(li?.discount).toBeUndefined();
    expect(li?.pricedUnderLock).toBe(true);
  });

  test("unlocked: the client's price is kept, and pricedUnderLock is never set", async () => {
    const t = makeT();
    await member(t, "member");
    await project(t, "QUOTED");
    await t.withIdentity(asUser()).mutation(api.lineItemWrites.addCustomNative, {
      id: "li1", organizationId: ORG, projectId: "p1", fields, actor: ACTOR, auditId: "log1", now: NOW,
    });
    const li = await t.run((ctx) => ctx.db.query("projectLineItems").withIndex("by_cuid", (q) => q.eq("id", "li1")).first());
    expect(Number(li?.unitPrice)).toBe(500);
    expect(li?.pricedUnderLock).toBeFalsy();
  });

  test("after unlockPricingNative clears the lock, auto-pricing resumes for a subsequent add", async () => {
    const t = makeT();
    await member(t, "owner");
    await project(t, "CONFIRMED", { pricingLocked: true });
    await t.withIdentity(asUser()).mutation(api.projectPricingLockWrites.unlockPricingNative, {
      id: "p1", orgId: ORG, actor: ACTOR, auditId: "unlock1", now: NOW,
    });
    await t.withIdentity(asUser()).mutation(api.lineItemWrites.addCustomNative, {
      id: "li1", organizationId: ORG, projectId: "p1", fields, actor: ACTOR, auditId: "log1", now: NOW + 1,
    });
    const li = await t.run((ctx) => ctx.db.query("projectLineItems").withIndex("by_cuid", (q) => q.eq("id", "li1")).first());
    expect(Number(li?.unitPrice)).toBe(500);
    expect(li?.pricedUnderLock).toBeFalsy();
  });

  test("a line item that's been $0 since BEFORE any lock existed does NOT retroactively earn the badge once the project locks", async () => {
    const t = makeT();
    await member(t, "member");
    await project(t, "QUOTED");
    await t.withIdentity(asUser()).mutation(api.lineItemWrites.addCustomNative, {
      id: "li1", organizationId: ORG, projectId: "p1",
      fields: { description: "Freebie", quantity: 1, unitPrice: 0 },
      actor: ACTOR, auditId: "log1", now: NOW,
    });
    await t.run(async (ctx) => {
      const li = await ctx.db.query("projectLineItems").withIndex("by_cuid", (q) => q.eq("id", "li1")).first();
      expect(li?.pricedUnderLock).toBeFalsy();
    });
    // The project later locks (a person locks it, or a status/quote event
    // does) — the row's OWN pricedUnderLock is untouched by that transition;
    // only a write to the row itself can ever set it.
    await t.run(async (ctx) => {
      const p = await ctx.db.query("projects").withIndex("by_cuid", (q) => q.eq("id", "p1")).first();
      await ctx.db.patch(p!._id, { pricingLocked: true });
    });
    const li = await t.run((ctx) => ctx.db.query("projectLineItems").withIndex("by_cuid", (q) => q.eq("id", "li1")).first());
    expect(li?.pricedUnderLock).toBeFalsy();
  });

  test("patchNative's unitPrice edit clears a stale pricedUnderLock once a human deliberately prices the row (after unlocking)", async () => {
    const t = makeT();
    await member(t, "owner");
    await project(t, "CONFIRMED", { pricingLocked: true });
    await t.withIdentity(asUser()).mutation(api.lineItemWrites.addCustomNative, {
      id: "li1", organizationId: ORG, projectId: "p1",
      fields: { description: "Extra cable", quantity: 1, unitPrice: 500 },
      actor: ACTOR, auditId: "log1", now: NOW,
    });
    expect((await t.run((ctx) => ctx.db.query("projectLineItems").withIndex("by_cuid", (q) => q.eq("id", "li1")).first()))?.pricedUnderLock).toBe(true);

    await t.withIdentity(asUser()).mutation(api.projectPricingLockWrites.unlockPricingNative, {
      id: "p1", orgId: ORG, actor: ACTOR, auditId: "unlock1", now: NOW + 1,
    });
    await t.withIdentity(asUser()).mutation(api.lineItemWrites.patchNative, {
      id: "li1", orgId: ORG, entityName: "Extra cable", allowOverbook: false,
      set: { unitPrice: 120, updatedAt: NOW + 2 }, clear: [], actor: ACTOR, auditId: "log2", now: NOW + 2,
    });
    const li = await t.run((ctx) => ctx.db.query("projectLineItems").withIndex("by_cuid", (q) => q.eq("id", "li1")).first());
    expect(Number(li?.unitPrice)).toBe(120);
    expect(li?.pricedUnderLock).toBe(false);
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
      set: { notes: "updated", pricedUnderLock: true, updatedAt: NOW + 1 } as Record<string, unknown>,
      clear: [], actor: ACTOR, auditId: "log2", now: NOW + 1,
    });
    const li = await t.run((ctx) => ctx.db.query("projectLineItems").withIndex("by_cuid", (q) => q.eq("id", "li1")).first());
    expect(li?.notes).toBe("updated");
    expect(li?.pricedUnderLock).toBeFalsy();
  });

  test("a locked group create defaults price to $0 and sets pricedUnderLock; updateGroupPriceNative clears it (after unlocking)", async () => {
    const t = makeT();
    await member(t, "owner");
    await project(t, "CONFIRMED", { pricingLocked: true });
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

    await t.withIdentity(asUser()).mutation(api.projectPricingLockWrites.unlockPricingNative, {
      id: "p1", orgId: ORG, actor: ACTOR, auditId: "unlock1", now: NOW + 1,
    });
    await t.withIdentity(asUser()).mutation(api.projectGroupsWrites.updateGroupPriceNative, {
      id: "g1", orgId: ORG, price: 1400, discount: 15, discountMode: "%",
      now: NOW + 2, actor: ACTOR, auditId: "log2",
    });
    const g = await t.run((ctx) => ctx.db.query("projectGroups").withIndex("by_cuid", (q) => q.eq("id", "g1")).first());
    expect(Number(g?.price)).toBe(1400);
    expect(g?.discountMode).toBe("%");
    expect(g?.pricedUnderLock).toBe(false);
  });

  test("addKitNative under lock flags the kit PARENT line, not its (already-excluded) member children", async () => {
    const t = makeT();
    await member(t, "member");
    await project(t, "CONFIRMED", { pricingLocked: true });
    await t.run(async (ctx) => {
      await ctx.db.insert("kits", { id: "k1", organizationId: ORG, assetTag: "TTP00001", name: "RF Kit 1", status: "AVAILABLE" });
    });
    await t.withIdentity(asUser()).mutation(api.lineItemWrites.addKitNative, {
      id: "kl1", organizationId: ORG, projectId: "p1", kitId: "k1",
      unitPrice: 400, pricingMode: "KIT_PRICE", kitLabel: "TTP00001 - RF Kit 1",
      actor: ACTOR, auditId: "log1", now: NOW,
    });
    const parent = await t.run((ctx) => ctx.db.query("projectLineItems").withIndex("by_cuid", (q) => q.eq("id", "kl1")).first());
    expect(parent?.unitPrice).toBe(0);
    expect(parent?.pricedUnderLock).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// #1230: structural writes are never gated by status alone anymore — the
// JUSTIFY (ON_SITE) and HARD_LOCKED (COMPLETED/INVOICED) tiers are deleted.
// ─────────────────────────────────────────────────────────────────────────────
describe("structural writes are ungated regardless of status (#1230 — JUSTIFY/HARD_LOCKED deleted)", () => {
  test("a structural add on an ON_SITE project succeeds with no justification", async () => {
    const t = makeT();
    await member(t, "member");
    await project(t, "ON_SITE");
    await t.withIdentity(asUser()).mutation(api.lineItemWrites.addCustomNative, {
      id: "li1", organizationId: ORG, projectId: "p1", fields: { description: "Extra cable", quantity: 1 }, actor: ACTOR, auditId: "log1", now: NOW,
    });
    const li = await t.run((ctx) => ctx.db.query("projectLineItems").withIndex("by_cuid", (q) => q.eq("id", "li1")).first());
    expect(li).not.toBeNull();
  });

  test("a structural add on a COMPLETED project succeeds — no unlock session needed", async () => {
    const t = makeT();
    await member(t, "member");
    await project(t, "COMPLETED");
    await t.withIdentity(asUser()).mutation(api.lineItemWrites.addCustomNative, {
      id: "li1", organizationId: ORG, projectId: "p1", fields: { description: "x", quantity: 1, unitPrice: 100 }, actor: ACTOR, auditId: "log1", now: NOW,
    });
    // COMPLETED alone (pricingLocked absent) doesn't lock money either —
    // only CONFIRMED's own status-transition or a sent quote raises the flag.
    const li = await t.run((ctx) => ctx.db.query("projectLineItems").withIndex("by_cuid", (q) => q.eq("id", "li1")).first());
    expect(Number(li?.unitPrice)).toBe(100);
  });

  test("crew-assignment create on ON_SITE succeeds with no justification", async () => {
    const t = makeT();
    await member(t, "manager"); // crew:create needs manager+
    await project(t, "ON_SITE");
    await t.run(async (ctx) => {
      await ctx.db.insert("crewMembers", { id: "cm1", organizationId: ORG, firstName: "Sam", lastName: "Rigger" });
    });
    await t.withIdentity(asUser()).mutation(api.crewAssignmentsWrites.createNative, {
      id: "asg1", orgId: ORG, projectId: "p1", crewMemberId: "cm1", now: NOW, actor: ACTOR, auditId: "log1",
    });
    const asg = await t.run((ctx) => ctx.db.query("crewAssignments").withIndex("by_cuid", (q) => q.eq("id", "asg1")).first());
    expect(asg).not.toBeNull();
  });

  test("reverting status out of COMPLETED needs no audience/justification gate", async () => {
    const t = makeT();
    await member(t, "member");
    await project(t, "COMPLETED");
    await t.withIdentity(asUser()).mutation(api.projectWrites.updateStatusNative, {
      id: "p1", orgId: ORG, status: "ON_SITE", actor: ACTOR, auditId: "log1", now: NOW,
    });
    const p = await t.run((ctx) => ctx.db.query("projects").withIndex("by_cuid", (q) => q.eq("id", "p1")).first());
    expect(p?.status).toBe("ON_SITE");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// #792 snapshot capture at CONFIRMED/COMPLETED — untouched by this phase (a
// whole-project version SNAPSHOT is a separate mechanism from pricing locking;
// crossesIntoSnapshotStatus is unrelated to assertPricingUnlocked).
// ─────────────────────────────────────────────────────────────────────────────
describe("#792 snapshot capture at CONFIRMED/COMPLETED", () => {
  test("a forward crossing into CONFIRMED captures a snapshot with the project + its line items", async () => {
    const t = makeT();
    await member(t, "member");
    await project(t, "QUOTED");
    await acceptedQuote(t);
    await t.run(async (ctx) => {
      await ctx.db.insert("projectLineItems", { id: "li1", organizationId: ORG, projectId: "p1", description: "Speaker", unitPrice: 100, quantity: 1,
        versionId: "v-p1",
        lineageId: "li1",
      });
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

// ─────────────────────────────────────────────────────────────────────────────
// projectPricingLockWrites — lockPricingNative (danger:low, ungated re-lock)
// vs. unlockPricingNative (danger:high at the dispatcher, D42-gated here).
// ─────────────────────────────────────────────────────────────────────────────
describe("projectPricingLockWrites.lockPricingNative / unlockPricingNative", () => {
  test("lockPricingNative: any project:update caller (a plain member) can re-lock", async () => {
    const t = makeT();
    await member(t, "member");
    await project(t, "QUOTED");
    const res = await t.withIdentity(asUser()).mutation(api.projectPricingLockWrites.lockPricingNative, {
      id: "p1", orgId: ORG, actor: ACTOR, auditId: "log1", now: NOW,
    });
    expect(res.pricingLocked).toBe(true);
    const p = await t.run((ctx) => ctx.db.query("projects").withIndex("by_cuid", (q) => q.eq("id", "p1")).first());
    expect(p?.pricingLocked).toBe(true);
    expect(p?.pricingLockedById).toBe(USER);
    const log = await t.run((ctx) => ctx.db.query("activityLogs").withIndex("by_cuid", (q) => q.eq("id", "log1")).first());
    expect(log?.action).toBe("PRICING_LOCKED");
  });

  test("lockPricingNative is idempotent — re-locking an already-locked project is a no-op patch, no duplicate audit noise", async () => {
    const t = makeT();
    await member(t, "member");
    await project(t, "QUOTED", { pricingLocked: true, pricingLockedAt: NOW - 5000, pricingLockedById: "someone_else" });
    await t.withIdentity(asUser()).mutation(api.projectPricingLockWrites.lockPricingNative, {
      id: "p1", orgId: ORG, actor: ACTOR, auditId: "log1", now: NOW,
    });
    const p = await t.run((ctx) => ctx.db.query("projects").withIndex("by_cuid", (q) => q.eq("id", "p1")).first());
    expect(p?.pricingLockedAt).toBe(NOW - 5000); // untouched — no-op
    expect(p?.pricingLockedById).toBe("someone_else");
    const log = await t.run((ctx) => ctx.db.query("activityLogs").withIndex("by_cuid", (q) => q.eq("id", "log1")).first());
    expect(log).toBeNull(); // no audit row on the no-op path
  });

  test("unlockPricingNative: a plain member (no invoice:publish, not PM) is denied", async () => {
    const t = makeT();
    await member(t, "member");
    await project(t, "CONFIRMED", { pricingLocked: true });
    await expect(
      t.withIdentity(asUser()).mutation(api.projectPricingLockWrites.unlockPricingNative, {
        id: "p1", orgId: ORG, actor: ACTOR, auditId: "log1", now: NOW,
      }),
    ).rejects.toThrow(/admins\/owners\/managers.*PM/i);
  });

  test("unlockPricingNative: the project's assigned PM can clear it even without invoice:publish", async () => {
    const t = makeT();
    await member(t, "member");
    await project(t, "CONFIRMED", { pricingLocked: true });
    await t.run(async (ctx) => {
      await ctx.db.insert("projectManagers", { id: "pm1", organizationId: ORG, projectId: "p1", userId: USER });
    });
    await t.withIdentity(asUser()).mutation(api.projectPricingLockWrites.unlockPricingNative, {
      id: "p1", orgId: ORG, actor: ACTOR, auditId: "log1", now: NOW,
    });
    const p = await t.run((ctx) => ctx.db.query("projects").withIndex("by_cuid", (q) => q.eq("id", "p1")).first());
    expect(p?.pricingLocked).toBe(false);
  });

  test("unlockPricingNative is idempotent — clearing an already-unlocked project is a no-op, no audit row", async () => {
    const t = makeT();
    await member(t, "owner");
    await project(t, "QUOTED");
    await t.withIdentity(asUser()).mutation(api.projectPricingLockWrites.unlockPricingNative, {
      id: "p1", orgId: ORG, actor: ACTOR, auditId: "log1", now: NOW,
    });
    const log = await t.run((ctx) => ctx.db.query("activityLogs").withIndex("by_cuid", (q) => q.eq("id", "log1")).first());
    expect(log).toBeNull();
  });

  test("rejects another org's project (IDOR guard)", async () => {
    const t = makeT();
    await member(t, "owner");
    await project(t, "QUOTED");
    await expect(
      t.withIdentity(asUser()).mutation(api.projectPricingLockWrites.lockPricingNative, {
        id: "p1", orgId: "org_2", actor: ACTOR, auditId: "log1", now: NOW,
      }),
    ).rejects.toThrow(/organization mismatch|insufficient permissions|not found/i);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// projectLocksRead.status — the read every UI surface (chip/strip) consumes.
// ─────────────────────────────────────────────────────────────────────────────
describe("projectLocksRead.status", () => {
  test("reports pricingLocked, who/when, and canUnlockPricing for the caller's own role", async () => {
    const t = makeT();
    await member(t, "member");
    await project(t, "CONFIRMED", { pricingLocked: true, pricingLockedAt: NOW, pricingLockedById: USER, pricingLockedByName: "Alice" });
    const status = await t.withIdentity(asUser()).query(api.projectLocksRead.status, { projectId: "p1", orgId: ORG });
    expect(status?.pricingLocked).toBe(true);
    expect(status?.pricingLockedAt).toBe(NOW);
    expect(status?.pricingLockedByName).toBe("Alice");
    expect(status?.canUnlockPricing).toBe(false); // plain member, not PM
  });

  test("canUnlockPricing is true for an owner", async () => {
    const t = makeT();
    await member(t, "owner");
    await project(t, "CONFIRMED", { pricingLocked: true });
    const status = await t.withIdentity(asUser()).query(api.projectLocksRead.status, { projectId: "p1", orgId: ORG });
    expect(status?.canUnlockPricing).toBe(true);
  });

  test("reports pricingLocked:false for an unlocked project", async () => {
    const t = makeT();
    await member(t, "member");
    await project(t, "QUOTED");
    const status = await t.withIdentity(asUser()).query(api.projectLocksRead.status, { projectId: "p1", orgId: ORG });
    expect(status?.pricingLocked).toBe(false);
  });

  test("returns null when the projectId belongs to a different org than orgId claims (IDOR guard, by_cuid is global)", async () => {
    const t = makeT();
    await member(t, "member");
    // No "p1" under ORG at all — only under a different org, same id.
    // `by_cuid` is a global index, so the read must org-check the row it
    // finds rather than trust the caller's own `orgId`/membership.
    await t.run(async (ctx) => {
      await ctx.db.insert("projects", { id: "p1", organizationId: "org_2", projectNumber: "P-1", name: "Their Gig", status: "QUOTED", isTemplate: false, pricingLocked: true });
    });
    const status = await t.withIdentity(asUser()).query(api.projectLocksRead.status, { projectId: "p1", orgId: ORG });
    expect(status).toBeNull();
  });
});
