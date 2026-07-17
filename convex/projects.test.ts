// @vitest-environment node
//
// convex/projects.ts `listPage` — the project table's server-side replacement
// for the 3 whole-org client subscriptions (useProjects/useClients/
// useLocations) it used to filter/join/sort in the browser (Finding #1,
// docs/designs/perf-convex-efficiency-2026-06.md).
import { convexTest, type TestConvex } from "convex-test";
import { register as registerRateLimiter } from "@convex-dev/rate-limiter/test";
import { describe, test, expect } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";

const modules = import.meta.glob("./**/*.ts");
type T = TestConvex<typeof schema>;

const ORG = "org_1";
const USER = "user_1";
const asUser = { subject: USER, orgId: ORG };

function makeT(): T {
  const t = convexTest(schema, modules);
  registerRateLimiter(t, "rateLimiter");
  return t;
}

async function seed(t: T) {
  await t.run(async (ctx) => {
    await ctx.db.insert("members", { id: "m1", organizationId: ORG, userId: USER, role: "owner" });
    await ctx.db.insert("clients", { id: "c1", organizationId: ORG, name: "Acme Corp" });
    await ctx.db.insert("locations", { id: "loc1", organizationId: ORG, name: "Warehouse North" });
    await ctx.db.insert("projects", {
      id: "P1", organizationId: ORG, projectNumber: "P-001", name: "Splendour Main Stage",
      clientId: "c1", status: "CONFIRMED", type: "FESTIVAL", isTemplate: false,
    });
    await ctx.db.insert("projects", {
      id: "P2", organizationId: ORG, projectNumber: "P-002", name: "Corporate Gala",
      status: "ENQUIRY", type: "CORPORATE", isTemplate: false, locationId: "loc1",
    });
    await ctx.db.insert("projects", {
      id: "P3", organizationId: ORG, projectNumber: "P-003", name: "Template job",
      status: "CONFIRMED", isTemplate: true,
    });
  });
}

describe("projects.listPage", () => {
  test("excludes templates", async () => {
    const t = makeT();
    await seed(t);
    const result = await t.withIdentity(asUser).query(api.projects.listPage, { orgId: ORG });
    expect(result.items.map((p) => p.id).sort()).toEqual(["P1", "P2"]);
    expect(result.total).toBe(2);
  });

  test("resolves client name server-side", async () => {
    const t = makeT();
    await seed(t);
    const result = await t.withIdentity(asUser).query(api.projects.listPage, { orgId: ORG });
    const p1 = result.items.find((p) => p.id === "P1")!;
    expect(p1.client?.name).toBe("Acme Corp");
    const p2 = result.items.find((p) => p.id === "P2")!;
    expect(p2.client).toBeNull();
  });

  test("statusIn and typeIn filter as multi-select", async () => {
    const t = makeT();
    await seed(t);
    const byStatus = await t.withIdentity(asUser).query(api.projects.listPage, { orgId: ORG, statusIn: ["ENQUIRY"] });
    expect(byStatus.items.map((p) => p.id)).toEqual(["P2"]);

    const byType = await t.withIdentity(asUser).query(api.projects.listPage, { orgId: ORG, typeIn: ["FESTIVAL", "CORPORATE"] });
    expect(byType.items.map((p) => p.id).sort()).toEqual(["P1", "P2"]);
  });

  test("search matches name, projectNumber, and location name (not a visible column)", async () => {
    const t = makeT();
    await seed(t);
    const byName = await t.withIdentity(asUser).query(api.projects.listPage, { orgId: ORG, search: "splendour" });
    expect(byName.items.map((p) => p.id)).toEqual(["P1"]);

    const byNumber = await t.withIdentity(asUser).query(api.projects.listPage, { orgId: ORG, search: "P-002" });
    expect(byNumber.items.map((p) => p.id)).toEqual(["P2"]);

    const byLocation = await t.withIdentity(asUser).query(api.projects.listPage, { orgId: ORG, search: "warehouse north" });
    expect(byLocation.items.map((p) => p.id)).toEqual(["P2"]);
  });

  test("sorts by the joined client name", async () => {
    const t = makeT();
    await seed(t);
    const asc = await t.withIdentity(asUser).query(api.projects.listPage, { orgId: ORG, sortBy: "client", sortOrder: "asc" });
    // P1 has a client ("Acme Corp"), P2 has none (null sorts last ascending).
    expect(asc.items.map((p) => p.id)).toEqual(["P1", "P2"]);
  });

  test("cross-org isolation", async () => {
    const t = makeT();
    await seed(t);
    await t.run(async (ctx) => {
      await ctx.db.insert("members", { id: "m2", organizationId: "org_2", userId: "user_2", role: "owner" });
    });
    const result = await t.withIdentity({ subject: "user_2", orgId: "org_2" }).query(api.projects.listPage, { orgId: "org_2" });
    expect(result.items).toEqual([]);
    expect(result.total).toBe(0);
  });

  test("paginates", async () => {
    const t = makeT();
    await seed(t);
    const p1 = await t.withIdentity(asUser).query(api.projects.listPage, { orgId: ORG, pageSize: 1, page: 1, sortBy: "projectNumber" });
    expect(p1.items.map((p) => p.id)).toEqual(["P1"]);
    expect(p1.totalPages).toBe(2);
    const p2 = await t.withIdentity(asUser).query(api.projects.listPage, { orgId: ORG, pageSize: 1, page: 2, sortBy: "projectNumber" });
    expect(p2.items.map((p) => p.id)).toEqual(["P2"]);
  });
});
