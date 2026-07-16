// @vitest-environment node
//
// Browser-direct WAREHOUSE writes (Phase 3 PR-A) — the return / undeploy / container
// write family. Verifies for a representative subset (checkInItems, undeployKitsBatch,
// checkInKit, ensureContainerOnProject, syncContainersBatch): success + state
// transition + in-mutation audit; RBAC deny (viewer); cross-org FK rejection; batch
// empty-guard + dedupe; and that a spoofed actor.userId is overridden by the verified
// token subject. The requireService mirrors are covered by kitPerUnit / warehousePageBatch.
import { convexTest } from "convex-test";
import { register as registerRateLimiter } from "@convex-dev/rate-limiter/test";
import { register as registerShardedCounter } from "@convex-dev/sharded-counter/test";
import { describe, test, expect } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";

const modules = import.meta.glob("./**/*.ts");
const ORG = "org_1";
const OTHER = "org_other";
const USER = "user_1";
const NOW = 1_700_000_000_000;
const asUser = (orgId: string) => ({ subject: USER, orgId });
// A deliberately-wrong actor — resolveActor must pin attribution to the token subject.
const SPOOF = { userId: "attacker_id", userName: "Mallory" };

function makeT() {
  const t = convexTest(schema, modules);
  registerRateLimiter(t, "rateLimiter");
  registerShardedCounter(t, "shardedCounter");
  return t;
}
type T = ReturnType<typeof makeT>;

async function member(t: T, role: string, orgId = ORG) {
  await t.run(async (ctx) => {
    await ctx.db.insert("members", { id: `m-${role}`, organizationId: orgId, userId: USER, role });
  });
}

async function seedProject(t: T, id = "p1", orgId = ORG) {
  await t.run(async (ctx) => {
    await ctx.db.insert("projects", {
      id, organizationId: orgId, projectNumber: `P-${id}`, name: "Gig", status: "CONFIRMED",
      defaultRentalPeriod: "DAILY", defaultRentalQuantity: 1, total: 0,
    });
  });
}

const baseLine = (id: string, extra: Record<string, unknown>, orgId = ORG) => ({
  id, organizationId: orgId, projectId: "p1", type: "EQUIPMENT" as const, quantity: 1, sortOrder: 0,
  status: "CONFIRMED" as const, checkedOutQuantity: 0, prepStatus: "PENDING" as const,
  isKitChild: false, createdAt: NOW, updatedAt: NOW, ...extra,
});

const lineById = (t: T, id: string) =>
  t.run(async (ctx) => ctx.db.query("projectLineItems").withIndex("by_cuid", (q) => q.eq("id", id)).unique());
const unitById = (t: T, id: string) =>
  t.run(async (ctx) => ctx.db.query("projectLineItemUnits").withIndex("by_cuid", (q) => q.eq("id", id)).unique());
const assetById = (t: T, id: string) =>
  t.run(async (ctx) => ctx.db.query("assets").withIndex("by_cuid", (q) => q.eq("id", id)).unique());
const kitById = (t: T, id: string) =>
  t.run(async (ctx) => ctx.db.query("kits").withIndex("by_cuid", (q) => q.eq("id", id)).unique());
const logById = (t: T, id: string) =>
  t.run(async (ctx) => ctx.db.query("activityLogs").withIndex("by_cuid", (q) => q.eq("id", id)).first());

async function seedModelAsset(t: T, orgId = ORG, status: "CHECKED_OUT" | "AVAILABLE" | "IN_MAINTENANCE" | "RETIRED" | "LOST" | "RESERVED" = "CHECKED_OUT") {
  await t.run(async (ctx) => {
    await ctx.db.insert("models", { id: "m1", organizationId: orgId, name: "PAR", createdAt: NOW, updatedAt: NOW });
    await ctx.db.insert("assets", { id: "a1", organizationId: orgId, modelId: "m1", assetTag: "A-1", status, condition: "GOOD", isActive: true, createdAt: NOW, updatedAt: NOW });
  });
}

