// @vitest-environment node
//
// Relocated accessories (#1296): an accessory unit packed in a DIFFERENT
// container than its parent ships with that container. The parent's
// deploy / return / de-prep cascades must leave it alone, and
// `stageAccessoryUnits` actions it from its own row.
import { convexTest, type TestConvex } from "convex-test";
import { register as registerRateLimiter } from "@convex-dev/rate-limiter/test";
import { register as registerShardedCounter } from "@convex-dev/sharded-counter/test";
import { describe, test, expect } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";
import { isRelocatedAccessoryUnit, parentContainerResolver } from "./lib/accessoryRelocation";

const modules = import.meta.glob("./**/*.ts");
type T = TestConvex<typeof schema>;
const ORG = "org_1";
const USER = "user_1";
const NOW = 1_700_000_000_000;
const SERVICE = { subject: "gearflow-service", svc: true };
const ACTOR = { userId: USER, userName: "Alice" };
const V1 = "v-p1";

function makeT(): T {
  const t = convexTest(schema, modules);
  registerRateLimiter(t, "rateLimiter");
  registerShardedCounter(t, "shardedCounter");
  return t;
}

/** Two handhelds (a1, a2), each with a serialised accessory antenna (c1, c2),
 *  plus two cases: PELICAN (parent) and BATT (where antennas get moved). */
async function seed(t: T) {
  await t.run(async (ctx) => {
    await ctx.db.insert("members", { id: "mem1", organizationId: ORG, userId: USER, role: "owner" });
    await ctx.db.insert("projects", { id: "p1", organizationId: ORG, projectNumber: "P-1", name: "Test", liveVersionId: V1, createdAt: NOW, updatedAt: NOW });
    await ctx.db.insert("projectVersions", { id: V1, organizationId: ORG, projectId: "p1", number: 1, contentState: "ready", createdAt: NOW, createdById: USER });
    await ctx.db.insert("models", { id: "m1", organizationId: ORG, name: "Handheld", createdAt: NOW, updatedAt: NOW });
    await ctx.db.insert("models", { id: "m2", organizationId: ORG, name: "Antenna", createdAt: NOW, updatedAt: NOW });
    for (const [id, tag, parent, model] of [["a1", "HH1", undefined, "m1"], ["a2", "HH2", undefined, "m1"], ["c1", "AN1", "a1", "m2"], ["c2", "AN2", "a2", "m2"]] as const) {
      await ctx.db.insert("assets", { id, organizationId: ORG, modelId: model, assetTag: tag, status: "AVAILABLE", isActive: true, parentAssetId: parent, createdAt: NOW, updatedAt: NOW });
    }
    await ctx.db.insert("projectLineItems", {
      id: "L1", organizationId: ORG, projectId: "p1", versionId: V1, lineageId: "L1", type: "EQUIPMENT", modelId: "m1",
      quantity: 2, sortOrder: 0, status: "CONFIRMED", createdAt: NOW, updatedAt: NOW,
    });
    for (const [cid, label] of [["PELICAN", "Pelican"], ["BATT", "Battery Box"]] as const) {
      await ctx.db.insert("projectLineItems", {
        id: `${cid}-li`, organizationId: ORG, projectId: "p1", versionId: V1, lineageId: `${cid}-li`, type: "EQUIPMENT",
        isCustomItem: true, description: label, quantity: 1, sortOrder: 1, status: "CONFIRMED", checkedOutQuantity: 0,
        prepStatus: "PACKED", containerId: cid, isContainerLineItem: true, createdAt: NOW, updatedAt: NOW,
      });
      await ctx.db.insert("projectContainers", {
        id: cid, organizationId: ORG, projectId: "p1", versionId: V1, lineageId: cid, kind: "CUSTOM", label,
        lineItemId: `${cid}-li`, sortOrder: 0, createdAt: NOW, updatedAt: NOW,
      });
    }
  });
}

const svc = (t: T) => t.withIdentity(SERVICE);
const user = (t: T) => t.withIdentity({ subject: USER, orgId: ORG });

