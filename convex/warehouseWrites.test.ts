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
import { evaluateBlockingGate as convexGate } from "./lib/blockingCommentsGate";
import { evaluateBlockingGate as srcGate } from "@/lib/blocking-comments-gate";

const modules = import.meta.glob("./**/*.ts");
const ORG = "org_1";
const OTHER = "org_other";
const USER = "user_1";
const NOW = 1_700_000_000_000;
const asUser = (orgId: string) => ({ subject: USER, orgId });
// SERVICE identity to drive the createKitLineItem fixture (requireService) in the
// checkOutKitsBatch partial-success test.
const SERVICE = { subject: "gearflow-service", svc: true };
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

// ─── reassignLineItemUnit (PR-B) ────────────────────────────────────────────────
describe("reassignLineItemUnit", () => {
  async function seed(t: T) {
    await member(t, "member");
    await seedProject(t);
    await seedModelAsset(t, ORG, "RESERVED"); // asset a1 assigned (prepped), not out
    await t.run(async (ctx) => {
      // Two same-model lines on p1; the unit sits on li1, we reassign it to li2.
      await ctx.db.insert("projectLineItems", baseLine("li1", { modelId: "m1", quantity: 1, checkedOutQuantity: 0 }));
      await ctx.db.insert("projectLineItems", baseLine("li2", { modelId: "m1", quantity: 1, checkedOutQuantity: 0 }));
      await ctx.db.insert("projectLineItemUnits", { id: "u1", organizationId: ORG, lineItemId: "li1", ordinal: 0, assetId: "a1", quantity: 1, status: "CONFIRMED", createdAt: NOW, updatedAt: NOW });
    });
  }

  test("moves a unit to another same-model line + audit (assetTag gathered in-mutation) + spoof override", async () => {
    const t = makeT();
    await seed(t);
    const res = await t.withIdentity(asUser(ORG)).mutation(api.warehouseWrites.reassignLineItemUnit, {
      orgId: ORG, projectId: "p1", unitId: "u1", targetLineItemId: "li2", auditId: "log1", now: NOW, actor: SPOOF,
    });
    expect(res.moved).toBe(true);
    if (res.moved) expect(res.assetTag).toBe("A-1");
    expect((await unitById(t, "u1"))?.lineItemId).toBe("li2");
    const log = await logById(t, "log1");
    expect(log?.action).toBe("UPDATE");
    expect(log?.entityName).toBe("Asset A-1"); // from the asset doc, not a client arg
    expect(log?.userId).toBe(USER); // spoofed actor overridden
  });

  test("cross-org target line rejected (boundary FK)", async () => {
    const t = makeT();
    await seed(t);
    await t.run(async (ctx) => {
      // A line that exists but in another org / project — must be rejected at the boundary.
      await ctx.db.insert("projectLineItems", { ...baseLine("liX", { modelId: "m1" }, OTHER), projectId: "pX" });
    });
    await expect(
      t.withIdentity(asUser(ORG)).mutation(api.warehouseWrites.reassignLineItemUnit, {
        orgId: ORG, projectId: "p1", unitId: "u1", targetLineItemId: "liX", auditId: "log1", now: NOW, actor: SPOOF,
      }),
    ).rejects.toThrow(/not found in project/i);
  });

  test("cross-org unit rejected (boundary FK)", async () => {
    const t = makeT();
    await seed(t);
    await t.run(async (ctx) => {
      await ctx.db.insert("projectLineItemUnits", { id: "uX", organizationId: OTHER, lineItemId: "li1", ordinal: 5, assetId: "a1", quantity: 1, status: "CONFIRMED", createdAt: NOW, updatedAt: NOW });
    });
    await expect(
      t.withIdentity(asUser(ORG)).mutation(api.warehouseWrites.reassignLineItemUnit, {
        orgId: ORG, projectId: "p1", unitId: "uX", targetLineItemId: "li2", auditId: "log1", now: NOW, actor: SPOOF,
      }),
    ).rejects.toThrow(/Unit not found/i);
  });

  test("viewer denied", async () => {
    const t = makeT();
    await member(t, "viewer");
    await seedProject(t);
    await expect(
      t.withIdentity(asUser(ORG)).mutation(api.warehouseWrites.reassignLineItemUnit, {
        orgId: ORG, projectId: "p1", unitId: "u1", targetLineItemId: "li2", auditId: "log1", now: NOW, actor: SPOOF,
      }),
    ).rejects.toThrow(/insufficient permissions/i);
  });
});

