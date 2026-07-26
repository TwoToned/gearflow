// @vitest-environment node
//
// convex/wooCommerceOrderLogs.ts findCompletedByOrder — the webhook idempotency
// check, now via the by_wooOrderId index instead of a whole-org collect + JS find
// (R-9.8, #901).
import { convexTest, type TestConvex } from "convex-test";
import { describe, test, expect } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";

const modules = import.meta.glob("./**/*.ts");
type T = TestConvex<typeof schema>;
const ORG = "org_1";
const OTHER = "org_2";
const SERVICE = { subject: "gearflow-service", svc: true };

function makeT(): T {
  return convexTest(schema, modules);
}

describe("wooCommerceOrderLogs.findCompletedByOrder", () => {
  test("finds the COMPLETED log for this org + wooOrderId, ignoring other statuses/orgs/orders", async () => {
    const t = makeT();
    await t.run(async (ctx) => {
      await ctx.db.insert("wooCommerceOrderLogs", { id: "l1", organizationId: ORG, wooOrderId: 100, status: "FAILED", payload: {} });
      await ctx.db.insert("wooCommerceOrderLogs", { id: "l2", organizationId: ORG, wooOrderId: 100, status: "COMPLETED", payload: {} });
      await ctx.db.insert("wooCommerceOrderLogs", { id: "l3", organizationId: ORG, wooOrderId: 200, status: "COMPLETED", payload: {} });
      await ctx.db.insert("wooCommerceOrderLogs", { id: "l4", organizationId: OTHER, wooOrderId: 100, status: "COMPLETED", payload: {} });
    });
    const res = await t.withIdentity(SERVICE).query(api.wooCommerceOrderLogs.findCompletedByOrder, { orgId: ORG, wooOrderId: 100 });
    expect(res?.id).toBe("l2");
  });

  test("returns null when no COMPLETED log exists for this org + wooOrderId", async () => {
    const t = makeT();
    await t.run(async (ctx) => {
      await ctx.db.insert("wooCommerceOrderLogs", { id: "l1", organizationId: ORG, wooOrderId: 100, status: "FAILED", payload: {} });
    });
    const res = await t.withIdentity(SERVICE).query(api.wooCommerceOrderLogs.findCompletedByOrder, { orgId: ORG, wooOrderId: 100 });
    expect(res).toBeNull();
  });
});