/** Prep both handhelds into PELICAN (accessories follow, expanded per parent). */
const prepBoth = (t: T) =>
  svc(t).mutation(api.checkRecordOps.prepItems, {
    organizationId: ORG, projectId: "p1", now: NOW, actor: ACTOR,
    items: [{ lineItemId: "L1", assetId: "a1", containerId: "PELICAN" }, { lineItemId: "L1", assetId: "a2", containerId: "PELICAN" }],
  });

const accUnit = (t: T, parent: string) =>
  t.run(async (ctx) => {
    const kids = await ctx.db.query("projectLineItems").withIndex("by_parentLineItemId", (q) => q.eq("parentLineItemId", "L1")).collect();
    for (const k of kids) {
      const us = await ctx.db.query("projectLineItemUnits").withIndex("by_lineItemId", (q) => q.eq("lineItemId", k.id)).collect();
      const u = us.find((x) => x.parentUnitAssetId === parent);
      if (u) return u;
    }
    return null;
  });
const asset = (t: T, id: string) => t.run(async (ctx) => (await ctx.db.query("assets").withIndex("by_cuid", (q) => q.eq("id", id)).unique())?.status);
const deployL1 = (t: T) =>
  svc(t).mutation(api.warehouseOps.checkoutItems, {
    organizationId: ORG, projectId: "p1", userId: USER, now: NOW, includeAccessories: true,
    items: [{ lineItemId: "L1", assetId: "a1" }, { lineItemId: "L1", assetId: "a2" }],
  });

/** Move antenna c1's unit (travelling with a1) into the Battery Box. */
async function relocateAntenna1(t: T) {
  const u = await accUnit(t, "a1");
  expect(u).not.toBeNull();
  await user(t).mutation(api.projectContainersWrites.moveUnitsNative, {
    orgId: ORG, unitIds: [u!.id], toContainerId: "BATT", now: NOW, actor: ACTOR, auditId: "audit-move",
  });
  return u!.id;
}

describe("the relocation rule (pure)", () => {
  test("a tagged parent unit is matched by its asset, an untagged one by the line's container", () => {
    const of = parentContainerResolver([{ assetId: "a1", containerId: "X" }, { assetId: "a2", containerId: "Y" }]);
    expect(of({ parentUnitAssetId: "a1" })).toBe("X");
    expect(of({ parentUnitAssetId: "a2" })).toBe("Y");
    expect(parentContainerResolver([{ containerId: "Z" }])({ parentUnitAssetId: null })).toBe("Z");
  });

  test("relocated only when packed somewhere that is not the parent's container", () => {
    expect(isRelocatedAccessoryUnit({ containerId: "B" }, "A")).toBe(true);
    expect(isRelocatedAccessoryUnit({ containerId: "A" }, "A")).toBe(false);
    expect(isRelocatedAccessoryUnit({ containerId: null }, "A")).toBe(false); // loose ⇒ goes with parent
    expect(isRelocatedAccessoryUnit({ containerId: "B" }, null)).toBe(true); // parent loose, accessory boxed
  });
});

