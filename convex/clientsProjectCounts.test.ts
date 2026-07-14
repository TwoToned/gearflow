// @vitest-environment node
//
// clients.projectCounts — browser-native replacement for getClientProjectCounts.
// Verifies: tallies every org project with a clientId (templates included, for
// parity with the old projects.list-based count), org isolation (another org's
// projects don't leak into the map), and RBAC (non-member rejected).
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
    const proj = (id: string, org: string, clientId: string | undefined, isTemplate = false) =>
      ctx.db.insert("projects", { id, organizationId: org, projectNumber: id, name: id, clientId, isTemplate });
    await proj("p1", ORG, "c1");
    await proj("p2", ORG, "c1");
    await proj("p3", ORG, "c2");
    await proj("pt", ORG, "c1", true); // template WITH a clientId → counted (parity)
    await proj("pn", ORG, undefined); // no clientId → ignored
    await proj("px", OTHER, "c1"); // other org → must not leak
  });

describe("clients.projectCounts", () => {
  test("counts org projects per clientId (templates included), no cross-org leak", async () => {
    const t = makeT();
    await seed(t);
    const counts = await t.withIdentity(asUser).query(api.clients.projectCounts, { orgId: ORG });
    expect(counts).toEqual({ c1: 3, c2: 1 }); // c1: p1,p2,pt (px is other-org); c2: p3
  });

  test("rejects a non-member", async () => {
    const t = makeT();
    await seed(t);
    await expect(
      t.withIdentity({ subject: USER, orgId: "nope" }).query(api.clients.projectCounts, { orgId: ORG }),
    ).rejects.toThrow();
  });
});