// ─── checkInItems ─────────────────────────────────────────────────────────────
describe("checkInItems", () => {
  async function seed(t: T) {
    await member(t, "member");
    await seedProject(t);
    await seedModelAsset(t);
    await t.run(async (ctx) => {
      await ctx.db.insert("projectLineItems", baseLine("li1", { modelId: "m1", assetId: "a1", status: "CHECKED_OUT", checkedOutQuantity: 1 }));
      await ctx.db.insert("projectLineItemUnits", { id: "u1", organizationId: ORG, lineItemId: "li1", ordinal: 0, assetId: "a1", quantity: 1, status: "CHECKED_OUT", createdAt: NOW, updatedAt: NOW });
    });
  }

  test("returns a serialised unit (CHECKED_OUT → RETURNED) + asset AVAILABLE + audit", async () => {
    const t = makeT();
    await seed(t);
    const res = await t.withIdentity(asUser(ORG)).mutation(api.warehouseWrites.checkInItems, {
      orgId: ORG, projectId: "p1",
      items: [{ lineItemId: "li1", assetId: "a1", returnCondition: "GOOD" }],
      auditIds: ["log1"], now: NOW, actor: SPOOF,
    });
    expect(res.updatedLineIds).toEqual(["li1"]);
    expect((await unitById(t, "u1"))?.status).toBe("RETURNED");
    expect((await assetById(t, "a1"))?.status).toBe("AVAILABLE");
    const log = await logById(t, "log1");
    expect(log?.action).toBe("CHECK_IN");
    expect(log?.entityId).toBe("li1");
    expect(log?.summary).toBe("Checked in item on project (condition: GOOD)");
    // Spoofed actor.userId is overridden by the verified token subject everywhere.
    expect(log?.userId).toBe(USER);
    expect((await unitById(t, "u1"))?.returnedById).toBe(USER);
  });

  test("cross-org line item rejected", async () => {
    const t = makeT();
    await member(t, "member");
    await seedProject(t); // p1 in ORG
    await t.run(async (ctx) => {
      await ctx.db.insert("projectLineItems", { ...baseLine("liX", { modelId: "m1", status: "CHECKED_OUT" }, OTHER), projectId: "pX" });
    });
    await expect(
      t.withIdentity(asUser(ORG)).mutation(api.warehouseWrites.checkInItems, {
        orgId: ORG, projectId: "p1", items: [{ lineItemId: "liX", returnCondition: "GOOD" }], auditIds: ["log1"], now: NOW, actor: SPOOF,
      }),
    ).rejects.toThrow(/not found in project/i);
  });

  test("viewer denied", async () => {
    const t = makeT();
    await member(t, "viewer");
    await seedProject(t);
    await expect(
      t.withIdentity(asUser(ORG)).mutation(api.warehouseWrites.checkInItems, {
        orgId: ORG, projectId: "p1", items: [{ lineItemId: "li1", returnCondition: "GOOD" }], auditIds: ["log1"], now: NOW, actor: SPOOF,
      }),
    ).rejects.toThrow(/insufficient permissions/i);
  });
});

// ─── undeployKitsBatch ──────────────────────────────────────────────────────────
describe("undeployKitsBatch", () => {
  async function seedKit(t: T) {
    await member(t, "member");
    await seedProject(t);
    await seedModelAsset(t);
    await t.run(async (ctx) => {
      await ctx.db.insert("kits", { id: "k1", organizationId: ORG, assetTag: "KIT-1", name: "Lighting", status: "CHECKED_OUT", condition: "GOOD", isActive: true, createdAt: NOW, updatedAt: NOW });
      await ctx.db.insert("projectLineItems", baseLine("kl1", { kitId: "k1", isKitChild: false, status: "CHECKED_OUT", checkedOutQuantity: 1 }));
      await ctx.db.insert("projectLineItems", baseLine("c1", { parentLineItemId: "kl1", isKitChild: true, modelId: "m1", assetId: "a1", status: "CHECKED_OUT", checkedOutQuantity: 1 }));
    });
  }

  test("moves eligible kit Deployed → Prepped; ghost kit → per-item error; audit + spoof override", async () => {
    const t = makeT();
    await seedKit(t);
    const res = await t.withIdentity(asUser(ORG)).mutation(api.warehouseWrites.undeployKitsBatch, {
      orgId: ORG, projectId: "p1", kitIds: ["k1", "ghost"], auditId: "log1", now: NOW, actor: SPOOF,
    });
    expect(res.succeeded).toEqual(["k1"]);
    expect(res.errors.map((e) => e.kitId)).toEqual(["ghost"]);
    expect((await lineById(t, "kl1"))?.status).toBe("CONFIRMED");
    expect((await lineById(t, "kl1"))?.prepStatus).toBe("PACKED");
    expect((await assetById(t, "a1"))?.status).toBe("AVAILABLE");
    const log = await logById(t, "log1");
    expect(log?.summary).toBe("Moved 1 kit(s) back to Prepped (un-deploy)");
    expect(log?.userId).toBe(USER);
  });

  test("empty-guard throws", async () => {
    const t = makeT();
    await member(t, "member");
    await seedProject(t);
    await expect(
      t.withIdentity(asUser(ORG)).mutation(api.warehouseWrites.undeployKitsBatch, {
        orgId: ORG, projectId: "p1", kitIds: [], auditId: "log1", now: NOW, actor: SPOOF,
      }),
    ).rejects.toThrow(/No kits selected/i);
  });

  test("viewer denied", async () => {
    const t = makeT();
    await member(t, "viewer");
    await seedProject(t);
    await expect(
      t.withIdentity(asUser(ORG)).mutation(api.warehouseWrites.undeployKitsBatch, {
        orgId: ORG, projectId: "p1", kitIds: ["k1"], auditId: "log1", now: NOW, actor: SPOOF,
      }),
    ).rejects.toThrow(/insufficient permissions/i);
  });
});

