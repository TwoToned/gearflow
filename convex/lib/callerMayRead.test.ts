// @vitest-environment node
//
// `callerMayRead` (UX Phase 11, Q3): the non-throwing form of the EXISTING read
// check, `requireOrgPermission(ctx, orgId, resource, "read")`. Pinned for both
// member kinds, allow and deny, against `hasPermission` as the oracle — a
// divergence between the wrapper and the guard would be a second permission
// table by accident.
import { convexTest, type TestConvex } from "convex-test";
import { describe, expect, test } from "vitest";
import schema from "../schema";
import { callerMayRead } from "./auth";
import { hasPermission } from "./permissionsCore";

const modules = import.meta.glob("../**/*.ts");
type T = TestConvex<typeof schema>;

const ORG = "org_A";
const OTHER = "org_B";
const USER = "user_1";
const KEY = "key_1";
const asUser = { subject: USER, orgId: ORG };
const asAgent = { subject: USER, orgId: ORG, akid: KEY };

async function seed(t: T, role: string, scopes: string[] = ["*"]) {
  await t.run(async (ctx) => {
    await ctx.db.insert("members", { id: "m", organizationId: ORG, userId: USER, role });
    await ctx.db.insert("apiKeys", {
      id: KEY, organizationId: ORG, name: "k", prefix: "gf_live_aaaaaa", tokenHash: "h",
      scopes: JSON.stringify(scopes), isActive: true, actingUserId: USER, createdById: USER,
    });
  });
}

describe("callerMayRead — user", () => {
  test("allows what the role reads (viewer × asset)", async () => {
    const t = convexTest(schema, modules);
    await seed(t, "viewer");
    expect(hasPermission("viewer", "asset", "read")).toBe(true);
    expect(await t.withIdentity(asUser).query((ctx) => callerMayRead(ctx, ORG, "asset"))).toBe(true);
  });

  test("denies, without throwing, what the role can't read (viewer × warehouse)", async () => {
    const t = convexTest(schema, modules);
    await seed(t, "viewer");
    expect(hasPermission("viewer", "warehouse", "read")).toBe(false);
    expect(await t.withIdentity(asUser).query((ctx) => callerMayRead(ctx, ORG, "warehouse"))).toBe(false);
  });

  test("denies a token for another org and a caller with no member row", async () => {
    const t = convexTest(schema, modules);
    await seed(t, "owner");
    expect(await t.withIdentity(asUser).query((ctx) => callerMayRead(ctx, OTHER, "asset"))).toBe(false);
    expect(await t.withIdentity({ subject: "stranger", orgId: ORG }).query((ctx) => callerMayRead(ctx, ORG, "asset"))).toBe(false);
  });

  test("the service identity may read anything (it already authorised the end user)", async () => {
    const t = convexTest(schema, modules);
    const asService = { subject: "gearflow-service", svc: true };
    expect(await t.withIdentity(asService).query((ctx) => callerMayRead(ctx, ORG, "invoice"))).toBe(true);
  });
});

describe("callerMayRead — agent (key scopes ∩ the acting user's role)", () => {
  test("allows when both the key and the role allow", async () => {
    const t = convexTest(schema, modules);
    await seed(t, "member", ["asset:read"]);
    expect(await t.withIdentity(asAgent).query((ctx) => callerMayRead(ctx, ORG, "asset"))).toBe(true);
  });

  test("denies when the key lacks the scope, even for an owner", async () => {
    const t = convexTest(schema, modules);
    await seed(t, "owner", ["asset:read"]);
    expect(await t.withIdentity(asAgent).query((ctx) => callerMayRead(ctx, ORG, "client"))).toBe(false);
  });

  test("denies when the role lacks it, even with a `*` key", async () => {
    const t = convexTest(schema, modules);
    await seed(t, "viewer", ["*"]);
    expect(await t.withIdentity(asAgent).query((ctx) => callerMayRead(ctx, ORG, "warehouse"))).toBe(false);
  });
});
