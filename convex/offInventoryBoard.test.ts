// @vitest-environment node
//
// Off-inventory units (FEATUREDOCS/11): the Overbookings board must not count
// them as stock demand. Same fixture shape as overbookingBoard.test.ts.
import { convexTest, type TestConvex } from "convex-test";
import { register as registerRateLimiter } from "@convex-dev/rate-limiter/test";
import { describe, test, expect } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";

const modules = import.meta.glob("./**/*.ts");
type T = TestConvex<typeof schema>;

const ORG = "org_1";
const USER = "user_1";
const NOW = 1_700_000_000_000;
const DAY = 86_400_000;
const asUser = { subject: USER, orgId: ORG };

async function seed(t: T, offInventoryQuantity: number | undefined) {
  await t.run(async (ctx) => {
    await ctx.db.insert("members", { id: "m1", organizationId: ORG, userId: USER, role: "owner" });
    await ctx.db.insert("models", { id: "mdl", organizationId: ORG, name: "4099", assetType: "SERIALIZED" });
    for (const id of ["A0", "A1"]) {
      await ctx.db.insert("assets", { id, organizationId: ORG, modelId: "mdl", assetTag: id, status: "AVAILABLE" });
    }
    await ctx.db.insert("projects", {
      id: "P1", organizationId: ORG, projectNumber: "P1", name: "Job", status: "CONFIRMED",
      isTemplate: false, rentalStartDate: NOW, rentalEndDate: NOW + 5 * DAY, createdAt: NOW, updatedAt: NOW,
      liveVersionId: "v-P1",
    });
    await ctx.db.insert("projectVersions", { id: "v-P1", organizationId: ORG, projectId: "P1", number: 1, contentState: "ready", createdAt: NOW, createdById: "u1" });
    await ctx.db.insert("projectLineItems", {
      id: "L1", organizationId: ORG, projectId: "P1", modelId: "mdl", status: "CONFIRMED", quantity: 3, type: "EQUIPMENT",
      versionId: "v-P1", lineageId: "L1", offInventoryQuantity,
    });
  });
}

const range = { orgId: ORG, rangeStart: NOW - DAY, rangeEnd: NOW + 10 * DAY };

describe("overbookingBoard with off-inventory units", () => {
  test("3 booked on 2 assets is a hard shortage of 1 with no custom units", async () => {
    const t = convexTest(schema, modules);
    registerRateLimiter(t, "rateLimiter");
    await seed(t, undefined);
    const r = await t.withIdentity(asUser).query(api.overbookingBoard.bundle, range);
    expect(r.gearHard).toHaveLength(1);
    expect(r.gearHard[0]).toMatchObject({ modelId: "mdl", qty: 1 });
  });

  test("converting the 3rd unit to a custom item clears the shortage", async () => {
    const t = convexTest(schema, modules);
    registerRateLimiter(t, "rateLimiter");
    await seed(t, 1);
    const r = await t.withIdentity(asUser).query(api.overbookingBoard.bundle, range);
    expect(r.gearHard).toHaveLength(0);
    expect(r.gearPencilled).toHaveLength(0);
  });

  test("a fully off-inventory line is zero demand", async () => {
    const t = convexTest(schema, modules);
    registerRateLimiter(t, "rateLimiter");
    await seed(t, 3);
    const r = await t.withIdentity(asUser).query(api.overbookingBoard.bundle, range);
    expect(r.gearHard).toHaveLength(0);
  });
});

describe("availability.modelBookings with off-inventory units", () => {
  const q = { orgId: ORG, modelId: "mdl", startMs: NOW - DAY, endMs: NOW + 10 * DAY };

  test("a booking row shows only the stock-backed share", async () => {
    const t = convexTest(schema, modules);
    registerRateLimiter(t, "rateLimiter");
    await seed(t, 1);
    const r = await t.withIdentity(asUser).query(api.availability.modelBookings, q);
    expect(r.bookings).toHaveLength(1);
    expect(r.bookings[0].quantity).toBe(2);
  });

  test("a fully off-inventory line is not a booking at all", async () => {
    const t = convexTest(schema, modules);
    registerRateLimiter(t, "rateLimiter");
    await seed(t, 3);
    const r = await t.withIdentity(asUser).query(api.availability.modelBookings, q);
    expect(r.bookings).toHaveLength(0);
  });
});
