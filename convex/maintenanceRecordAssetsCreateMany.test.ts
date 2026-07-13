// @vitest-environment node
//
// maintenanceRecordAssets.createManyIfMissing — bulk single-call for linking N assets
// to a maintenance record (the server helper was looping `create` per asset). Verifies
// one array insert, idempotency per id, and per-parent org re-check (the join table has
// no org column, so a batch referencing another org's record must abort with no insert).
import { convexTest } from "convex-test";
import { describe, test, expect } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";

const modules = import.meta.glob("./**/*.ts");
const ORG = "org_1";
const OTHER = "org_other";
const NOW = 1_700_000_000_000;
const SERVICE = { subject: "gearflow-service", svc: true };
const makeT = () => convexTest(schema, modules);
type T = ReturnType<typeof makeT>;

const seedRecord = (t: T, id: string, organizationId: string) =>
  t.run(async (ctx) => {
    await ctx.db.insert("maintenanceRecords", {
      id,
      organizationId,
      type: "REPAIR",
      status: "SCHEDULED",
      title: "Fix",
      reportedById: "u1",
      createdAt: NOW,
      updatedAt: NOW,
    });
  });

const countLinks = (t: T, recordId: string) =>
  t.run(async (ctx) =>
    (await ctx.db.query("maintenanceRecordAssets").withIndex("by_maintenanceRecordId", (q) => q.eq("maintenanceRecordId", recordId)).collect()).length,
  );

describe("maintenanceRecordAssets.createManyIfMissing", () => {
  test("links all assets in one call, idempotent per id", async () => {
    const t = makeT();
    await seedRecord(t, "mr_1", ORG);
    const links = [
      { id: "l_1", maintenanceRecordId: "mr_1", assetId: "a_1" },
      { id: "l_2", maintenanceRecordId: "mr_1", assetId: "a_2" },
    ];
    const first = await t.withIdentity(SERVICE).mutation(api.maintenanceRecordAssets.createManyIfMissing, { organizationId: ORG, links });
    expect(first.created).toBe(2);
    expect(await countLinks(t, "mr_1")).toBe(2);

    const second = await t.withIdentity(SERVICE).mutation(api.maintenanceRecordAssets.createManyIfMissing, { organizationId: ORG, links });
    expect(second.created).toBe(0);
    expect(await countLinks(t, "mr_1")).toBe(2);
  });

  test("aborts the whole batch if a record belongs to another org (no partial insert)", async () => {
    const t = makeT();
    await seedRecord(t, "mr_ok", ORG);
    await seedRecord(t, "mr_bad", OTHER);
    await expect(
      t.withIdentity(SERVICE).mutation(api.maintenanceRecordAssets.createManyIfMissing, {
        organizationId: ORG,
        links: [
          { id: "l_ok", maintenanceRecordId: "mr_ok", assetId: "a_1" },
          { id: "l_bad", maintenanceRecordId: "mr_bad", assetId: "a_2" },
        ],
      }),
    ).rejects.toThrow(/Forbidden/);
    expect(await countLinks(t, "mr_ok")).toBe(0);
    expect(await countLinks(t, "mr_bad")).toBe(0);
  });

  test("rejects a non-service caller", async () => {
    const t = makeT();
    await seedRecord(t, "mr_1", ORG);
    await expect(
      t.withIdentity({ subject: "user_1" }).mutation(api.maintenanceRecordAssets.createManyIfMissing, {
        organizationId: ORG,
        links: [{ id: "l_1", maintenanceRecordId: "mr_1", assetId: "a_1" }],
      }),
    ).rejects.toThrow();
  });
});