// ─── forceReturnAsset (PR-B) ─────────────────────────────────────────────────────
describe("forceReturnAsset", () => {
  async function seed(t: T) {
    await member(t, "member");
    await seedProject(t);
    await seedModelAsset(t); // a1 CHECKED_OUT
    await t.run(async (ctx) => {
      await ctx.db.insert("projectLineItems", baseLine("li1", { modelId: "m1", assetId: "a1", status: "CHECKED_OUT", checkedOutQuantity: 1 }));
    });
  }

  test("asset → AVAILABLE + line → RETURNED + audit tag gathered in-mutation + spoof override", async () => {
    const t = makeT();
    await seed(t);
    const res = await t.withIdentity(asUser(ORG)).mutation(api.warehouseWrites.forceReturnAsset, {
      orgId: ORG, assetId: "a1", auditId: "log1", now: NOW, actor: SPOOF,
    });
    expect(res.success).toBe(true);
    expect((await assetById(t, "a1"))?.status).toBe("AVAILABLE");
    expect((await lineById(t, "li1"))?.status).toBe("RETURNED");
    const log = await logById(t, "log1");
    expect(log?.action).toBe("FORCE_RETURN");
    expect(log?.entityName).toBe("A-1"); // asset tag read from ctx.db, not client-passed
    expect(log?.summary).toBe("Force returned asset A-1 to available");
    expect(log?.userId).toBe(USER);
  });

  test("already-available asset rejected", async () => {
    const t = makeT();
    await member(t, "member");
    await seedProject(t);
    await seedModelAsset(t, ORG, "AVAILABLE");
    await expect(
      t.withIdentity(asUser(ORG)).mutation(api.warehouseWrites.forceReturnAsset, {
        orgId: ORG, assetId: "a1", auditId: "log1", now: NOW, actor: SPOOF,
      }),
    ).rejects.toThrow(/already available/i);
  });

  test("cross-org asset rejected", async () => {
    const t = makeT();
    await member(t, "member");
    await seedProject(t);
    await seedModelAsset(t, OTHER); // asset in another org
    await expect(
      t.withIdentity(asUser(ORG)).mutation(api.warehouseWrites.forceReturnAsset, {
        orgId: ORG, assetId: "a1", auditId: "log1", now: NOW, actor: SPOOF,
      }),
    ).rejects.toThrow(/Asset not found/i);
  });

  test("viewer denied", async () => {
    const t = makeT();
    await member(t, "viewer");
    await seedModelAsset(t);
    await expect(
      t.withIdentity(asUser(ORG)).mutation(api.warehouseWrites.forceReturnAsset, {
        orgId: ORG, assetId: "a1", auditId: "log1", now: NOW, actor: SPOOF,
      }),
    ).rejects.toThrow(/insufficient permissions/i);
  });
});

// ─── forceReturnKits — batch partial-success (PR-B) ──────────────────────────────
describe("forceReturnKits", () => {
  async function seedKit(t: T) {
    await member(t, "member");
    await seedProject(t);
    await seedModelAsset(t); // a1 CHECKED_OUT
    await t.run(async (ctx) => {
      await ctx.db.insert("kits", { id: "k1", organizationId: ORG, assetTag: "KIT-1", name: "Lighting", status: "CHECKED_OUT", condition: "GOOD", isActive: true, createdAt: NOW, updatedAt: NOW });
      await ctx.db.insert("projectLineItems", baseLine("kl1", { kitId: "k1", isKitChild: false, status: "CHECKED_OUT", checkedOutQuantity: 1 }));
      await ctx.db.insert("projectLineItems", baseLine("c1", { parentLineItemId: "kl1", isKitChild: true, modelId: "m1", assetId: "a1", status: "CHECKED_OUT", checkedOutQuantity: 1 }));
    });
  }

  test("one valid + one ghost → partial-success; dedupe; audit name gathered in-mutation; spoof override", async () => {
    const t = makeT();
    await seedKit(t);
    const res = await t.withIdentity(asUser(ORG)).mutation(api.warehouseWrites.forceReturnKits, {
      // "k1" duplicated → must be deduped (restore-per-occurrence would double-apply).
      orgId: ORG, kitIds: ["k1", "k1", "ghost"], auditId: "log1", now: NOW, actor: SPOOF,
    });
    expect(res.count).toBe(1);
    expect(res.succeeded).toEqual(["k1"]);
    expect(res.errors.map((e) => e.kitId)).toEqual(["ghost"]);
    expect((await kitById(t, "k1"))?.status).toBe("AVAILABLE");
    expect((await lineById(t, "kl1"))?.status).toBe("RETURNED");
    expect((await assetById(t, "a1"))?.status).toBe("AVAILABLE");
    const log = await logById(t, "log1");
    expect(log?.action).toBe("FORCE_RETURN");
    expect(log?.entityName).toBe("KIT-1 - Lighting"); // kit name read from ctx.db
    expect(log?.userId).toBe(USER);
  });

  test("empty-guard throws", async () => {
    const t = makeT();
    await member(t, "member");
    await expect(
      t.withIdentity(asUser(ORG)).mutation(api.warehouseWrites.forceReturnKits, {
        orgId: ORG, kitIds: [], auditId: "log1", now: NOW, actor: SPOOF,
      }),
    ).rejects.toThrow(/No kits selected/i);
  });

  test("viewer denied", async () => {
    const t = makeT();
    await member(t, "viewer");
    await expect(
      t.withIdentity(asUser(ORG)).mutation(api.warehouseWrites.forceReturnKits, {
        orgId: ORG, kitIds: ["k1"], auditId: "log1", now: NOW, actor: SPOOF,
      }),
    ).rejects.toThrow(/insufficient permissions/i);
  });
});

