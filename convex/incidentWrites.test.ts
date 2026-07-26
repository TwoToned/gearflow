// @vitest-environment node
//
// convex/incidentWrites.ts — the "Report Issue" mutation (GitHub #898,
// FEATUREDOCS/64-incident-reporting.md). Verifies: creates a REPAIR
// MaintenanceRecord with incidentType/incidentSeverity set, flips the asset's
// status IMMEDIATELY (IN_MAINTENANCE / LOST per incidentType, unconditional aside
// from the RETIRED guard — unlike maintenanceWrites' AVAILABLE-only hold), resolves
// the asset from a line item when no explicit assetId is given, required-photo
// enforcement, idempotency, and the security bar (cross-tenant + viewer RBAC).
import { convexTest, type TestConvex } from "convex-test";
import { register as registerRateLimiter } from "@convex-dev/rate-limiter/test";
import { describe, test, expect } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";

const modules = import.meta.glob("./**/*.ts");
type T = TestConvex<typeof schema>;
const ORG = "org_1";
const OTHER = "org_2";
const USER = "user_1";
const NOW = 1_700_000_000_000;
const actor = { userId: USER, userName: "Alice" };
const asUser = { subject: USER, orgId: ORG, role: "admin" };

function makeT(): T {
  const t = convexTest(schema, modules);
  registerRateLimiter(t, "rateLimiter");
  return t;
}
async function seed(t: T, role = "admin") {
  await t.run(async (ctx) => {
    await ctx.db.insert("members", { id: "m1", organizationId: ORG, userId: USER, role });
    await ctx.db.insert("users", { id: USER, name: "Alice", email: "a@x.com" });
    await ctx.db.insert("projects", { id: "p1", organizationId: ORG, projectNumber: "P-1", name: "Test", createdAt: NOW, updatedAt: NOW });
  });
}
async function seedAsset(t: T, id: string, status: string, org = ORG) {
  await t.run(async (ctx) => {
    await ctx.db.insert("assets", {
      id, organizationId: org, assetTag: id.toUpperCase(), modelId: "m1",
      status: status as "AVAILABLE", isActive: true, createdAt: NOW, updatedAt: NOW,
    });
  });
}
async function seedLine(t: T, id: string, patch: Record<string, unknown> = {}) {
  await t.run(async (ctx) => {
    await ctx.db.insert("projectLineItems", {
      id, organizationId: ORG, projectId: "p1", type: "EQUIPMENT",
      quantity: 1, status: "CHECKED_OUT", createdAt: NOW, updatedAt: NOW, ...patch,
    });
  });
}
const asset = (t: T, id: string) =>
  t.run(async (ctx) => ctx.db.query("assets").withIndex("by_cuid", (q) => q.eq("id", id)).first());
const rec = (t: T, id: string) =>
  t.run(async (ctx) => ctx.db.query("maintenanceRecords").withIndex("by_cuid", (q) => q.eq("id", id)).first());
const linksFor = (t: T, recordId: string) =>
  t.run(async (ctx) =>
    ctx.db.query("maintenanceRecordAssets").withIndex("by_maintenanceRecordId", (q) => q.eq("maintenanceRecordId", recordId)).collect(),
  );

const base = {
  orgId: ORG, recordId: "rec1", linkId: "lnk1",
  incidentSeverity: "MINOR" as const,
  description: "The light won't turn on",
  photos: ["https://x/photo1.jpg"],
  now: NOW, actor, auditId: "a1",
};

