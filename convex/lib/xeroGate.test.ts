// @vitest-environment node
import { convexTest } from "convex-test";
import { describe, test, expect } from "vitest";
import schema from "../schema";
import { isXeroLinked } from "./xeroGate";

const modules = import.meta.glob("../**/*.ts");
const ORG = "org_1";

describe("isXeroLinked", () => {
  test("false when no xeroIntegrations row exists for the org", async () => {
    const t = convexTest(schema, modules);
    const linked = await t.run((ctx) => isXeroLinked(ctx, ORG));
    expect(linked).toBe(false);
  });

  test("false when a row exists but isConnected is not true", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      await ctx.db.insert("xeroIntegrations", { id: "xi1", organizationId: ORG, isConnected: false });
    });
    const linked = await t.run((ctx) => isXeroLinked(ctx, ORG));
    expect(linked).toBe(false);
  });

  test("true only when isConnected is exactly true", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      await ctx.db.insert("xeroIntegrations", { id: "xi1", organizationId: ORG, isConnected: true, tenantId: "t1" });
    });
    const linked = await t.run((ctx) => isXeroLinked(ctx, ORG));
    expect(linked).toBe(true);
  });

  test("a different org's connected integration doesn't leak in", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      await ctx.db.insert("xeroIntegrations", { id: "xi1", organizationId: "org_other", isConnected: true, tenantId: "t1" });
    });
    const linked = await t.run((ctx) => isXeroLinked(ctx, ORG));
    expect(linked).toBe(false);
  });
});