// ─── checkInKit ───────────────────────────────────────────────────────────────
describe("checkInKit", () => {
  async function seedKit(t: T, kitOrg = ORG) {
    await member(t, "member");
    await seedProject(t);
    await seedModelAsset(t);
    await t.run(async (ctx) => {
      await ctx.db.insert("kits", { id: "k1", organizationId: kitOrg, assetTag: "KIT-1", name: "Lighting", status: "CHECKED_OUT", condition: "GOOD", isActive: true, createdAt: NOW, updatedAt: NOW });
      await ctx.db.insert("projectLineItems", baseLine("kl1", { kitId: "k1", isKitChild: false, status: "CHECKED_OUT", checkedOutQuantity: 1 }));
      await ctx.db.insert("projectLineItems", baseLine("c1", { parentLineItemId: "kl1", isKitChild: true, modelId: "m1", assetId: "a1", status: "CHECKED_OUT", checkedOutQuantity: 1 }));
    });
  }

  test("returns a whole kit (lines RETURNED, asset AVAILABLE, kit AVAILABLE) + audit", async () => {
    const t = makeT();
    await seedKit(t);
    const res = await t.withIdentity(asUser(ORG)).mutation(api.warehouseWrites.checkInKit, {
      orgId: ORG, projectId: "p1", kitId: "k1", returnCondition: "GOOD", auditId: "log1", now: NOW, actor: SPOOF,
    });
    expect(res.kitId).toBe("k1");
    expect((await lineById(t, "kl1"))?.status).toBe("RETURNED");
    expect((await assetById(t, "a1"))?.status).toBe("AVAILABLE");
    expect((await kitById(t, "k1"))?.status).toBe("AVAILABLE");
    const log = await logById(t, "log1");
    expect(log?.action).toBe("CHECK_IN");
    expect(log?.summary).toBe("Checked in kit (condition: GOOD)");
    expect(log?.userId).toBe(USER);
  });

  test("cross-org kit rejected", async () => {
    const t = makeT();
    await seedKit(t, OTHER); // kit lives in another org
    await expect(
      t.withIdentity(asUser(ORG)).mutation(api.warehouseWrites.checkInKit, {
        orgId: ORG, projectId: "p1", kitId: "k1", returnCondition: "GOOD", auditId: "log1", now: NOW, actor: SPOOF,
      }),
    ).rejects.toThrow(/Kit not found/i);
  });

  test("viewer denied", async () => {
    const t = makeT();
    await member(t, "viewer");
    await seedProject(t);
    await expect(
      t.withIdentity(asUser(ORG)).mutation(api.warehouseWrites.checkInKit, {
        orgId: ORG, projectId: "p1", kitId: "k1", returnCondition: "GOOD", auditId: "log1", now: NOW, actor: SPOOF,
      }),
    ).rejects.toThrow(/insufficient permissions/i);
  });
});

