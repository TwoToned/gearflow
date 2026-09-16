// @vitest-environment node
//
// Pure-logic unit coverage for `convex/lib/projectLocks.ts` (#1230, Phase 4 of
// "Project versioning v2", parent #1221) — the shrunken successor to the old
// `resolveLockTier`/`LockTier` truth table this file used to cover. The
// integration-level exercise through real mutations (multi-entity, real DB
// writes) lives in `convex/projectLifecycleLocks.test.ts`; this file is the
// synchronous, side-effect-free half: `isLiveVersionRow`/`assertPricingUnlocked`/
// `defaultsToZeroOnInsert`/`pricedUnderLockOnInsert`/`afterLockAuditMetadata`
// need no `convexTest` harness at all.
import { convexTest } from "convex-test";
import { register as registerRateLimiter } from "@convex-dev/rate-limiter/test";
import { describe, test, expect } from "vitest";
import schema from "../schema";
import {
  isLiveVersionRow,
  defaultsToZeroOnInsert,
  pricedUnderLockOnInsert,
  afterLockAuditMetadata,
  assertPricingUnlocked,
  canUnlockPricing,
  requireCanUnlockPricing,
  isConfirmedOrLater,
  crossesIntoSnapshotStatus,
} from "./projectLocks";

const modules = import.meta.glob("../**/*.ts");
function makeT() {
  const t = convexTest(schema, modules);
  registerRateLimiter(t, "rateLimiter");
  return t;
}

const ORG = "org_1";
const USER = "user_1";

describe("isLiveVersionRow", () => {
  test("a row with no versionId always reads as live (projects itself, crewAssignments)", () => {
    expect(isLiveVersionRow({ liveVersionId: "v1" }, undefined)).toBe(true);
    expect(isLiveVersionRow({ liveVersionId: "v1" }, null)).toBe(true);
  });

  test("a project with no liveVersionId yet reads every row as live (un-backfilled — the safe default)", () => {
    expect(isLiveVersionRow({ liveVersionId: undefined }, "v2")).toBe(true);
  });

  test("a versioned row matching liveVersionId is live; a different versionId is not", () => {
    expect(isLiveVersionRow({ liveVersionId: "v1" }, "v1")).toBe(true);
    expect(isLiveVersionRow({ liveVersionId: "v1" }, "v2")).toBe(false);
  });
});

describe("defaultsToZeroOnInsert / pricedUnderLockOnInsert", () => {
  test("defaults to zero iff pricingLocked === true (not just truthy)", () => {
    expect(defaultsToZeroOnInsert({ pricingLocked: true })).toBe(true);
    expect(defaultsToZeroOnInsert({ pricingLocked: false })).toBe(false);
    expect(defaultsToZeroOnInsert({ pricingLocked: undefined })).toBe(false);
  });

  test("pricedUnderLockOnInsert stores `true` or absent — never `false`", () => {
    expect(pricedUnderLockOnInsert(true)).toBe(true);
    expect(pricedUnderLockOnInsert(false)).toBeUndefined();
    expect(pricedUnderLockOnInsert(undefined)).toBeUndefined();
  });
});

describe("afterLockAuditMetadata", () => {
  test("stamps afterLock:true only when the write happened while locked", () => {
    expect(afterLockAuditMetadata(true)).toEqual({ afterLock: true });
    expect(afterLockAuditMetadata(false)).toBeUndefined();
  });
});

describe("assertPricingUnlocked — the truth table", () => {
  test("unlocked project: never throws, live or not, versioned or not", () => {
    const project = { pricingLocked: false, liveVersionId: "v1" };
    expect(() => assertPricingUnlocked(project)).not.toThrow();
    expect(() => assertPricingUnlocked(project, "v1")).not.toThrow();
    expect(() => assertPricingUnlocked(project, "v2")).not.toThrow();
  });

  test("locked project, no versionId (unversioned table): throws PRICING_LOCKED", () => {
    const project = { pricingLocked: true, liveVersionId: "v1" };
    expect(() => assertPricingUnlocked(project)).toThrow(/pricing is locked/i);
  });

  test("locked project, versionId === liveVersionId: throws PRICING_LOCKED", () => {
    const project = { pricingLocked: true, liveVersionId: "v1" };
    expect(() => assertPricingUnlocked(project, "v1")).toThrow(/pricing is locked/i);
  });

  // The single most important invariant of the whole phase: a non-live
  // version is writable in every field family regardless of pricingLocked.
  test("locked project, versionId !== liveVersionId (a non-live version): NEVER throws", () => {
    const project = { pricingLocked: true, liveVersionId: "v1" };
    expect(() => assertPricingUnlocked(project, "v2")).not.toThrow();
    expect(() => assertPricingUnlocked(project, "v3")).not.toThrow();
  });

  test("locked project with no liveVersionId yet (un-backfilled): every versionId reads as live — throws", () => {
    const project = { pricingLocked: true, liveVersionId: undefined };
    expect(() => assertPricingUnlocked(project, "v2")).toThrow(/pricing is locked/i);
  });

  test("the thrown error carries the ConvexError code PRICING_LOCKED", () => {
    const project = { pricingLocked: true, liveVersionId: "v1" };
    try {
      assertPricingUnlocked(project);
      throw new Error("should have thrown");
    } catch (e) {
      expect((e as { data?: { code?: string } }).data?.code).toBe("PRICING_LOCKED");
    }
  });
});

