// @vitest-environment node
//
// UX Phase 12: `Show cost & payback` is a UI default; the SERVER decides who may see
// cost. A `noFinancials` API key gets `fleetCost` / `replacementCost` ABSENT (never
// zeroed) from the model and fleet ROI reads. A sentinel sweep: unique values in every
// cost field, read as each caller, grep the JSON.
import { convexTest, type TestConvex } from "convex-test";
import { describe, test, expect } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";

const modules = import.meta.glob("./**/*.ts");
type T = TestConvex<typeof schema>;
const ORG = "org_1", USER = "user_1", KEY = "key_1";
const REPLACEMENT = 98765.43; // sentinel
const PURCHASE = 12345.67; // sentinel
const asUser = { subject: USER, orgId: ORG };
const asAgent = { subject: USER, orgId: ORG, akid: KEY };

async function seed(noFinancials: boolean): Promise<T> {
  const t = convexTest(schema, modules);
  await t.run(async (ctx) => {
    await ctx.db.insert("members", { id: "m1", organizationId: ORG, userId: USER, role: "owner" });
    await ctx.db.insert("models", { id: "m1", organizationId: ORG, name: "Aura", replacementCost: REPLACEMENT, isActive: true, assetType: "SERIALIZED" } as never);
    await ctx.db.insert("assets", { id: "a1", organizationId: ORG, modelId: "m1", assetTag: "A-1", status: "AVAILABLE", isActive: true, purchasePrice: PURCHASE } as never);
    await ctx.db.insert("apiKeys", {
      id: KEY, organizationId: ORG, name: "k", prefix: "gf_live_aaaaaa", tokenHash: "h",
      scopes: JSON.stringify(["*"]), isActive: true, actingUserId: USER, createdById: USER, noFinancials,
    });
  });
  return t;
}

const modelRoi = (t: T, who: typeof asUser | typeof asAgent) =>
  t.withIdentity(who).query(api.roi.getModelRoi, { orgId: ORG, modelId: "m1", statuses: ["COMPLETED"] });
const inventory = (t: T, who: typeof asUser | typeof asAgent) => t.withIdentity(who).query(api.roi.fleetInventory, { orgId: ORG });

describe("asset detail bundle cost fields", () => {
  const bundle = (t: T, who: typeof asUser | typeof asAgent) => t.withIdentity(who).query(api.assetDetail.bundle, { assetId: "a1", orgId: ORG });

  test("a member sees purchase price and replacement cost; a noFinancials key sees neither anywhere", async () => {
    const t = await seed(true);
    const mine = await bundle(t, asUser);
    expect(mine?.asset.purchasePrice).toBe(PURCHASE);
    expect(mine?.model?.replacementCost).toBe(REPLACEMENT);

    const theirs = await bundle(t, asAgent);
    const json = JSON.stringify(theirs);
    expect(json).not.toContain(String(PURCHASE));
    expect(json).not.toContain(String(REPLACEMENT));
    expect(theirs?.asset.assetTag).toBe("A-1");
    expect("purchasePrice" in theirs!.asset).toBe(false);
  });

  test("an agent key without noFinancials still sees cost", async () => {
    const t = await seed(false);
    expect((await bundle(t, asAgent))?.asset.purchasePrice).toBe(PURCHASE);
  });
});

describe("ROI cost fields", () => {
  test("a member sees fleet cost and replacement cost", async () => {
    const t = await seed(true);
    expect(await modelRoi(t, asUser)).toMatchObject({ fleetCost: PURCHASE, replacementCost: REPLACEMENT });
    expect((await inventory(t, asUser)).rows[0]).toMatchObject({ fleetCost: PURCHASE });
  });

  test("an agent key WITHOUT noFinancials sees them", async () => {
    const t = await seed(false);
    expect(await modelRoi(t, asAgent)).toMatchObject({ fleetCost: PURCHASE });
  });

  test("a noFinancials key gets the fields ABSENT, and no sentinel anywhere in the payload", async () => {
    const t = await seed(true);
    const roi = await modelRoi(t, asAgent);
    const inv = await inventory(t, asAgent);
    for (const payload of [roi, inv]) {
      const json = JSON.stringify(payload);
      expect(json).not.toContain(String(REPLACEMENT));
      expect(json).not.toContain(String(PURCHASE));
    }
    expect("fleetCost" in roi).toBe(false);
    expect("replacementCost" in roi).toBe(false);
    expect("fleetCost" in inv.rows[0]).toBe(false);
    // the non-cost facts are intact
    expect(roi).toMatchObject({ modelName: "Aura", unitsOwned: 1 });
  });
});
