// @vitest-environment node
import { convexTest } from "convex-test";
import { describe, test, expect } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";

const modules = import.meta.glob("./**/*.ts");
const ORG = "org_1";
const USER = "user_1";
const asUser = (orgId: string) => ({ subject: USER, orgId });
const NOW = 1_700_000_000_000;

describe("dashboardActivity.bundle", () => {
  test("returns recent scan / test / maintenance with names resolved from the Convex mirror", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      await ctx.db.insert("members", { id: "m1", organizationId: ORG, userId: USER, role: "viewer" });
      await ctx.db.insert("users", { id: USER, name: "Alice", email: "a@x.com" });
      await ctx.db.insert("models", { id: "mdl1", organizationId: ORG, name: "SM58", assetType: "SERIALIZED" });
      await ctx.db.insert("assets", { id: "as1", organizationId: ORG, modelId: "mdl1", assetTag: "TAG-1" });
      await ctx.db.insert("projects", { id: "p1", organizationId: ORG, projectNumber: "P1", name: "Gig" });

      // 2 scan logs — newest first by scannedAt.
      await ctx.db.insert("assetScanLogs", { id: "sl_old", organizationId: ORG, scannedById: USER, assetId: "as1", projectId: "p1", action: "CHECK_OUT", scannedAt: NOW - 1000 });
      await ctx.db.insert("assetScanLogs", { id: "sl_new", organizationId: ORG, scannedById: USER, assetId: "as1", projectId: "p1", action: "CHECK_IN", scannedAt: NOW });

      // test record + its tag asset
      await ctx.db.insert("testTagAssets", { id: "tta1", organizationId: ORG, testTagId: "TT-1", description: "Drill" });
      await ctx.db.insert("testTagRecords", { id: "tr1", organizationId: ORG, testTagAssetId: "tta1", testDate: NOW, testedById: USER, testerName: "Alice", nextDueDate: NOW + 1000, result: "PASS" });

      // maintenance + asset link
      await ctx.db.insert("maintenanceRecords", { id: "mr1", organizationId: ORG, title: "Service", type: "REPAIR", status: "SCHEDULED", reportedById: USER, updatedAt: NOW });
      await ctx.db.insert("maintenanceRecordAssets", { id: "mra1", maintenanceRecordId: "mr1", assetId: "as1" });
    });

    const res = await t.withIdentity(asUser(ORG)).query(api.dashboardActivity.bundle, { orgId: ORG });

    // scan logs newest-first, names + model resolved
    expect(res.logs.map((l) => l.id)).toEqual(["sl_new", "sl_old"]);
    expect(res.logs[0].asset?.model?.name).toBe("SM58");
    expect(res.logs[0].asset?.assetTag).toBe("TAG-1");
    expect(res.logs[0].project?.name).toBe("Gig");
    expect(res.logs[0].scannedBy?.name).toBe("Alice");
    expect(res.logs[0].action).toBe("CHECK_IN");

    // test records
    expect(res.testRecords[0].testTagAsset?.description).toBe("Drill");
    expect(res.testRecords[0].testedBy?.name).toBe("Alice");
    expect(res.testRecords[0].result).toBe("PASS");

    // maintenance + asset link (≤3)
    expect(res.maintenanceRecords[0].title).toBe("Service");
    expect(res.maintenanceRecords[0].reportedBy?.name).toBe("Alice");
    expect(res.maintenanceRecords[0].assets[0].asset?.assetTag).toBe("TAG-1");
    expect(res.maintenanceRecords[0].assets[0].asset?.model?.name).toBe("SM58");
  });

  test("denies a non-member", async () => {
    const t = convexTest(schema, modules);
    await expect(
      t.withIdentity(asUser("other")).query(api.dashboardActivity.bundle, { orgId: ORG }),
    ).rejects.toThrow();
  });
});
