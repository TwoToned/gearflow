// @vitest-environment node
//
// subTestRecords.createManyIfMissing — bulk single-call for a T&T record's sub-tests
// (the server was looping createIfMissing per sub-test). Verifies: one array insert,
// idempotent per id, and per-parent org re-check (subTestRecords are parent-scoped, no
// org column — a batch referencing another org's record must abort).
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
    await ctx.db.insert("testTagRecords", {
      id,
      organizationId,
      testTagAssetId: "tta_1",
      testDate: NOW,
      testedById: "u1",
      testerName: "Tester",
      nextDueDate: NOW,
    });
  });

const countSubTests = (t: T, recordId: string) =>
  t.run(async (ctx) =>
    (await ctx.db.query("subTestRecords").withIndex("by_testTagRecordId", (q) => q.eq("testTagRecordId", recordId)).collect()).length,
  );

describe("subTestRecords.createManyIfMissing", () => {
  test("inserts all sub-tests in one call, idempotent per id", async () => {
    const t = makeT();
    await seedRecord(t, "rec_1", ORG);
    const records = [
      { id: "st_1", testTagRecordId: "rec_1", label: "A", createdAt: NOW },
      { id: "st_2", testTagRecordId: "rec_1", label: "B", createdAt: NOW },
    ];
    const first = await t.withIdentity(SERVICE).mutation(api.subTestRecords.createManyIfMissing, { organizationId: ORG, records });
    expect(first.created).toBe(2);
    expect(await countSubTests(t, "rec_1")).toBe(2);

    // Re-run (retry) — no duplicates.
    const second = await t.withIdentity(SERVICE).mutation(api.subTestRecords.createManyIfMissing, { organizationId: ORG, records });
    expect(second.created).toBe(0);
    expect(await countSubTests(t, "rec_1")).toBe(2);
  });

  test("aborts the whole batch if any record belongs to another org (no partial insert)", async () => {
    const t = makeT();
    await seedRecord(t, "rec_ok", ORG);
    await seedRecord(t, "rec_bad", OTHER);
    await expect(
      t.withIdentity(SERVICE).mutation(api.subTestRecords.createManyIfMissing, {
        organizationId: ORG,
        records: [
          { id: "st_a", testTagRecordId: "rec_ok", label: "A", createdAt: NOW },
          { id: "st_b", testTagRecordId: "rec_bad", label: "B", createdAt: NOW },
        ],
      }),
    ).rejects.toThrow(/Forbidden/);
    // Verification happens up-front, before any insert → nothing written.
    expect(await countSubTests(t, "rec_ok")).toBe(0);
    expect(await countSubTests(t, "rec_bad")).toBe(0);
  });

  test("rejects a non-service (browser) caller", async () => {
    const t = makeT();
    await seedRecord(t, "rec_1", ORG);
    await expect(
      t.withIdentity({ subject: "user_1" }).mutation(api.subTestRecords.createManyIfMissing, {
        organizationId: ORG,
        records: [{ id: "st_1", testTagRecordId: "rec_1", label: "A", createdAt: NOW }],
      }),
    ).rejects.toThrow();
  });
});
