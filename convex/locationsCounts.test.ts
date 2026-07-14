// @vitest-environment node
//
// locations.counts — browser-native replacement for getLocationCounts. Verifies:
// tallies assets + bulkAssets + kits per locationId (parity with the action — every
// row with a locationId, no filter), org isolation, and RBAC.
import { convexTest } from "convex-test";
import { describe, test, expect } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";

const modules = import.meta.glob("./**/*.ts");
const ORG = "org_1";
const OTHER = "org_2";
const USER = "user_1";
const asUser = { subject: USER, orgId: ORG };
const makeT = () => convexTest(schema, modules);

const seed = (t: ReturnType<typeof makeT>) =>
  t.run(async (ctx) => {
    await ctx.db.insert("members", { id: "m1", organizationId: ORG, userId: USER, role: "viewer" });
    const asset = (id: string, org: string, locationId?: string) =>
      ctx.db.insert("assets", { id, organizationId: org, modelId: "m1", assetTag: id, status: "AVAILABLE", isActive: true, locationId });
    const bulk = (id: string, org: string, locationId?: string) =>
      ctx.db.insert("bulkAssets", { id, organizationId: org, modelId: "m1", assetTag: id, totalQuantity: 1, isActive: true, locationId });
    const kit = (id: string, org: string, locationId?: string) =>
      ctx.db.insert("kits", { id, organizationId: org, assetTag: id, name: id, locationId });
    // loc1: 2 assets + 1 bulk + 1 kit; loc2: 1 asset; no-location + other-org excluded.
    await asset("a1", ORG, "loc1");
    await asset("a2", ORG, "loc1");
    await asset("a3", ORG, "loc2");
    await asset("a4", ORG, undefined);
    await asset("ax", OTHER, "loc1");
    await bulk("b1", ORG, "loc1");
    await bulk("bx", OTHER, "loc1");
    await kit("k1", ORG, "loc1");
    await kit("kx", OTHER, "loc1");
  });

describe("locations.counts", () => {
  test("tallies assets+bulkAssets+kits per location, no cross-org leak", async () => {
    const t = makeT();
    await seed(t);
    const counts = await t.withIdentity(asUser).query(api.locations.counts, { orgId: ORG });
    expect(counts).toEqual({
      loc1: { assets: 2, bulkAssets: 1, kits: 1 }, // a1,a2 / b1 / k1 (other-org excluded)
      loc2: { assets: 1, bulkAssets: 0, kits: 0 },
    });
  });

  test("rejects a non-member", async () => {
    const t = makeT();
    await seed(t);
    await expect(
      t.withIdentity({ subject: USER, orgId: "nope" }).query(api.locations.counts, { orgId: ORG }),
    ).rejects.toThrow();
  });
});
