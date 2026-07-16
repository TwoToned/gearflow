// @vitest-environment node
import { convexTest } from "convex-test";
import { describe, test, expect } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";
import { reserveSubHireOrderNumberCounter } from "./lib/subHireOrderCounter";

const modules = import.meta.glob("./**/*.ts");
const ORG = "org_1";
const NOW = 1_700_000_000_000;
const SERVICE = { subject: "gearflow-service", svc: true };

/**
 * Counter gate for reserveSubHireOrderNumberCounter (convex/lib/subHireOrderCounter.ts)
 * + the still-server orgSettings.reserveSubHireOrderNumber delegation. Format is
 * "SH-NNNN" (4-digit, zero-padded), incrementing by one per reservation.
 */
describe("reserveSubHireOrderNumberCounter", () => {
  test("sequential reservations increment from an empty org", async () => {
    const t = convexTest(schema, modules);
    const r1 = await t.run(async (ctx) => reserveSubHireOrderNumberCounter(ctx, ORG, NOW));
    const r2 = await t.run(async (ctx) => reserveSubHireOrderNumberCounter(ctx, ORG, NOW + 1));
    const r3 = await t.run(async (ctx) => reserveSubHireOrderNumberCounter(ctx, ORG, NOW + 2));
    expect(r1.orderNumber).toBe("SH-0001");
    expect(r2.orderNumber).toBe("SH-0002");
    expect(r3.orderNumber).toBe("SH-0003");
    // Single orgSettings row, counter at 3.
    const row = await t.run(async (ctx) => ctx.db.query("orgSettings").withIndex("by_organizationId", (q) => q.eq("organizationId", ORG)).unique());
    expect(JSON.parse(row!.settings!).subHireOrderCounter).toBe(3);
  });

  test("floor seeds the counter forward (cutover carry-forward)", async () => {
    const t = convexTest(schema, modules);
    const r = await t.run(async (ctx) => reserveSubHireOrderNumberCounter(ctx, ORG, NOW, 41));
    expect(r.orderNumber).toBe("SH-0042");
  });

  test("orgSettings.reserveSubHireOrderNumber delegates — same format + increment", async () => {
    const t = convexTest(schema, modules);
    const a = await t.withIdentity(SERVICE).mutation(api.orgSettings.reserveSubHireOrderNumber, { organizationId: ORG, now: NOW });
    const b = await t.withIdentity(SERVICE).mutation(api.orgSettings.reserveSubHireOrderNumber, { organizationId: ORG, now: NOW + 1 });
    expect(a.orderNumber).toBe("SH-0001");
    expect(b.orderNumber).toBe("SH-0002");
  });
});