// ─── bulkForceReturnAssets — batch partial-success (PR-B) ────────────────────────
describe("bulkForceReturnAssets", () => {
  async function seed(t: T) {
    await member(t, "member");
    await seedProject(t);
    await seedModelAsset(t); // a1 CHECKED_OUT
    await t.run(async (ctx) => {
      await ctx.db.insert("projectLineItems", baseLine("li1", { modelId: "m1", assetId: "a1", status: "CHECKED_OUT", checkedOutQuantity: 1 }));
    });
  }

  test("only CHECKED_OUT in-org assets succeed; dedupe; foreign/ghost skipped; audit tags in-mutation", async () => {
    const t = makeT();
    await seed(t);
    const res = await t.withIdentity(asUser(ORG)).mutation(api.warehouseWrites.bulkForceReturnAssets, {
      orgId: ORG, assetIds: ["a1", "a1", "ghost"], auditId: "log1", now: NOW, actor: SPOOF,
    });
    expect(res.count).toBe(1); // deduped, ghost skipped
    expect((await assetById(t, "a1"))?.status).toBe("AVAILABLE");
    expect((await lineById(t, "li1"))?.status).toBe("RETURNED");
    const log = await logById(t, "log1");
    expect(log?.action).toBe("FORCE_RETURN");
    expect(log?.entityName).toBe("A-1"); // asset tag read from ctx.db
    expect(log?.userId).toBe(USER);
  });

  test("empty-guard throws", async () => {
    const t = makeT();
    await member(t, "member");
    await expect(
      t.withIdentity(asUser(ORG)).mutation(api.warehouseWrites.bulkForceReturnAssets, {
        orgId: ORG, assetIds: [], auditId: "log1", now: NOW, actor: SPOOF,
      }),
    ).rejects.toThrow(/No assets selected/i);
  });

  test("viewer denied", async () => {
    const t = makeT();
    await member(t, "viewer");
    await expect(
      t.withIdentity(asUser(ORG)).mutation(api.warehouseWrites.bulkForceReturnAssets, {
        orgId: ORG, assetIds: ["a1"], auditId: "log1", now: NOW, actor: SPOOF,
      }),
    ).rejects.toThrow(/insufficient permissions/i);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// PR-C — checkout keystone. Verifies the blocking-comment gate + webhook enqueue
// carve-outs run IN the mutation, the FK hardening on quickAdd, and audit parity.
// ═══════════════════════════════════════════════════════════════════════════════

/** Open, project-level blocking comment on p1 → the send-out gate must fire. */
async function seedBlockingComment(t: T, orgId = ORG, projectId = "p1") {
  await t.run(async (ctx) => {
    await ctx.db.insert("commentThreads", {
      orgId, entityType: "project", entityId: projectId, projectId,
      status: "open", isBlocking: true,
      createdBy: USER, createdByName: "Boss", createdAt: NOW, updatedAt: NOW,
    });
  });
}

const scanLogsForProject = (t: T, projectId = "p1") =>
  t.run(async (ctx) => ctx.db.query("assetScanLogs").withIndex("by_projectId", (q) => q.eq("projectId", projectId)).collect());
const deliveriesForOrg = (t: T, orgId = ORG) =>
  t.run(async (ctx) => ctx.db.query("webhookDeliveries").withIndex("by_organizationId", (q) => q.eq("organizationId", orgId)).collect());
const logsForOrg = (t: T, orgId = ORG) =>
  t.run(async (ctx) => ctx.db.query("activityLogs").withIndex("by_organizationId", (q) => q.eq("organizationId", orgId)).collect());

// ─── checkOutItems ──────────────────────────────────────────────────────────────
describe("checkOutItems", () => {
  async function seed(t: T) {
    await member(t, "member");
    await seedProject(t);
    await seedModelAsset(t, ORG, "AVAILABLE");
    await t.run(async (ctx) => {
      await ctx.db.insert("projectLineItems", baseLine("li1", { modelId: "m1", assetId: "a1", status: "CONFIRMED" }));
    });
  }

  test("deploys a serialised line (asset → CHECKED_OUT), enqueues the webhook, per-item audit", async () => {
    const t = makeT();
    await seed(t);
    // An active endpoint subscribed to the event.
    await t.run(async (ctx) => {
      await ctx.db.insert("webhooks", {
        id: "wh1", organizationId: ORG, description: "e2e", url: "https://x.test/hook",
        events: JSON.stringify(["warehouse.checked_out"]), secret: "s", isActive: true, createdById: USER, createdAt: NOW,
      });
    });
    const res = await t.withIdentity(asUser(ORG)).mutation(api.warehouseWrites.checkOutItems, {
      orgId: ORG, projectId: "p1",
      items: [{ lineItemId: "li1", assetId: "a1" }],
      includeAccessories: true, auditIds: ["log1"], now: NOW, actor: SPOOF,
    });
    expect(res.updatedLineIds).toEqual(["li1"]);
    expect((await assetById(t, "a1"))?.status).toBe("CHECKED_OUT");
    // Per-item audit, attributed to the token subject (not the spoofed actor).
    const log = await logById(t, "log1");
    expect(log?.action).toBe("CHECK_OUT");
    expect(log?.entityId).toBe("a1");
    expect(log?.summary).toBe("Checked out item on project");
    expect(log?.userId).toBe(USER);
    // Webhook enqueue carve-out — one PENDING delivery row, due now.
    const deliveries = await deliveriesForOrg(t);
    expect(deliveries).toHaveLength(1);
    expect(deliveries[0].event).toBe("warehouse.checked_out");
    expect(deliveries[0].status).toBe("PENDING");
    expect(deliveries[0].webhookId).toBe("wh1");
    const payload = JSON.parse(deliveries[0].payload);
    expect(payload.projectId).toBe("p1");
    expect(payload.lineItemIds).toEqual(["li1"]);
    expect(payload.assetIds).toEqual(["a1"]);
  });

  test("no active subscription → no delivery rows (but checkout still succeeds)", async () => {
    const t = makeT();
    await seed(t);
    const res = await t.withIdentity(asUser(ORG)).mutation(api.warehouseWrites.checkOutItems, {
      orgId: ORG, projectId: "p1", items: [{ lineItemId: "li1", assetId: "a1" }],
      includeAccessories: true, auditIds: ["log1"], now: NOW, actor: SPOOF,
    });
    expect(res.updatedLineIds).toEqual(["li1"]);
    expect(await deliveriesForOrg(t)).toHaveLength(0);
  });

  test("blocking comment present → ConvexError, no write", async () => {
    const t = makeT();
    await seed(t);
    await seedBlockingComment(t);
    await expect(
      t.withIdentity(asUser(ORG)).mutation(api.warehouseWrites.checkOutItems, {
        orgId: ORG, projectId: "p1", items: [{ lineItemId: "li1", assetId: "a1" }],
        includeAccessories: true, auditIds: ["log1"], now: NOW, actor: SPOOF,
      }),
    ).rejects.toThrow(/unresolved blocking comment/i);
    // Gate fires BEFORE the core — the asset never moved.
    expect((await assetById(t, "a1"))?.status).toBe("AVAILABLE");
  });

  test("cross-org line item rejected", async () => {
    const t = makeT();
    await member(t, "member");
    await seedProject(t);
    await t.run(async (ctx) => {
      await ctx.db.insert("projectLineItems", { ...baseLine("liX", { modelId: "m1", status: "CONFIRMED" }, OTHER), projectId: "pX" });
    });
    await expect(
      t.withIdentity(asUser(ORG)).mutation(api.warehouseWrites.checkOutItems, {
        orgId: ORG, projectId: "p1", items: [{ lineItemId: "liX" }],
        includeAccessories: true, auditIds: ["log1"], now: NOW, actor: SPOOF,
      }),
    ).rejects.toThrow(/not found in project/i);
  });

  test("viewer denied", async () => {
    const t = makeT();
    await member(t, "viewer");
    await seedProject(t);
    await expect(
      t.withIdentity(asUser(ORG)).mutation(api.warehouseWrites.checkOutItems, {
        orgId: ORG, projectId: "p1", items: [{ lineItemId: "li1" }],
        includeAccessories: true, auditIds: ["log1"], now: NOW, actor: SPOOF,
      }),
    ).rejects.toThrow(/insufficient permissions/i);
  });

  // Issue #794 — the line's stored accessoryPlan is the SOLE authority at checkout;
  // deselecting a default at add-time (or prep) must stick, not get resurrected by
  // an unfiltered re-expansion (the "prep selection is silently overridden at
  // checkout" defect the design doc's current-state audit found).
  describe("honours the line's accessoryPlan (issue #794)", () => {
    async function seedWithAccessories(t: T, plan?: { excluded: string[]; added: { bulkAssetId: string }[] }) {
      await member(t, "member");
      await seedProject(t);
      await seedModelAsset(t, ORG, "AVAILABLE");
      await t.run(async (ctx) => {
        await ctx.db.insert("bulkAssets", { id: "ba-default", organizationId: ORG, modelId: "m1", assetTag: "BA-DEF", isActive: true });
        await ctx.db.insert("bulkAssets", { id: "ba-optional", organizationId: ORG, modelId: "m1", assetTag: "BA-OPT", isActive: true });
        await ctx.db.insert("modelBulkAccessories", { id: "mba-def", organizationId: ORG, modelId: "m1", bulkAssetId: "ba-default", quantity: 1, addedById: USER });
        await ctx.db.insert("modelBulkAccessories", { id: "mba-opt", organizationId: ORG, modelId: "m1", bulkAssetId: "ba-optional", quantity: 1, inclusion: "OPTIONAL", addedById: USER });
        await ctx.db.insert("projectLineItems", baseLine("li1", { modelId: "m1", assetId: "a1", status: "CONFIRMED", accessoryPlan: plan }));
      });
    }
    const accessoryChildren = (t: T) =>
      t.run(async (ctx) =>
        (await ctx.db.query("projectLineItems").withIndex("by_parentLineItemId", (q) => q.eq("parentLineItemId", "li1")).collect())
          .filter((c) => c.childKind === "ACCESSORY"),
      );

    test("a deselected DEFAULT never cascades at checkout, even with no per-item filter", async () => {
      const t = makeT();
      await seedWithAccessories(t, { excluded: ["ba-default"], added: [] });
      await t.withIdentity(asUser(ORG)).mutation(api.warehouseWrites.checkOutItems, {
        orgId: ORG, projectId: "p1", items: [{ lineItemId: "li1", assetId: "a1" }],
        includeAccessories: true, auditIds: ["log1"], now: NOW, actor: SPOOF,
      });
      const children = await accessoryChildren(t);
      expect(children.map((c) => c.bulkAssetId)).not.toContain("ba-default");
    });

    test("an OPTIONAL accessory never cascades unless the plan opted in", async () => {
      const t = makeT();
      await seedWithAccessories(t); // no plan at all
      await t.withIdentity(asUser(ORG)).mutation(api.warehouseWrites.checkOutItems, {
        orgId: ORG, projectId: "p1", items: [{ lineItemId: "li1", assetId: "a1" }],
        includeAccessories: true, auditIds: ["log1"], now: NOW, actor: SPOOF,
      });
      const children = await accessoryChildren(t);
      expect(children.map((c) => c.bulkAssetId)).toEqual(["ba-default"]);
      expect(children.map((c) => c.bulkAssetId)).not.toContain("ba-optional");
    });

    test("an opted-in OPTIONAL accessory DOES cascade at checkout", async () => {
      const t = makeT();
      await seedWithAccessories(t, { excluded: [], added: [{ bulkAssetId: "ba-optional" }] });
      await t.withIdentity(asUser(ORG)).mutation(api.warehouseWrites.checkOutItems, {
        orgId: ORG, projectId: "p1", items: [{ lineItemId: "li1", assetId: "a1" }],
        includeAccessories: true, auditIds: ["log1"], now: NOW, actor: SPOOF,
      });
      const children = await accessoryChildren(t);
      expect(children.map((c) => c.bulkAssetId).sort()).toEqual(["ba-default", "ba-optional"]);
    });

    test("per-item includeAccessoryIds narrows the cascade to a verified subset", async () => {
      const t = makeT();
      await seedWithAccessories(t, { excluded: [], added: [{ bulkAssetId: "ba-optional" }] });
      await t.withIdentity(asUser(ORG)).mutation(api.warehouseWrites.checkOutItems, {
        orgId: ORG, projectId: "p1",
        items: [{ lineItemId: "li1", assetId: "a1", includeAccessoryIds: ["ba-default"] }],
        includeAccessories: true, auditIds: ["log1"], now: NOW, actor: SPOOF,
      });
      // Only the verified ("ba-default") accessory materialises + deploys — the
      // unverified plan-added optional stays behind entirely (deployable later),
      // the "Deploy Verified Only" partial-deploy escape hatch (issue #794).
      const children = await accessoryChildren(t);
      expect(children.map((c) => c.bulkAssetId)).toEqual(["ba-default"]);
      const outUnits = await t.run(async (ctx) =>
        (await ctx.db.query("projectLineItemUnits").withIndex("by_lineItemId", (q) => q.eq("lineItemId", children[0].id)).collect())
          .filter((u) => u.status === "CHECKED_OUT"),
      );
      expect(outUnits).toHaveLength(1);
    });
  });
});

// ─── logAccessoryCheckoutOverride (issue #794 follow-up) ────────────────────────
describe("logAccessoryCheckoutOverride", () => {
  async function seed(t: T) {
    await member(t, "member");
    await seedProject(t);
    await t.run(async (ctx) => {
      await ctx.db.insert("projectLineItems", baseLine("li1", { description: "Camera A", status: "CONFIRMED" }));
      await ctx.db.insert("projectLineItems", baseLine("acc1", {
        description: "Battery pack", isKitChild: true, childKind: "ACCESSORY", parentLineItemId: "li1",
        accessoryInclusion: "DEFAULT", status: "CONFIRMED",
      }));
    });
  }

  test("writes an activity log entry AND appends to the accessory line's notes", async () => {
    const t = makeT();
    await seed(t);
    await t.withIdentity(asUser(ORG)).mutation(api.warehouseWrites.logAccessoryCheckoutOverride, {
      orgId: ORG, projectId: "p1", parentName: "Camera A",
      skipped: [{ accessoryLineItemId: "acc1", tier: "DEFAULT", reason: "Left at the depot" }],
      actor: SPOOF, now: NOW,
    });
    const line = await lineById(t, "acc1");
    expect(line?.notes).toContain("Left at the depot");
    const logs = await t.run(async (ctx) =>
      (await ctx.db.query("activityLogs").withIndex("by_organizationId", (q) => q.eq("organizationId", ORG)).collect())
        .filter((l) => l.entityId === "acc1"),
    );
    expect(logs).toHaveLength(1);
    expect(logs[0].summary).toContain("Left at the depot");
    expect(logs[0].summary).toContain("default");
    expect(logs[0].userId).toBe(USER); // spoofed actor overridden
  });

  test("appends to existing notes rather than overwriting them", async () => {
    const t = makeT();
    await member(t, "member");
    await seedProject(t);
    await t.run(async (ctx) => {
      await ctx.db.insert("projectLineItems", baseLine("acc1", {
        description: "Mic clip", isKitChild: true, childKind: "ACCESSORY", accessoryInclusion: "OPTIONAL",
        status: "CONFIRMED", notes: "Existing note",
      }));
    });
    await t.withIdentity(asUser(ORG)).mutation(api.warehouseWrites.logAccessoryCheckoutOverride, {
      orgId: ORG, projectId: "p1", parentName: "Camera A",
      skipped: [{ accessoryLineItemId: "acc1", tier: "OPTIONAL", reason: "Out of stock" }],
      actor: SPOOF, now: NOW,
    });
    const line = await lineById(t, "acc1");
    expect(line?.notes).toBe("Existing note; Deployed without this accessory: Out of stock");
  });

  test("empty reason rejected", async () => {
    const t = makeT();
    await seed(t);
    await expect(
      t.withIdentity(asUser(ORG)).mutation(api.warehouseWrites.logAccessoryCheckoutOverride, {
        orgId: ORG, projectId: "p1", parentName: "Camera A",
        skipped: [{ accessoryLineItemId: "acc1", tier: "DEFAULT", reason: "" }],
        actor: SPOOF, now: NOW,
      }),
    ).rejects.toThrow(/reason/i);
  });

  test("cross-org accessory line silently skipped, not thrown", async () => {
    const t = makeT();
    await seed(t);
    await member(t, "member", OTHER);
    await t.run(async (ctx) => {
      await ctx.db.insert("projectLineItems", baseLine("accX", {
        description: "Foreign accessory", isKitChild: true, childKind: "ACCESSORY", accessoryInclusion: "DEFAULT", status: "CONFIRMED",
      }, OTHER));
    });
    await t.withIdentity(asUser(ORG)).mutation(api.warehouseWrites.logAccessoryCheckoutOverride, {
      orgId: ORG, projectId: "p1", parentName: "Camera A",
      skipped: [{ accessoryLineItemId: "accX", tier: "DEFAULT", reason: "Left behind" }],
      actor: SPOOF, now: NOW,
    });
    const foreignLine = await lineById(t, "accX");
    expect(foreignLine?.notes).toBeUndefined();
  });

  test("viewer denied", async () => {
    const t = makeT();
    await member(t, "viewer");
    await seedProject(t);
    await expect(
      t.withIdentity(asUser(ORG)).mutation(api.warehouseWrites.logAccessoryCheckoutOverride, {
        orgId: ORG, projectId: "p1", parentName: "Camera A",
        skipped: [{ accessoryLineItemId: "acc1", tier: "DEFAULT", reason: "x" }],
        actor: SPOOF, now: NOW,
      }),
    ).rejects.toThrow(/insufficient permissions/i);
  });
});

// ─── checkOutKit ────────────────────────────────────────────────────────────────
describe("checkOutKit", () => {
  test("blocking comment present → ConvexError (gate runs before the core)", async () => {
    const t = makeT();
    await member(t, "member");
    await seedProject(t);
    await seedBlockingComment(t);
    await expect(
      t.withIdentity(asUser(ORG)).mutation(api.warehouseWrites.checkOutKit, {
        orgId: ORG, projectId: "p1", kitId: "k1", auditId: "log1", now: NOW, actor: SPOOF,
      }),
    ).rejects.toThrow(/unresolved blocking comment/i);
  });

  test("viewer denied", async () => {
    const t = makeT();
    await member(t, "viewer");
    await seedProject(t);
    await expect(
      t.withIdentity(asUser(ORG)).mutation(api.warehouseWrites.checkOutKit, {
        orgId: ORG, projectId: "p1", kitId: "k1", auditId: "log1", now: NOW, actor: SPOOF,
      }),
    ).rejects.toThrow(/insufficient permissions/i);
  });
});

// ─── checkOutKitsBatch ──────────────────────────────────────────────────────────
describe("checkOutKitsBatch", () => {
  // Build a real deployable kit (k1) via the createKitLineItem path so preflight
  // (composition parity + T&T) passes — mirrors the kitPerUnit fixture.
  async function seedDeployableKit(t: T) {
    await member(t, "member");
    await seedProject(t);
    await t.run(async (ctx) => {
      await ctx.db.insert("kits", { id: "k1", organizationId: ORG, assetTag: "KIT-1", name: "Lighting", status: "AVAILABLE", condition: "GOOD", isActive: true, createdAt: NOW, updatedAt: NOW });
      await ctx.db.insert("models", { id: "m1", organizationId: ORG, name: "PAR", createdAt: NOW, updatedAt: NOW });
      await ctx.db.insert("assets", { id: "a1", organizationId: ORG, modelId: "m1", assetTag: "A-1", status: "AVAILABLE", condition: "GOOD", isActive: true, createdAt: NOW, updatedAt: NOW });
      await ctx.db.insert("kitSerializedItems", { id: "ks1", organizationId: ORG, kitId: "k1", assetId: "a1", addedById: USER });
    });
    await t.withIdentity(SERVICE).mutation(api.projectLineItems.createKitLineItem, { id: "kl1", organizationId: ORG, projectId: "p1", kitId: "k1", pricingMode: "KIT_PRICE", now: NOW });
  }

  test("blocking comment gates the whole batch (checked once) → ConvexError", async () => {
    const t = makeT();
    await seedDeployableKit(t);
    await seedBlockingComment(t);
    await expect(
      t.withIdentity(asUser(ORG)).mutation(api.warehouseWrites.checkOutKitsBatch, {
        orgId: ORG, projectId: "p1", kitIds: ["k1"], auditIds: ["log1"], now: NOW, actor: SPOOF,
      }),
    ).rejects.toThrow(/unresolved blocking comment/i);
    expect((await kitById(t, "k1"))?.status).toBe("AVAILABLE");
  });

  test("partial-success: deploys k1, reports a ghost kit as a per-item error; audit per succeeded", async () => {
    const t = makeT();
    await seedDeployableKit(t);
    const res = await t.withIdentity(asUser(ORG)).mutation(api.warehouseWrites.checkOutKitsBatch, {
      orgId: ORG, projectId: "p1", kitIds: ["k1", "ghost"], auditIds: ["log1", "log2"], now: NOW, actor: SPOOF,
    });
    expect(res.succeeded).toEqual(["k1"]);
    expect(res.errors.map((e) => e.kitId)).toEqual(["ghost"]);
    expect((await kitById(t, "k1"))?.status).toBe("CHECKED_OUT");
    // One audit row (for the one succeeded kit), token-attributed.
    const log = await logById(t, "log1");
    expect(log?.action).toBe("CHECK_OUT");
    expect(log?.entityId).toBe("k1");
    expect(log?.userId).toBe(USER);
    expect(await logById(t, "log2")).toBeNull();
  });

  test("empty selection → no-op, no gate read", async () => {
    const t = makeT();
    await member(t, "member");
    await seedProject(t);
    const res = await t.withIdentity(asUser(ORG)).mutation(api.warehouseWrites.checkOutKitsBatch, {
      orgId: ORG, projectId: "p1", kitIds: [], auditIds: [], now: NOW, actor: SPOOF,
    });
    expect(res).toEqual({ succeeded: [], errors: [] });
  });

  test("viewer denied", async () => {
    const t = makeT();
    await member(t, "viewer");
    await seedProject(t);
    await expect(
      t.withIdentity(asUser(ORG)).mutation(api.warehouseWrites.checkOutKitsBatch, {
        orgId: ORG, projectId: "p1", kitIds: ["k1"], auditIds: ["log1"], now: NOW, actor: SPOOF,
      }),
    ).rejects.toThrow(/insufficient permissions/i);
  });
});

// ─── quickAddAndCheckOut ────────────────────────────────────────────────────────
describe("quickAddAndCheckOut", () => {
  async function seed(t: T, modelOrg = ORG, assetOrg = ORG) {
    await member(t, "member");
    await seedProject(t);
    await t.run(async (ctx) => {
      await ctx.db.insert("models", { id: "m1", organizationId: modelOrg, name: "PAR", createdAt: NOW, updatedAt: NOW });
      await ctx.db.insert("assets", { id: "a1", organizationId: assetOrg, modelId: "m1", assetTag: "A-1", status: "AVAILABLE", condition: "GOOD", isActive: true, createdAt: NOW, updatedAt: NOW });
    });
  }

  test("creates a prepped EQUIPMENT line + writes a scan log + NO audit", async () => {
    const t = makeT();
    await seed(t);
    const res = await t.withIdentity(asUser(ORG)).mutation(api.warehouseWrites.quickAddAndCheckOut, {
      orgId: ORG, projectId: "p1", modelId: "m1", assetId: "a1", prepContainer: "C1", now: NOW, actor: SPOOF,
    });
    const line = await lineById(t, res.id);
    expect(line?.modelId).toBe("m1");
    expect(line?.assetId).toBe("a1");
    expect(line?.status).toBe("CONFIRMED");
    expect(line?.prepStatus).toBe("PENDING");
    expect(line?.prepContainer).toBe("C1");
    // scanLog written (scannedBy = token subject), by the core.
    const scans = await scanLogsForProject(t);
    expect(scans).toHaveLength(1);
    expect(scans[0].assetId).toBe("a1");
    expect(scans[0].scannedById).toBe(USER);
    // NO activity log for quick-add (scanLog only) — matches the server.
    expect(await logsForOrg(t)).toHaveLength(0);
  });

  test("★ FK hardening: cross-org modelId rejected", async () => {
    const t = makeT();
    await seed(t, OTHER, ORG); // model in another org
    await expect(
      t.withIdentity(asUser(ORG)).mutation(api.warehouseWrites.quickAddAndCheckOut, {
        orgId: ORG, projectId: "p1", modelId: "m1", now: NOW, actor: SPOOF,
      }),
    ).rejects.toThrow(/Model not found/i);
  });

  test("★ FK hardening: cross-org assetId rejected", async () => {
    const t = makeT();
    await seed(t, ORG, OTHER); // asset in another org
    await expect(
      t.withIdentity(asUser(ORG)).mutation(api.warehouseWrites.quickAddAndCheckOut, {
        orgId: ORG, projectId: "p1", modelId: "m1", assetId: "a1", now: NOW, actor: SPOOF,
      }),
    ).rejects.toThrow(/Asset not found/i);
  });

  test("viewer denied", async () => {
    const t = makeT();
    await member(t, "viewer");
    await seedProject(t);
    await expect(
      t.withIdentity(asUser(ORG)).mutation(api.warehouseWrites.quickAddAndCheckOut, {
        orgId: ORG, projectId: "p1", modelId: "m1", now: NOW, actor: SPOOF,
      }),
    ).rejects.toThrow(/insufficient permissions/i);
  });
});

// ─── blocking-gate parity: convex-local evaluateBlockingGate == src/lib original ──
describe("evaluateBlockingGate — convex-local == src/lib (behaviour pin)", () => {
  const summaries = [
    { count: 0, lineItemTargetIds: [], groupTargetIds: [], hasProjectLevel: false },
    { count: 2, lineItemTargetIds: [], groupTargetIds: [], hasProjectLevel: false },
    { count: 1, lineItemTargetIds: ["li1"], groupTargetIds: [], hasProjectLevel: false },
    { count: 1, lineItemTargetIds: [], groupTargetIds: ["g1"], hasProjectLevel: false },
    { count: 1, lineItemTargetIds: [], groupTargetIds: [], hasProjectLevel: true },
    { count: 3, lineItemTargetIds: ["li9"], groupTargetIds: ["g9"], hasProjectLevel: true },
  ];
  const optsList = [
    {},
    { actionLabel: "check out items" },
    { lineItemId: "li1", actionLabel: "prep this item" },
    { groupId: "g1", actionLabel: "prep this item" },
    { lineItemId: "zzz", groupId: "zzz", actionLabel: "prep this item" },
  ];
  test("identical result for every (summary × opts) combination", () => {
    for (const s of summaries) {
      for (const o of optsList) {
        expect(convexGate(s, o)).toEqual(srcGate(s, o));
      }
    }
  });
});
