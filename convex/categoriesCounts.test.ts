// @vitest-environment node
//
// categories.counts — browser-native replacement for getCategoryCounts. Verifies:
// tallies models + kits per categoryId (parity with buildModelKitCounts — every
// model/kit with a categoryId, no filter), org isolation, and RBAC.
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
    const model = (id: string, org: string, categoryId?: string) =>
      ctx.db.insert("models", { id, organizationId: org, name: id, categoryId });
    const kit = (id: string, org: string, categoryId?: string) =>
      ctx.db.insert("kits", { id, organizationId: org, assetTag: id, name: id, categoryId });
    // cat1: 2 models + 1 kit; cat2: 1 model; no-category model ignored; other-org excluded.
    await model("m1", ORG, "cat1");
    await model("m2", ORG, "cat1");
    await model("m3", ORG, "cat2");
    await model("m4", ORG, undefined);
    await model("mx", OTHER, "cat1"); // other org
    await kit("k1", ORG, "cat1");
    await kit("k2", ORG, undefined); // no category
    await kit("kx", OTHER, "cat1"); // other org
  });

describe("categories.counts", () => {
  test("tallies models + kits per categoryId, no cross-org leak", async () => {
    const t = makeT();
    await seed(t);
    const counts = await t.withIdentity(asUser).query(api.categories.counts, { orgId: ORG });
    expect(counts).toEqual({
      cat1: { models: 2, kits: 1 }, // m1,m2 + k1 (mx/kx other-org excluded)
      cat2: { models: 1, kits: 0 },
    });
  });

  test("rejects a non-member", async () => {
    const t = makeT();
    await seed(t);
    await expect(
      t.withIdentity({ subject: USER, orgId: "nope" }).query(api.categories.counts, { orgId: ORG }),
    ).rejects.toThrow();
  });
});
