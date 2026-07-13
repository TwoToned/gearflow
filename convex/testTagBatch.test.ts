// @vitest-environment node
//
// testTagAssets.createManyIfMissing + testTagAssets.retireMany — the Phase 3 bulk
// single-call invariants for Test & Tag (Appendix A*):
//  - createManyIfMissing: N reserved-tag assets created in ONE array mutation (was one
//    createIfMissing round-trip per id). organizationId is stamped from the arg (no
//    per-row cross-tenant smuggling); dedups by id.
//  - retireMany: N orphaned/dangling assets retired in ONE array mutation (was one
//    update round-trip per id) with a per-item organizationId re-check on the GLOBAL
//    by_cuid index (cross-org rows skipped).
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

const rowById = (t: T, id: string) =>
  t.run(async (ctx) => (await ctx.db.query("testTagAssets").withIndex("by_cuid", (q) => q.eq("id", id)).unique()));

describe("testTagAssets.createManyIfMissing — bulk single-call", () => {
  test("creates new assets, skips an existing id, stamps organizationId from the arg", async () => {
    const t = makeT();
    await t.run(async (ctx) => {
      await ctx.db.insert("testTagAssets", {
        id: "tt-existing", organizationId: ORG, testTagId: "TT-000", description: "seed",
        status: "NOT_YET_TESTED", isActive: true, createdAt: NOW, updatedAt: NOW,
      });
    });

    const { created } = await t.withIdentity(SERVICE).mutation(api.testTagAssets.createManyIfMissing, {
      organizationId: ORG,
      rows: [
        { id: "tt-existing", testTagId: "TT-000", description: "dupe", status: "NOT_YET_TESTED", isActive: true, createdAt: NOW, updatedAt: NOW }, // already there → skip
        { id: "tt1", testTagId: "TT-001", description: "Drill", equipmentClass: "CLASS_I", applianceType: "APPLIANCE", testIntervalMonths: 3, bulkAssetId: "bulk1", status: "NOT_YET_TESTED", isActive: true, createdAt: NOW, updatedAt: NOW },
        { id: "tt2", testTagId: "TT-002", description: "Lead", equipmentClass: "LEAD_CORD_ASSEMBLY", applianceType: "EXTENSION_LEAD", testIntervalMonths: 3, bulkAssetId: "bulk1", status: "NOT_YET_TESTED", isActive: true, createdAt: NOW, updatedAt: NOW },
      ],
    });

    expect(created).toBe(2);
    const tt1 = await rowById(t, "tt1");
    expect(tt1?.organizationId).toBe(ORG); // stamped from the arg
    expect(tt1?.testTagId).toBe("TT-001");
    expect(tt1?.bulkAssetId).toBe("bulk1");
    expect((await rowById(t, "tt2"))?.equipmentClass).toBe("LEAD_CORD_ASSEMBLY");

    // Exactly one row for the pre-existing id (no duplicate insert).
    const dupes = await t.run(async (ctx) =>
      (await ctx.db.query("testTagAssets").withIndex("by_cuid", (q) => q.eq("id", "tt-existing")).collect()).length,
    );
    expect(dupes).toBe(1);
  });

  test("a non-service token cannot call it", async () => {
    const t = makeT();
    await expect(
      t.withIdentity({ subject: "u1", orgId: ORG }).mutation(api.testTagAssets.createManyIfMissing, {
        organizationId: ORG,
        rows: [{ id: "x", testTagId: "TT-X", description: "no", status: "NOT_YET_TESTED", isActive: true, createdAt: NOW, updatedAt: NOW }],
      }),
    ).rejects.toThrow(/server/i);
  });
});

async function seedForRetire(t: T) {
  await t.run(async (ctx) => {
    await ctx.db.insert("testTagAssets", { id: "r1", organizationId: ORG, testTagId: "TT-R1", description: "orphan", status: "NOT_YET_TESTED", isActive: true, createdAt: NOW, updatedAt: NOW });
    await ctx.db.insert("testTagAssets", { id: "r2", organizationId: ORG, testTagId: "TT-R2", description: "dangling", status: "CURRENT", isActive: true, createdAt: NOW, updatedAt: NOW });
    await ctx.db.insert("testTagAssets", { id: "rx", organizationId: OTHER, testTagId: "TT-RX", description: "other org", status: "CURRENT", isActive: true, createdAt: NOW, updatedAt: NOW });
  });
}

describe("testTagAssets.retireMany — bulk single-call + per-item org re-check", () => {
  test("retires in-org assets, skips cross-org, skips missing", async () => {
    const t = makeT();
    await seedForRetire(t);

    const { retired } = await t.withIdentity(SERVICE).mutation(api.testTagAssets.retireMany, {
      organizationId: ORG,
      ids: ["r1", "r2", "rx", "does-not-exist"],
      now: NOW + 1,
    });

    expect(retired).toBe(2);
    const r1 = await rowById(t, "r1");
    expect(r1?.status).toBe("RETIRED");
    expect(r1?.isActive).toBe(false);
    expect(r1?.updatedAt).toBe(NOW + 1);
    expect((await rowById(t, "r2"))?.status).toBe("RETIRED");
    // cross-org row untouched (per-item org re-check on a GLOBAL by_cuid).
    const rx = await rowById(t, "rx");
    expect(rx?.status).toBe("CURRENT");
    expect(rx?.isActive).toBe(true);
  });

  test("a non-service token cannot call it", async () => {
    const t = makeT();
    await seedForRetire(t);
    await expect(
      t.withIdentity({ subject: "u1", orgId: ORG }).mutation(api.testTagAssets.retireMany, {
        organizationId: ORG,
        ids: ["r1"],
        now: NOW,
      }),
    ).rejects.toThrow(/server/i);
  });
});