describe("incidentWrites.reportIssueNative", () => {
  test("BROKEN_DAMAGED flips a CHECKED_OUT asset to IN_MAINTENANCE (not just AVAILABLE, unlike maintenanceWrites.holdAssets)", async () => {
    const t = makeT(); await seed(t); await seedAsset(t, "as1", "CHECKED_OUT");
    const res = await t.withIdentity(asUser).mutation(api.incidentWrites.reportIssueNative, {
      ...base, assetId: "as1", incidentType: "BROKEN_DAMAGED",
    });
    expect(res.id).toBe("rec1");
    expect((await asset(t, "as1"))?.status).toBe("IN_MAINTENANCE");
    const r = await rec(t, "rec1");
    expect(r?.type).toBe("REPAIR");
    expect(r?.status).toBe("SCHEDULED");
    expect(r?.incidentType).toBe("BROKEN_DAMAGED");
    expect(r?.incidentSeverity).toBe("MINOR");
    expect(r?.reportedById).toBe(USER);
    const links = await linksFor(t, "rec1");
    expect(links.map((l) => l.assetId)).toEqual(["as1"]);
    const log = await t.run(async (ctx) => ctx.db.query("activityLogs").withIndex("by_cuid", (q) => q.eq("id", "a1")).first());
    expect(log?.action).toBe("REPORT_ISSUE");
  });

  test("LOST_MISSING flips the asset to LOST, not IN_MAINTENANCE", async () => {
    const t = makeT(); await seed(t); await seedAsset(t, "as1", "CHECKED_OUT");
    await t.withIdentity(asUser).mutation(api.incidentWrites.reportIssueNative, {
      ...base, assetId: "as1", incidentType: "LOST_MISSING",
    });
    expect((await asset(t, "as1"))?.status).toBe("LOST");
  });

  test("resolves the asset from a line item when no explicit assetId is given", async () => {
    const t = makeT(); await seed(t); await seedAsset(t, "as1", "CHECKED_OUT"); await seedLine(t, "L1", { assetId: "as1" });
    await t.withIdentity(asUser).mutation(api.incidentWrites.reportIssueNative, {
      ...base, projectId: "p1", lineItemId: "L1", incidentType: "NEEDS_SERVICE",
    });
    expect((await asset(t, "as1"))?.status).toBe("IN_MAINTENANCE");
    const links = await linksFor(t, "rec1");
    expect(links.map((l) => l.assetId)).toEqual(["as1"]);
    const r = await rec(t, "rec1");
    expect(r?.lineItemId).toBe("L1");
    expect(r?.projectId).toBe("p1");
  });

  test("rejects reporting on a RETIRED asset", async () => {
    const t = makeT(); await seed(t); await seedAsset(t, "as1", "RETIRED");
    await expect(
      t.withIdentity(asUser).mutation(api.incidentWrites.reportIssueNative, {
        ...base, assetId: "as1", incidentType: "BROKEN_DAMAGED",
      }),
    ).rejects.toThrow(/retired/i);
  });

  test("rejects an empty photos array (at least one photo required)", async () => {
    const t = makeT(); await seed(t); await seedAsset(t, "as1", "CHECKED_OUT");
    await expect(
      t.withIdentity(asUser).mutation(api.incidentWrites.reportIssueNative, {
        ...base, assetId: "as1", incidentType: "BROKEN_DAMAGED", photos: [],
      }),
    ).rejects.toThrow(/photo/i);
  });

  test("rejects with neither assetId nor a resolvable lineItemId", async () => {
    const t = makeT(); await seed(t);
    await expect(
      t.withIdentity(asUser).mutation(api.incidentWrites.reportIssueNative, {
        ...base, incidentType: "BROKEN_DAMAGED",
      }),
    ).rejects.toThrow(/asset/i);
  });

  test("is idempotent on a same-org retry of the same recordId", async () => {
    const t = makeT(); await seed(t); await seedAsset(t, "as1", "CHECKED_OUT");
    const args = { ...base, assetId: "as1", incidentType: "BROKEN_DAMAGED" as const };
    await t.withIdentity(asUser).mutation(api.incidentWrites.reportIssueNative, args);
    const res2 = await t.withIdentity(asUser).mutation(api.incidentWrites.reportIssueNative, args);
    expect(res2.id).toBe("rec1");
    const links = await linksFor(t, "rec1");
    expect(links).toHaveLength(1); // not duplicated
  });

  test("rejects a recordId collision with an UNRELATED cross-org record", async () => {
    const t = makeT(); await seed(t); await seedAsset(t, "as1", "CHECKED_OUT");
    await t.run(async (ctx) => {
      await ctx.db.insert("maintenanceRecords", { id: "rec1", organizationId: OTHER, type: "REPAIR", status: "SCHEDULED", title: "Foreign", createdAt: NOW, updatedAt: NOW });
    });
    await expect(
      t.withIdentity(asUser).mutation(api.incidentWrites.reportIssueNative, {
        ...base, assetId: "as1", incidentType: "BROKEN_DAMAGED",
      }),
    ).rejects.toThrow(/already exists/i);
  });

  test("rejects an asset belonging to another org", async () => {
    const t = makeT(); await seed(t); await seedAsset(t, "foreign", "AVAILABLE", OTHER);
    await expect(
      t.withIdentity(asUser).mutation(api.incidentWrites.reportIssueNative, {
        ...base, assetId: "foreign", incidentType: "BROKEN_DAMAGED",
      }),
    ).rejects.toThrow(/not found/i);
  });

  test("viewer role is denied (read-only on maintenance)", async () => {
    const t = makeT(); await seed(t, "viewer"); await seedAsset(t, "as1", "CHECKED_OUT");
    await expect(
      t.withIdentity({ subject: USER, orgId: ORG, role: "viewer" }).mutation(api.incidentWrites.reportIssueNative, {
        ...base, assetId: "as1", incidentType: "BROKEN_DAMAGED",
      }),
    ).rejects.toThrow(/Forbidden|permission/i);
  });

  test("warehouse role IS allowed (maintenance:create was widened for this feature)", async () => {
    const t = makeT(); await seed(t, "warehouse"); await seedAsset(t, "as1", "CHECKED_OUT");
    const res = await t.withIdentity({ subject: USER, orgId: ORG, role: "warehouse" }).mutation(api.incidentWrites.reportIssueNative, {
      ...base, assetId: "as1", incidentType: "BROKEN_DAMAGED",
    });
    expect(res.id).toBe("rec1");
  });
});