describe("parent cascades leave a relocated accessory alone", () => {
  test("deploying the parents deploys the co-located accessory but NOT the one in the Battery Box", async () => {
    const t = makeT();
    await seed(t);
    await prepBoth(t);
    await relocateAntenna1(t);
    await deployL1(t);

    expect(await asset(t, "a1")).toBe("CHECKED_OUT");
    expect(await asset(t, "c2")).toBe("CHECKED_OUT"); // still with its parent's Pelican
    expect(await asset(t, "c1")).toBe("AVAILABLE"); // waits for the Battery Box
    expect((await accUnit(t, "a1"))?.status).not.toBe("CHECKED_OUT");
    expect((await accUnit(t, "a2"))?.status).toBe("CHECKED_OUT");
  });

  test("returning the parents does not sweep a relocated accessory back", async () => {
    const t = makeT();
    await seed(t);
    await prepBoth(t);
    await relocateAntenna1(t);
    await deployL1(t);
    // Deploy the relocated unit on its own so there is something out to (not) return.
    const u = await accUnit(t, "a1");
    await user(t).mutation(api.warehouseWrites.stageAccessoryUnits, {
      orgId: ORG, projectId: "p1", unitIds: [u!.id], to: "DEPLOY", auditId: "audit-d", now: NOW, actor: ACTOR,
    });
    expect(await asset(t, "c1")).toBe("CHECKED_OUT");

    await svc(t).mutation(api.warehouseOps.checkinItems, {
      organizationId: ORG, projectId: "p1", userId: USER, now: NOW,
      items: [{ lineItemId: "L1", returnCondition: "GOOD" }],
    });
    expect(await asset(t, "a1")).toBe("AVAILABLE");
    expect(await asset(t, "c2")).toBe("AVAILABLE"); // came home with its parent
    expect(await asset(t, "c1")).toBe("CHECKED_OUT"); // still out in the Battery Box
    expect((await accUnit(t, "a1"))?.status).toBe("CHECKED_OUT");
  });
});

describe("stageAccessoryUnits", () => {
  test("deploy → return → de-prep a relocated accessory from its own row", async () => {
    const t = makeT();
    await seed(t);
    await prepBoth(t);
    const unitId = await relocateAntenna1(t);
    const stage = (to: "DEPLOY" | "RETURN" | "DEPREP", n: number) =>
      user(t).mutation(api.warehouseWrites.stageAccessoryUnits, {
        orgId: ORG, projectId: "p1", unitIds: [unitId], to, auditId: `audit-${n}`, now: NOW, actor: ACTOR,
      });

    await stage("DEPLOY", 1);
    expect((await accUnit(t, "a1"))?.status).toBe("CHECKED_OUT");
    expect(await asset(t, "c1")).toBe("CHECKED_OUT");
    expect(await asset(t, "a1")).toBe("AVAILABLE"); // the parent did not move

    await stage("RETURN", 2);
    expect((await accUnit(t, "a1"))?.status).toBe("RETURNED");
    expect(await asset(t, "c1")).toBe("AVAILABLE");

    await stage("DEPREP", 3);
    expect((await accUnit(t, "a1"))?.prepStatus).toBe("PENDING");
  });

  test("the container's own line flips with its contents (Battery Box goes out once its unit does)", async () => {
    const t = makeT();
    await seed(t);
    await prepBoth(t);
    const unitId = await relocateAntenna1(t);
    await user(t).mutation(api.warehouseWrites.stageAccessoryUnits, {
      orgId: ORG, projectId: "p1", unitIds: [unitId], to: "DEPLOY", auditId: "audit-1", now: NOW, actor: ACTOR,
    });
    const boxLine = await t.run(async (ctx) => ctx.db.query("projectLineItems").withIndex("by_cuid", (q) => q.eq("id", "BATT-li")).unique());
    expect(boxLine?.status).toBe("CHECKED_OUT");
  });

  test("rejects a unit that isn't an accessory, isn't packed, or is in another org — and writes nothing", async () => {
    const t = makeT();
    await seed(t);
    await prepBoth(t);
    const parentUnit = await t.run(async (ctx) =>
      (await ctx.db.query("projectLineItemUnits").withIndex("by_lineItemId", (q) => q.eq("lineItemId", "L1")).collect())[0]);
    const call = (unitIds: string[], to: "DEPLOY" | "RETURN" = "DEPLOY") =>
      user(t).mutation(api.warehouseWrites.stageAccessoryUnits, {
        orgId: ORG, projectId: "p1", unitIds, to, auditId: "audit-x", now: NOW, actor: ACTOR,
      });

    await expect(call([parentUnit.id])).rejects.toThrow(/not found on this project/); // parent line, not an accessory
    await expect(call(["nope"])).rejects.toThrow(/not found/);
    const u = await accUnit(t, "a1");
    await expect(call([u!.id], "RETURN")).rejects.toThrow(/not deployed/); // nothing out to return
    expect((await accUnit(t, "a1"))?.status).not.toBe("RETURNED");
  });
});
