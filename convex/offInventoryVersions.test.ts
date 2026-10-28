// @vitest-environment node
//
// Off-inventory units across project versions (review finding #3). The counter
// describes REALITY (it moves with the generic unit rows at make-live, via
// carryRealityByLineage) — it must not be cloned as plan data, or a clone and
// its source drift apart.
import { convexTest } from "convex-test";
import { register as registerRateLimiter } from "@convex-dev/rate-limiter/test";
import { describe, test, expect } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";
import { convertUnitToOffInventoryCore, convertUnitBackToInventoryCore } from "./warehouseOps";

const modules = import.meta.glob("./**/*.ts");
const ORG = "org_1";
const USER = "user_1";
const NOW = 1_700_000_000_000;
const DAY = 86_400_000;
const actor = { userId: USER, userName: "Alice" };
const asUser = { subject: USER, orgId: ORG };

function makeT() {
  const t = convexTest(schema, modules);
  registerRateLimiter(t, "rateLimiter");
  return t;
}
type T = ReturnType<typeof makeT>;

async function seed(t: T) {
  await t.run(async (ctx) => {
    await ctx.db.insert("members", { id: "m1", organizationId: ORG, userId: USER, role: "owner" });
    await ctx.db.insert("models", { id: "mdl", organizationId: ORG, name: "4099", assetType: "SERIALIZED" });
    await ctx.db.insert("projects", {
      id: "p1", organizationId: ORG, projectNumber: "P1", name: "Gig", status: "CONFIRMED", isTemplate: false,
      liveVersionId: "v1", rentalStartDate: NOW, rentalEndDate: NOW + 5 * DAY, projectStartDate: NOW, projectEndDate: NOW + 5 * DAY,
      createdAt: NOW, updatedAt: NOW,
    });
    await ctx.db.insert("projectVersions", { id: "v1", organizationId: ORG, projectId: "p1", number: 1, contentState: "ready", createdAt: NOW, createdById: "u1" });
    await ctx.db.insert("projectLineItems", {
      id: "li1", organizationId: ORG, projectId: "p1", versionId: "v1", lineageId: "li1", status: "CONFIRMED", type: "EQUIPMENT",
      isKitChild: false, description: "4099", quantity: 3, unitPrice: 100, lineTotal: 300, modelId: "mdl",
    });
  });
}

const base = { organizationId: ORG, projectId: "p1", lineItemId: "li1", now: NOW };
const create = (t: T) =>
  t.withIdentity(asUser).mutation(api.versions.createNative, { organizationId: ORG, projectId: "p1", actor, auditId: "aCreate", now: NOW } as never);
const makeLive = (t: T, versionId: string) =>
  t.withIdentity(asUser).mutation(api.versions.makeLiveNative, { organizationId: ORG, projectId: "p1", versionId, actor, auditId: "aLive", now: NOW } as never);
const lines = (t: T, versionId: string) =>
  t.run((ctx) => ctx.db.query("projectLineItems").withIndex("by_versionId", (q) => q.eq("versionId", versionId)).collect());
const genericUnits = (t: T) =>
  t.run(async (ctx) => (await ctx.db.query("projectLineItemUnits").collect()).filter((u) => !u.assetId && !u.bulkAssetId));

describe("off-inventory units and project versions", () => {
  test("a cloned version does not inherit the source line's counter (it clones plan, not reality)", async () => {
    const t = makeT();
    await seed(t);
    await t.run((ctx) => convertUnitToOffInventoryCore(ctx, base));
    const v2 = await create(t);
    const [v2Line] = await lines(t, v2.id);
    expect(v2Line.offInventoryQuantity ?? 0).toBe(0);
  });

  test("converted AFTER the clone: the counter follows the unit to the new live version", async () => {
    const t = makeT();
    await seed(t);
    const v2 = await create(t);
    await t.run((ctx) => convertUnitToOffInventoryCore(ctx, base)); // on v1, after v2 was cloned
    await makeLive(t, v2.id);
    const [v2Line] = await lines(t, v2.id);
    expect(await genericUnits(t)).toHaveLength(1);
    expect(v2Line.offInventoryQuantity).toBe(1);
  });

  test("converted back AFTER the clone: no phantom counter on the new live version", async () => {
    const t = makeT();
    await seed(t);
    await t.run((ctx) => convertUnitToOffInventoryCore(ctx, base));
    const v2 = await create(t);
    await t.run((ctx) => convertUnitBackToInventoryCore(ctx, { organizationId: ORG, projectId: "p1", lineItemId: "li1", now: NOW }));
    await makeLive(t, v2.id);
    const [v2Line] = await lines(t, v2.id);
    expect(await genericUnits(t)).toHaveLength(0);
    expect(v2Line.offInventoryQuantity ?? 0).toBe(0);
  });
});
