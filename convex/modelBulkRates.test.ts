// @vitest-environment node
//
// models.bulkUpdateRates — the Phase 3 bulk single-call invariant for model rate
// edits (Appendix A*): N rate patches applied in ONE array mutation (was one Convex
// round-trip per model server-side) with a per-item organizationId re-check.
import { convexTest } from "convex-test";
import { describe, test, expect } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";

const modules = import.meta.glob("./**/*.ts");
const ORG = "org_1";
const OTHER = "org_other";
const NOW = 1_700_000_000_000;
const SERVICE = { subject: "gearflow-service", svc: true };
// Infer the schema-typed tester from a real call so ctx.db inside t.run knows the
// indexes (applying the generic to convexTest directly loses the schema typing).
const makeT = () => convexTest(schema, modules);
type T = ReturnType<typeof makeT>;

async function seed(t: T) {
  await t.run(async (ctx) => {
    await ctx.db.insert("models", { id: "m1", organizationId: ORG, name: "PAR", dailyRate: 100, defaultRentalPrice: 100, createdAt: NOW, updatedAt: NOW });
    await ctx.db.insert("models", { id: "m2", organizationId: ORG, name: "Wash", weeklyRate: 500, createdAt: NOW, updatedAt: NOW });
    await ctx.db.insert("models", { id: "mx", organizationId: OTHER, name: "Other", dailyRate: 100, defaultRentalPrice: 100, createdAt: NOW, updatedAt: NOW });
  });
}
const model = (t: T, id: string) =>
  t.run(async (ctx) => (await ctx.db.query("models").withIndex("by_cuid", (q) => q.eq("id", id)).unique()));

describe("models.bulkUpdateRates — bulk single-call + per-item org re-check", () => {
  test("applies rate patches to in-org models, syncs defaultRentalPrice, skips cross-org", async () => {
    const t = makeT();
    await seed(t);

    const { count } = await t.withIdentity(SERVICE).mutation(api.models.bulkUpdateRates, {
      organizationId: ORG,
      updates: [
        { id: "m1", rateType: "dailyRate", newRate: 150 },
        { id: "m2", rateType: "weeklyRate", newRate: 400 },
        { id: "mx", rateType: "dailyRate", newRate: 999 }, // another org — must be skipped
      ],
      now: NOW + 1,
    });

    expect(count).toBe(2);
    const m1 = await model(t, "m1");
    expect(m1?.dailyRate).toBe(150);
    expect(m1?.defaultRentalPrice).toBe(150); // dailyRate auto-syncs defaultRentalPrice
    expect(m1?.updatedAt).toBe(NOW + 1);
    expect((await model(t, "m2"))?.weeklyRate).toBe(400);
    // cross-org model untouched (per-item org re-check on a GLOBAL by_cuid).
    const mx = await model(t, "mx");
    expect(mx?.dailyRate).toBe(100);
    expect(mx?.defaultRentalPrice).toBe(100);
  });

  test("a non-service (user) token cannot call the batch", async () => {
    const t = makeT();
    await seed(t);
    await expect(
      t.withIdentity({ subject: "user_1", orgId: ORG }).mutation(api.models.bulkUpdateRates, {
        organizationId: ORG,
        updates: [{ id: "m1", rateType: "dailyRate", newRate: 1 }],
        now: NOW,
      }),
    ).rejects.toThrow(/server/i);
  });
});