describe("canUnlockPricing / requireCanUnlockPricing (D42)", () => {
  async function seedMember(t: ReturnType<typeof makeT>, role: string) {
    await t.run(async (ctx) => {
      await ctx.db.insert("members", { id: "m1", organizationId: ORG, userId: USER, role });
    });
  }
  async function seedPm(t: ReturnType<typeof makeT>) {
    await t.run(async (ctx) => {
      await ctx.db.insert("projectManagers", { id: "pm1", organizationId: ORG, projectId: "p1", userId: USER });
    });
  }

  test("owner/admin/manager (invoice:publish) can unlock without being the PM", async () => {
    const t = makeT();
    for (const role of ["owner", "admin", "manager"]) {
      await t.run(async (ctx) => {
        const existing = await ctx.db.query("members").withIndex("by_org_user", (q) => q.eq("organizationId", ORG).eq("userId", USER)).first();
        if (existing) await ctx.db.patch(existing._id, { role });
        else await ctx.db.insert("members", { id: "m1", organizationId: ORG, userId: USER, role });
      });
      const allowed = await t.run((ctx) => canUnlockPricing(ctx, ORG, "p1", USER));
      expect(allowed).toBe(true);
    }
  });

  test("member/viewer (no invoice:publish) cannot unlock unless also the project's PM", async () => {
    const t = makeT();
    await seedMember(t, "member");
    expect(await t.run((ctx) => canUnlockPricing(ctx, ORG, "p1", USER))).toBe(false);

    await seedPm(t);
    expect(await t.run((ctx) => canUnlockPricing(ctx, ORG, "p1", USER))).toBe(true);
  });

  test("a PM row belonging to a different org never satisfies the audience (IDOR guard)", async () => {
    const t = makeT();
    await seedMember(t, "member");
    await t.run(async (ctx) => {
      await ctx.db.insert("projectManagers", { id: "pm1", organizationId: "org_2", projectId: "p1", userId: USER });
    });
    expect(await t.run((ctx) => canUnlockPricing(ctx, ORG, "p1", USER))).toBe(false);
  });

  test("requireCanUnlockPricing throws FORBIDDEN_UNLOCK_PRICING for a disallowed caller, resolves for an allowed one", async () => {
    const t = makeT();
    await seedMember(t, "member");
    await expect(t.run((ctx) => requireCanUnlockPricing(ctx, ORG, "p1", USER))).rejects.toThrow(
      /admins\/owners\/managers.*PM/i,
    );

    await seedPm(t);
    // No throw is the only contract (`Promise<void>`) — convex-test's `t.run`
    // serializes an undefined return as `null`, so assert falsy rather than
    // the exact literal.
    await expect(t.run((ctx) => requireCanUnlockPricing(ctx, ORG, "p1", USER))).resolves.toBeFalsy();
  });
});

describe("isConfirmedOrLater / crossesIntoSnapshotStatus (unrelated to pricing locking)", () => {
  test("isConfirmedOrLater is true from CONFIRMED through INVOICED, false before", () => {
    expect(isConfirmedOrLater("QUOTED")).toBe(false);
    expect(isConfirmedOrLater("CONFIRMED")).toBe(true);
    expect(isConfirmedOrLater("ON_SITE")).toBe(true);
    expect(isConfirmedOrLater("COMPLETED")).toBe(true);
    expect(isConfirmedOrLater("INVOICED")).toBe(true);
    expect(isConfirmedOrLater(null)).toBe(false);
    expect(isConfirmedOrLater(undefined)).toBe(false);
  });

  test("crossesIntoSnapshotStatus fires on a forward advance or a re-crossing, never a no-op or an unrelated status", () => {
    expect(crossesIntoSnapshotStatus("QUOTED", "CONFIRMED")).toBe(true);
    expect(crossesIntoSnapshotStatus("PREPPING", "COMPLETED")).toBe(true);
    expect(crossesIntoSnapshotStatus("CONFIRMED", "CONFIRMED")).toBe(false); // no-op re-assert
    expect(crossesIntoSnapshotStatus("QUOTED", "ON_SITE")).toBe(false); // not landing on CONFIRMED/COMPLETED
    expect(crossesIntoSnapshotStatus("CONFIRMED", "QUOTING")).toBe(false); // a revert, not a crossing INTO
  });
});
