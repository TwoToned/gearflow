// @vitest-environment node
//
// convex/maintenanceWrites.ts — the browser-direct maintenance state machine
// (createNative / updateNative / deleteNative). Verifies the atomic fold:
// record + maintenanceRecordAssets links + the MaintenanceRecord→Asset.status
// hold/release machine + audit + the gated create webhook, plus the security bar
// (cross-tenant + viewer RBAC).
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
  });
}
async function seedAsset(t: T, id: string, status: string) {
  await t.run(async (ctx) => {
    await ctx.db.insert("assets", {
      id, organizationId: ORG, assetTag: id.toUpperCase(), modelId: "m1",
      status: status as "AVAILABLE", isActive: true, createdAt: NOW, updatedAt: NOW,
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

const baseCreate = {
  orgId: ORG, recordId: "rec1", type: "REPAIR" as const, title: "Fix drill",
  assetLinks: [{ id: "lnk1", assetId: "as1" }],
  now: NOW, actor, auditId: "a1",
};

describe("maintenanceWrites.createNative — state machine", () => {
  test("holding status HOLDS an AVAILABLE asset (AVAILABLE → IN_MAINTENANCE)", async () => {
    const t = makeT(); await seed(t); await seedAsset(t, "as1", "AVAILABLE");
    const res = await t.withIdentity(asUser).mutation(api.maintenanceWrites.createNative, { ...baseCreate, status: "IN_PROGRESS" });
    expect(res.id).toBe("rec1");
    expect((await asset(t, "as1"))?.status).toBe("IN_MAINTENANCE");
    // audit written in-tx
    const log = await t.run(async (ctx) => ctx.db.query("activityLogs").withIndex("by_cuid", (q) => q.eq("id", "a1")).first());
    expect(log?.action).toBe("CREATE");
    expect(log?.entityType).toBe("maintenance");
  });

  test("COMPLETED-PASS RELEASES an IN_MAINTENANCE asset", async () => {
    const t = makeT(); await seed(t); await seedAsset(t, "as1", "IN_MAINTENANCE");
    await t.withIdentity(asUser).mutation(api.maintenanceWrites.createNative, { ...baseCreate, status: "COMPLETED", result: "PASS" });
    expect((await asset(t, "as1"))?.status).toBe("AVAILABLE");
  });

  test("SCHEDULED leaves the asset untouched", async () => {
    const t = makeT(); await seed(t); await seedAsset(t, "as1", "AVAILABLE");
    await t.withIdentity(asUser).mutation(api.maintenanceWrites.createNative, { ...baseCreate, status: "SCHEDULED" });
    expect((await asset(t, "as1"))?.status).toBe("AVAILABLE");
  });

  test("HOLD guard: never overwrites a non-AVAILABLE status", async () => {
    const t = makeT(); await seed(t); await seedAsset(t, "as1", "CHECKED_OUT");
    await t.withIdentity(asUser).mutation(api.maintenanceWrites.createNative, { ...baseCreate, status: "IN_PROGRESS" });
    expect((await asset(t, "as1"))?.status).toBe("CHECKED_OUT");
  });

  test("RELEASE guard: only flips IN_MAINTENANCE (never CHECKED_OUT)", async () => {
    const t = makeT(); await seed(t); await seedAsset(t, "as1", "CHECKED_OUT");
    await t.withIdentity(asUser).mutation(api.maintenanceWrites.createNative, { ...baseCreate, status: "COMPLETED", result: "PASS" });
    expect((await asset(t, "as1"))?.status).toBe("CHECKED_OUT");
  });

  test("still-held: another active holding record blocks the release", async () => {
    const t = makeT(); await seed(t); await seedAsset(t, "as1", "IN_MAINTENANCE");
    // A pre-existing IN_PROGRESS record also holds as1.
    await t.run(async (ctx) => {
      await ctx.db.insert("maintenanceRecords", { id: "recHold", organizationId: ORG, type: "REPAIR", status: "IN_PROGRESS", title: "Held", createdAt: NOW, updatedAt: NOW });
      await ctx.db.insert("maintenanceRecordAssets", { id: "lnkHold", maintenanceRecordId: "recHold", assetId: "as1" });
    });
    await t.withIdentity(asUser).mutation(api.maintenanceWrites.createNative, {
      ...baseCreate, recordId: "recDone", status: "COMPLETED", result: "PASS",
      assetLinks: [{ id: "lnk2", assetId: "as1" }],
    });
    // recHold still holds it → stays IN_MAINTENANCE.
    expect((await asset(t, "as1"))?.status).toBe("IN_MAINTENANCE");
  });

  test("rejects a recordId that already exists in ANOTHER org", async () => {
    const t = makeT(); await seed(t); await seedAsset(t, "as1", "AVAILABLE");
    await t.run(async (ctx) => {
      await ctx.db.insert("maintenanceRecords", { id: "rec1", organizationId: OTHER, type: "REPAIR", status: "SCHEDULED", title: "foreign", createdAt: NOW, updatedAt: NOW });
    });
    await expect(
      t.withIdentity(asUser).mutation(api.maintenanceWrites.createNative, { ...baseCreate, status: "SCHEDULED" }),
    ).rejects.toThrow(/already exists/i);
  });

  test("rejects a link id colliding with a DIFFERENT parent record", async () => {
    const t = makeT(); await seed(t); await seedAsset(t, "as1", "AVAILABLE");
    await t.run(async (ctx) => {
      await ctx.db.insert("maintenanceRecordAssets", { id: "lnk1", maintenanceRecordId: "otherParent", assetId: "as9" });
    });
    await expect(
      t.withIdentity(asUser).mutation(api.maintenanceWrites.createNative, { ...baseCreate, status: "SCHEDULED" }),
    ).rejects.toThrow(/collision/i);
    // Nothing persisted (atomic rollback).
    expect(await rec(t, "rec1")).toBeNull();
  });

  test("rejects a cross-org asset link", async () => {
    const t = makeT(); await seed(t);
    await t.run(async (ctx) => {
      await ctx.db.insert("assets", { id: "asX", organizationId: OTHER, assetTag: "ASX", modelId: "m1", status: "AVAILABLE", isActive: true });
    });
    await expect(
      t.withIdentity(asUser).mutation(api.maintenanceWrites.createNative, { ...baseCreate, assetLinks: [{ id: "lnk1", assetId: "asX" }], status: "SCHEDULED" }),
    ).rejects.toThrow(/not found/i);
  });

  test("viewer is denied", async () => {
    const t = makeT(); await seed(t, "viewer"); await seedAsset(t, "as1", "AVAILABLE");
    await expect(
      t.withIdentity({ subject: USER, orgId: ORG, role: "viewer" }).mutation(api.maintenanceWrites.createNative, { ...baseCreate, status: "SCHEDULED" }),
    ).rejects.toThrow(/Forbidden|permission/i);
  });

  // Issue #944 WS5 — the returns-station "Raise repair" shortcut links the new
  // record to the project the damaged item was deployed on.
  test("accepts an org-scoped projectId and persists it on the record", async () => {
    const t = makeT(); await seed(t); await seedAsset(t, "as1", "AVAILABLE");
    await t.run(async (ctx) => {
      await ctx.db.insert("projects", { id: "p1", organizationId: ORG, projectNumber: "P-1", name: "Gig", total: 0 });
    });
    await t.withIdentity(asUser).mutation(api.maintenanceWrites.createNative, { ...baseCreate, status: "SCHEDULED", projectId: "p1" });
    expect((await rec(t, "rec1"))?.projectId).toBe("p1");
  });

  test("rejects a cross-org projectId", async () => {
    const t = makeT(); await seed(t); await seedAsset(t, "as1", "AVAILABLE");
    await t.run(async (ctx) => {
      await ctx.db.insert("projects", { id: "pX", organizationId: OTHER, projectNumber: "P-X", name: "Foreign gig", total: 0 });
    });
    await expect(
      t.withIdentity(asUser).mutation(api.maintenanceWrites.createNative, { ...baseCreate, status: "SCHEDULED", projectId: "pX" }),
    ).rejects.toThrow(/another organization/i);
  });
});

// R-8.6.2 — a direct-mutation caller (bypassing maintenanceSchema.parse() in the
// browser hook) must still hit the same business-constraint bounds server-side.
describe("maintenanceWrites — field bounds (R-8.6.2)", () => {
  test("rejects a title over the 200-char bound on create", async () => {
    const t = makeT(); await seed(t); await seedAsset(t, "as1", "AVAILABLE");
    await expect(
      t.withIdentity(asUser).mutation(api.maintenanceWrites.createNative, {
        ...baseCreate, status: "SCHEDULED", title: "T".repeat(201),
      }),
    ).rejects.toThrow(/title/);
  });

  test("rejects a negative cost on create", async () => {
    const t = makeT(); await seed(t); await seedAsset(t, "as1", "AVAILABLE");
    await expect(
      t.withIdentity(asUser).mutation(api.maintenanceWrites.createNative, {
        ...baseCreate, status: "SCHEDULED", cost: -1,
      }),
    ).rejects.toThrow(/cost/);
  });

  test("rejects more than 20 photos on create", async () => {
    const t = makeT(); await seed(t); await seedAsset(t, "as1", "AVAILABLE");
    await expect(
      t.withIdentity(asUser).mutation(api.maintenanceWrites.createNative, {
        ...baseCreate, status: "SCHEDULED", photos: Array.from({ length: 21 }, (_, i) => `https://x/${i}.jpg`),
      }),
    ).rejects.toThrow(/photos/);
  });

  test("rejects partsUsed over the 2000-char bound on create", async () => {
    const t = makeT(); await seed(t); await seedAsset(t, "as1", "AVAILABLE");
    await expect(
      t.withIdentity(asUser).mutation(api.maintenanceWrites.createNative, {
        ...baseCreate, status: "SCHEDULED", partsUsed: "p".repeat(2001),
      }),
    ).rejects.toThrow(/partsUsed/);
  });

  test("rejects a description over the 5000-char bound on the update patch", async () => {
    const t = makeT(); await seed(t); await seedAsset(t, "as1", "AVAILABLE");
    await t.withIdentity(asUser).mutation(api.maintenanceWrites.createNative, { ...baseCreate, status: "SCHEDULED" });
    await expect(
      t.withIdentity(asUser).mutation(api.maintenanceWrites.updateNative, {
        orgId: ORG, id: "rec1", type: "REPAIR", status: "SCHEDULED", title: "Fix drill",
        description: "d".repeat(5001), assetLinks: [{ id: "lnk1", assetId: "as1" }], now: NOW, actor, auditId: "a2",
      }),
    ).rejects.toThrow(/description/);
  });
});

describe("maintenanceWrites.createNative — webhook gating", () => {
  async function seedHook(t: T) {
    await t.run(async (ctx) => {
      await ctx.db.insert("webhooks", {
        id: "wh1", organizationId: ORG, description: "d", url: "https://x", secret: "s",
        events: JSON.stringify(["maintenance.created"]), isActive: true, createdById: USER, createdAt: NOW,
      });
    });
  }
  const deliveries = (t: T) => t.run(async (ctx) => ctx.db.query("webhookDeliveries").withIndex("by_organizationId", (q) => q.eq("organizationId", ORG)).collect());

  test("enqueues a PENDING delivery when emitSideEffects is true", async () => {
    const t = makeT(); await seed(t); await seedAsset(t, "as1", "AVAILABLE"); await seedHook(t);
    await t.withIdentity(asUser).mutation(api.maintenanceWrites.createNative, { ...baseCreate, status: "SCHEDULED", emitSideEffects: true });
    const d = await deliveries(t);
    expect(d).toHaveLength(1);
    expect(d[0].event).toBe("maintenance.created");
    expect(d[0].status).toBe("PENDING");
  });

  test("does NOT enqueue when emitSideEffects is omitted", async () => {
    const t = makeT(); await seed(t); await seedAsset(t, "as1", "AVAILABLE"); await seedHook(t);
    await t.withIdentity(asUser).mutation(api.maintenanceWrites.createNative, { ...baseCreate, status: "SCHEDULED" });
    expect(await deliveries(t)).toHaveLength(0);
  });
});

describe("maintenanceWrites.updateNative — transitions", () => {
  // Helper: create a fresh record via the native mutation, holding the asset if needed.
  async function createRec(t: T, status: string, opts: { assetStatus?: string; recordId?: string } = {}) {
    await seed(t); await seedAsset(t, "as1", opts.assetStatus ?? "AVAILABLE");
    await t.withIdentity(asUser).mutation(api.maintenanceWrites.createNative, { ...baseCreate, recordId: opts.recordId ?? "rec1", status: status as "SCHEDULED" });
  }

  test("removing an asset RELEASES it (record keeps ≥1)", async () => {
    const t = makeT();
    await seed(t); await seedAsset(t, "as1", "AVAILABLE"); await seedAsset(t, "as2", "AVAILABLE");
    await t.withIdentity(asUser).mutation(api.maintenanceWrites.createNative, {
      ...baseCreate, status: "IN_PROGRESS",
      assetLinks: [{ id: "lnk1", assetId: "as1" }, { id: "lnk2", assetId: "as2" }],
    });
    expect((await asset(t, "as1"))?.status).toBe("IN_MAINTENANCE");
    expect((await asset(t, "as2"))?.status).toBe("IN_MAINTENANCE");
    // Remove as1, keep as2.
    await t.withIdentity(asUser).mutation(api.maintenanceWrites.updateNative, {
      orgId: ORG, id: "rec1", type: "REPAIR", status: "IN_PROGRESS", title: "Fix drill",
      assetLinks: [{ id: "lnk2", assetId: "as2" }], now: NOW, actor, auditId: "a2",
    });
    expect((await asset(t, "as1"))?.status).toBe("AVAILABLE"); // released
    expect((await asset(t, "as2"))?.status).toBe("IN_MAINTENANCE"); // still held
    expect((await linksFor(t, "rec1")).map((l) => l.assetId)).toEqual(["as2"]);
  });

  test("rejects an update that would remove ALL assets (parity: record keeps ≥1)", async () => {
    const t = makeT(); await createRec(t, "IN_PROGRESS");
    await expect(
      t.withIdentity(asUser).mutation(api.maintenanceWrites.updateNative, {
        orgId: ORG, id: "rec1", type: "REPAIR", status: "IN_PROGRESS", title: "Fix drill",
        assetLinks: [], now: NOW, actor, auditId: "a2",
      }),
    ).rejects.toThrow();
    // Atomic rollback: the asset stays held and its link is intact.
    expect((await asset(t, "as1"))?.status).toBe("IN_MAINTENANCE");
    expect(await linksFor(t, "rec1")).toHaveLength(1);
  });

  test("rejects reusing a link id for a DIFFERENT asset (collision)", async () => {
    const t = makeT(); await createRec(t, "IN_PROGRESS"); await seedAsset(t, "as2", "AVAILABLE");
    // lnk1 already links (rec1, as1); reusing it for as2 must be rejected (would drop the link).
    await expect(
      t.withIdentity(asUser).mutation(api.maintenanceWrites.updateNative, {
        orgId: ORG, id: "rec1", type: "REPAIR", status: "IN_PROGRESS", title: "Fix drill",
        assetLinks: [{ id: "lnk1", assetId: "as1" }, { id: "lnk1", assetId: "as2" }], now: NOW, actor, auditId: "a2",
      }),
    ).rejects.toThrow();
  });

  test("entering a holding status HOLDS the assets", async () => {
    const t = makeT(); await createRec(t, "SCHEDULED"); // as1 stays AVAILABLE
    expect((await asset(t, "as1"))?.status).toBe("AVAILABLE");
    await t.withIdentity(asUser).mutation(api.maintenanceWrites.updateNative, {
      orgId: ORG, id: "rec1", type: "REPAIR", status: "IN_PROGRESS", title: "Fix drill",
      assetLinks: [{ id: "lnk1", assetId: "as1" }], now: NOW, actor, auditId: "a2",
    });
    expect((await asset(t, "as1"))?.status).toBe("IN_MAINTENANCE");
  });

  test("COMPLETED-PASS from a holding status RELEASES the remaining assets", async () => {
    const t = makeT(); await createRec(t, "IN_PROGRESS");
    await t.withIdentity(asUser).mutation(api.maintenanceWrites.updateNative, {
      orgId: ORG, id: "rec1", type: "REPAIR", status: "COMPLETED", result: "PASS", title: "Fix drill",
      assetLinks: [{ id: "lnk1", assetId: "as1" }], now: NOW, actor, auditId: "a2",
    });
    expect((await asset(t, "as1"))?.status).toBe("AVAILABLE");
  });

  test("COMPLETED-FAIL leaves the asset IN_MAINTENANCE (does NOT release)", async () => {
    const t = makeT(); await createRec(t, "IN_PROGRESS");
    await t.withIdentity(asUser).mutation(api.maintenanceWrites.updateNative, {
      orgId: ORG, id: "rec1", type: "REPAIR", status: "COMPLETED", result: "FAIL", title: "Fix drill",
      assetLinks: [{ id: "lnk1", assetId: "as1" }], now: NOW, actor, auditId: "a2",
    });
    expect((await asset(t, "as1"))?.status).toBe("IN_MAINTENANCE");
  });

  test("rejects a cross-org record", async () => {
    const t = makeT(); await seed(t);
    await t.run(async (ctx) => {
      await ctx.db.insert("maintenanceRecords", { id: "recF", organizationId: OTHER, type: "REPAIR", status: "IN_PROGRESS", title: "f", createdAt: NOW, updatedAt: NOW });
    });
    await expect(
      t.withIdentity(asUser).mutation(api.maintenanceWrites.updateNative, {
        orgId: ORG, id: "recF", type: "REPAIR", status: "COMPLETED", title: "x", assetLinks: [], now: NOW, actor, auditId: "a2",
      }),
    ).rejects.toThrow(/not found/i);
  });
});

describe("maintenanceWrites.deleteNative", () => {
  test("releases held assets, cascades links, deletes the record", async () => {
    const t = makeT(); await seed(t); await seedAsset(t, "as1", "AVAILABLE");
    await t.withIdentity(asUser).mutation(api.maintenanceWrites.createNative, { ...baseCreate, status: "IN_PROGRESS" });
    expect((await asset(t, "as1"))?.status).toBe("IN_MAINTENANCE");
    await t.withIdentity(asUser).mutation(api.maintenanceWrites.deleteNative, { orgId: ORG, id: "rec1", now: NOW, actor, auditId: "a3" });
    expect(await rec(t, "rec1")).toBeNull();
    expect(await linksFor(t, "rec1")).toHaveLength(0);
    expect((await asset(t, "as1"))?.status).toBe("AVAILABLE");
    const log = await t.run(async (ctx) => ctx.db.query("activityLogs").withIndex("by_cuid", (q) => q.eq("id", "a3")).first());
    expect(log?.action).toBe("DELETE");
  });

  test("does NOT release when another holding record still holds the asset", async () => {
    const t = makeT(); await seed(t); await seedAsset(t, "as1", "IN_MAINTENANCE");
    await t.run(async (ctx) => {
      await ctx.db.insert("maintenanceRecords", { id: "recHold", organizationId: ORG, type: "REPAIR", status: "QA", title: "held", createdAt: NOW, updatedAt: NOW });
      await ctx.db.insert("maintenanceRecordAssets", { id: "lnkHold", maintenanceRecordId: "recHold", assetId: "as1" });
      await ctx.db.insert("maintenanceRecords", { id: "rec1", organizationId: ORG, type: "REPAIR", status: "IN_PROGRESS", title: "mine", createdAt: NOW, updatedAt: NOW });
      await ctx.db.insert("maintenanceRecordAssets", { id: "lnk1", maintenanceRecordId: "rec1", assetId: "as1" });
    });
    await t.withIdentity(asUser).mutation(api.maintenanceWrites.deleteNative, { orgId: ORG, id: "rec1", now: NOW, actor, auditId: "a3" });
    expect((await asset(t, "as1"))?.status).toBe("IN_MAINTENANCE");
  });

  test("rejects a cross-org record", async () => {
    const t = makeT(); await seed(t);
    await t.run(async (ctx) => {
      await ctx.db.insert("maintenanceRecords", { id: "recF", organizationId: OTHER, type: "REPAIR", status: "IN_PROGRESS", title: "f", createdAt: NOW, updatedAt: NOW });
    });
    await expect(
      t.withIdentity(asUser).mutation(api.maintenanceWrites.deleteNative, { orgId: ORG, id: "recF", now: NOW, actor, auditId: "a3" }),
    ).rejects.toThrow(/not found/i);
  });
});