// ─── ensureContainerOnProject ───────────────────────────────────────────────────
describe("ensureContainerOnProject", () => {
  async function seed(t: T) {
    await member(t, "member");
    await seedProject(t);
    await seedModelAsset(t, ORG, "AVAILABLE");
  }

  test("creates a container line (idempotent on the (asset, project) uniqueness check)", async () => {
    const t = makeT();
    await seed(t);
    const r1 = await t.withIdentity(asUser(ORG)).mutation(api.warehouseWrites.ensureContainerOnProject, {
      orgId: ORG, projectId: "p1", assetId: "a1", modelId: "m1", containerName: "C1", now: NOW, actor: SPOOF,
    });
    expect(r1.created).toBe(true);
    const line = await lineById(t, r1.id);
    expect(line?.isContainerLineItem).toBe(true);
    expect(line?.prepContainer).toBe("C1");
    // Retry → same line, no duplicate.
    const r2 = await t.withIdentity(asUser(ORG)).mutation(api.warehouseWrites.ensureContainerOnProject, {
      orgId: ORG, projectId: "p1", assetId: "a1", modelId: "m1", containerName: "C1", now: NOW, actor: SPOOF,
    });
    expect(r2).toEqual({ id: r1.id, created: false });
  });

  test("cross-org asset rejected", async () => {
    const t = makeT();
    await member(t, "member");
    await seedProject(t);
    await t.run(async (ctx) => {
      await ctx.db.insert("models", { id: "m1", organizationId: ORG, name: "PAR", createdAt: NOW, updatedAt: NOW });
      await ctx.db.insert("assets", { id: "a1", organizationId: OTHER, modelId: "m1", assetTag: "A-1", status: "AVAILABLE", condition: "GOOD", isActive: true, createdAt: NOW, updatedAt: NOW });
    });
    await expect(
      t.withIdentity(asUser(ORG)).mutation(api.warehouseWrites.ensureContainerOnProject, {
        orgId: ORG, projectId: "p1", assetId: "a1", modelId: "m1", containerName: "C1", now: NOW, actor: SPOOF,
      }),
    ).rejects.toThrow(/Asset not found/i);
  });

  test("viewer denied", async () => {
    const t = makeT();
    await member(t, "viewer");
    await seedProject(t);
    await seedModelAsset(t, ORG, "AVAILABLE");
    await expect(
      t.withIdentity(asUser(ORG)).mutation(api.warehouseWrites.ensureContainerOnProject, {
        orgId: ORG, projectId: "p1", assetId: "a1", modelId: "m1", containerName: "C1", now: NOW, actor: SPOOF,
      }),
    ).rejects.toThrow(/insufficient permissions/i);
  });
});

// ─── syncContainersBatch ────────────────────────────────────────────────────────
describe("syncContainersBatch", () => {
  async function seedContainers(t: T) {
    await member(t, "member");
    await seedProject(t);
    await t.run(async (ctx) => {
      // C1: container line CONFIRMED + all-deployed contents → flips CHECKED_OUT.
      await ctx.db.insert("projectLineItems", baseLine("c1li", { prepContainer: "C1", isContainerLineItem: true }));
      await ctx.db.insert("projectLineItems", baseLine("c1a", { prepContainer: "C1", status: "CHECKED_OUT" }));
      await ctx.db.insert("projectLineItems", baseLine("c1b", { prepContainer: "C1", status: "CHECKED_OUT" }));
    });
  }

  test("rolls up + dedupes container names; ghost → no-op; spoof userId overridden", async () => {
    const t = makeT();
    await seedContainers(t);
    const res = await t.withIdentity(asUser(ORG)).mutation(api.warehouseWrites.syncContainersBatch, {
      orgId: ORG, projectId: "p1", containerNames: ["C1", "C1", "Cghost"], now: NOW, actor: SPOOF,
    });
    // Deduped: exactly one C1 result + one Cghost.
    expect(res.results).toHaveLength(2);
    const byName = new Map(res.results.map((r) => [r.containerName, r]));
    expect(byName.get("C1")).toEqual({ containerName: "C1", updated: true, status: "CHECKED_OUT" });
    expect(byName.get("Cghost")).toEqual({ containerName: "Cghost", updated: false });
    const containerLine = await lineById(t, "c1li");
    expect(containerLine?.status).toBe("CHECKED_OUT");
    expect(containerLine?.checkedOutById).toBe(USER); // spoofed actor overridden
  });

  test("empty-guard returns no results", async () => {
    const t = makeT();
    await member(t, "member");
    await seedProject(t);
    const res = await t.withIdentity(asUser(ORG)).mutation(api.warehouseWrites.syncContainersBatch, {
      orgId: ORG, projectId: "p1", containerNames: [], now: NOW, actor: SPOOF,
    });
    expect(res).toEqual({ results: [] });
  });

  test("viewer denied", async () => {
    const t = makeT();
    await member(t, "viewer");
    await seedProject(t);
    await expect(
      t.withIdentity(asUser(ORG)).mutation(api.warehouseWrites.syncContainersBatch, {
        orgId: ORG, projectId: "p1", containerNames: ["C1"], now: NOW, actor: SPOOF,
      }),
    ).rejects.toThrow(/insufficient permissions/i);
  });
});
