// @vitest-environment node
//
// globalSearch.search's role filter, in place (UX Phase 11 review). Every
// built-in role reads all 14 result types, so a role fixture that lacks ONE
// resource (`client`) is added to the live role table for this file. Pinned:
// the server drops that type (remove `readable.has(type)` and this fails), and a
// readable record that sat under the dropped parent keeps its own row (the
// child dedupe counts only readable parents).
import { convexTest, type TestConvex } from "convex-test";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";
import { rolePermissions } from "./lib/permissionsCore";

const modules = import.meta.glob("./**/*.ts");
type T = TestConvex<typeof schema>;
const ORG = "org_1";
const USER = "user_1";
const NOW = 1_700_000_000_000;
const ROLE = "test-no-clients";

beforeAll(() => {
  rolePermissions[ROLE] = { ...rolePermissions.member, client: [] };
});
afterAll(() => {
  delete rolePermissions[ROLE];
});

async function makeT(role: string): Promise<T> {
  const t = convexTest(schema, modules);
  await t.run(async (ctx) => {
    await ctx.db.insert("members", { id: "m1", organizationId: ORG, userId: USER, role });
    await ctx.db.insert("clients", { id: "c1", organizationId: ORG, name: "Hilton Sydney", isActive: true });
    await ctx.db.insert("projects", {
      id: "p1", organizationId: ORG, projectNumber: "2341", name: "Hilton gala dinner", clientId: "c1",
      status: "CONFIRMED", isTemplate: false, createdAt: NOW, updatedAt: NOW,
    });
  });
  return t;
}

const search = (t: T) => t.withIdentity({ subject: USER, orgId: ORG }).query(api.globalSearch.search, { orgId: ORG, query: "hilton" });
const rows = (r: { results: { type: string; id: string; isChild?: boolean }[] }) =>
  r.results.map((x) => `${x.type}:${x.id}${x.isChild ? ":child" : ""}`);

describe("globalSearch.search — role filter in place", () => {
  test("a member sees the client with its job as a child", async () => {
    const t = await makeT("member");
    expect(rows(await search(t))).toEqual(["client:c1", "project:p1:child"]);
  });

  test("a role without client read gets no client row, and the job is NOT lost under it: it stands on its own", async () => {
    const t = await makeT(ROLE);
    const r = await search(t);
    expect(rows(r)).toEqual(["project:p1"]);
    expect(r.groups.map((g) => g.type)).toEqual(["project"]);
  });
});
