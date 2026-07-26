// @vitest-environment node
//
// convex/reservationConflicts.ts (projectConflicts / swapCandidates) + the browser-direct
// swapLineItemAsset mutation. Verifies conflict detection over the org booking graph
// (line + unit bookings, overlap math, dead-status exclusion), swap-candidate filtering,
// the atomic double-booking guard, RBAC, cross-tenant isolation, and audit.
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
const DAY = 86_400_000;
const actor = { userId: USER, userName: "Alice" };
const asUser = { subject: USER, orgId: ORG };

function makeT(): T {
  const t = convexTest(schema, modules);
  registerRateLimiter(t, "rateLimiter");
  return t;
}

/**
 * Two projects (P1, P2) with overlapping windows, one model with two assets. A1 is
 * booked on P1 (line.assetId) — the conflict fixture double-books A1 onto P2 too.
 */
async function seed(t: T, opts: { p2Status?: "CONFIRMED" | "CANCELLED"; p2Overlaps?: boolean; org?: string } = {}) {
  const org = opts.org ?? ORG;
  await t.run(async (ctx) => {
    await ctx.db.insert("members", { id: "m1", organizationId: ORG, userId: USER, role: "owner" });
    await ctx.db.insert("models", { id: "mdl", organizationId: org, name: "IMX6A" });
    await ctx.db.insert("assets", { id: "A1", organizationId: org, modelId: "mdl", assetTag: "A-1", status: "AVAILABLE" });
    await ctx.db.insert("assets", { id: "A2", organizationId: org, modelId: "mdl", assetTag: "A-2", status: "AVAILABLE" });
    await ctx.db.insert("projects", {
      id: "P1", organizationId: org, projectNumber: "P1", name: "Gig One", status: "CONFIRMED",
      isTemplate: false, rentalStartDate: NOW, rentalEndDate: NOW + 5 * DAY, createdAt: NOW, updatedAt: NOW,
    });
    const p2Start = opts.p2Overlaps === false ? NOW + 10 * DAY : NOW + 2 * DAY;
    await ctx.db.insert("projects", {
      id: "P2", organizationId: org, projectNumber: "P2", name: "Gig Two", status: opts.p2Status ?? "CONFIRMED",
      isTemplate: false, rentalStartDate: p2Start, rentalEndDate: p2Start + 3 * DAY, createdAt: NOW, updatedAt: NOW,
    });
    // A1 booked on P1 (the project we inspect).
    await ctx.db.insert("projectLineItems", { id: "L1", organizationId: org, projectId: "P1", modelId: "mdl", assetId: "A1", status: "CONFIRMED", quantity: 1, type: "EQUIPMENT" });
    // A1 ALSO booked on P2 — the conflicting booking.
    await ctx.db.insert("projectLineItems", { id: "L2", organizationId: org, projectId: "P2", modelId: "mdl", assetId: "A1", status: "CONFIRMED", quantity: 1, type: "EQUIPMENT" });
  });
}

describe("projectConflicts", () => {
  test("detects a double-booked asset on an overlapping live project", async () => {
    const t = makeT(); await seed(t);
    const conflicts = await t.withIdentity(asUser).query(api.reservationConflicts.projectConflicts, { projectId: "P1" });
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].lineItemId).toBe("L1");
    expect(conflicts[0].assetTag).toBe("A-1");
    expect(conflicts[0].conflictingProject.projectNumber).toBe("P2");
    expect(conflicts[0].conflictingLineItemId).toBe("L2");
  });

  test("no conflict when the other project's window does not overlap", async () => {
    const t = makeT(); await seed(t, { p2Overlaps: false });
    expect(await t.withIdentity(asUser).query(api.reservationConflicts.projectConflicts, { projectId: "P1" })).toEqual([]);
  });

  test("no conflict when the other project is in a dead status", async () => {
    const t = makeT(); await seed(t, { p2Status: "CANCELLED" });
    expect(await t.withIdentity(asUser).query(api.reservationConflicts.projectConflicts, { projectId: "P1" })).toEqual([]);
  });

  // WS2 (#941) — a candidate's PROJECT window (not its rental window) decides overlap.
  test("detects a conflict via the OTHER project's project window when its rental window doesn't overlap", async () => {
    const t = makeT(); await seed(t, { p2Overlaps: false });
    await t.run(async (ctx) => {
      const p2 = await ctx.db.query("projects").withIndex("by_cuid", (q) => q.eq("id", "P2")).first();
      if (p2) await ctx.db.patch(p2._id, { projectStartDate: NOW, projectEndDate: NOW + 3 * DAY });
    });
    const conflicts = await t.withIdentity(asUser).query(api.reservationConflicts.projectConflicts, { projectId: "P1" });
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].conflictingProject.projectNumber).toBe("P2");
  });

  test("no conflict for a dateless project", async () => {
    const t = makeT(); await seed(t);
    await t.run(async (ctx) => {
      const p = await ctx.db.query("projects").withIndex("by_cuid", (q) => q.eq("id", "P1")).first();
      if (p) await ctx.db.patch(p._id, { rentalStartDate: undefined, rentalEndDate: undefined });
    });
    expect(await t.withIdentity(asUser).query(api.reservationConflicts.projectConflicts, { projectId: "P1" })).toEqual([]);
  });

  test("cross-tenant: a caller cannot read another org's project conflicts", async () => {
    const t = makeT(); await seed(t, { org: OTHER });
    await expect(
      t.withIdentity(asUser).query(api.reservationConflicts.projectConflicts, { projectId: "P1" }),
    ).rejects.toThrow(/Forbidden|organization/i);
  });
});

describe("swapCandidates", () => {
  test("returns free same-model assets, excluding the current + booked ones", async () => {
    const t = makeT(); await seed(t);
    // A2 is free; A1 is the current asset on L1. Candidates for L1 → [A2].
    const candidates = await t.withIdentity(asUser).query(api.reservationConflicts.swapCandidates, { lineItemId: "L1" });
    expect(candidates.map((c) => c.assetId)).toEqual(["A2"]);
  });

  test("excludes an asset booked on an overlapping project, and kit/retired assets", async () => {
    const t = makeT(); await seed(t);
    await t.run(async (ctx) => {
      // A2 booked on the overlapping P2 → not free.
      await ctx.db.insert("projectLineItems", { id: "L3", organizationId: ORG, projectId: "P2", modelId: "mdl", assetId: "A2", status: "CONFIRMED", quantity: 1, type: "EQUIPMENT" });
      // A3 same model but retired; A4 in a kit — both excluded.
      await ctx.db.insert("assets", { id: "A3", organizationId: ORG, modelId: "mdl", assetTag: "A-3", status: "RETIRED" });
      await ctx.db.insert("assets", { id: "A4", organizationId: ORG, modelId: "mdl", assetTag: "A-4", status: "AVAILABLE", kitId: "k1" });
    });
    const candidates = await t.withIdentity(asUser).query(api.reservationConflicts.swapCandidates, { lineItemId: "L1" });
    expect(candidates.map((c) => c.assetId)).toEqual([]);
  });

  test("cross-tenant: cannot read another org's swap candidates", async () => {
    const t = makeT(); await seed(t, { org: OTHER });
    await expect(
      t.withIdentity(asUser).query(api.reservationConflicts.swapCandidates, { lineItemId: "L1" }),
    ).rejects.toThrow(/Forbidden|organization/i);
  });
});

describe("swapLineItemAsset (browser-direct)", () => {
  test("reassigns the line item, writes an audit row", async () => {
    const t = makeT(); await seed(t);
    const res = await t.withIdentity(asUser).mutation(api.projectLineItems.swapLineItemAsset, {
      organizationId: ORG, lineItemId: "L1", newAssetId: "A2", now: NOW, actor, auditId: "a1",
    });
    expect(res).toEqual({ lineItemId: "L1", assetId: "A2" });
    const line = await t.run(async (ctx) => ctx.db.query("projectLineItems").withIndex("by_cuid", (q) => q.eq("id", "L1")).first());
    expect(line?.assetId).toBe("A2");
    const audit = await t.run(async (ctx) => ctx.db.query("activityLogs").withIndex("by_cuid", (q) => q.eq("id", "a1")).first());
    expect(audit?.entityType).toBe("project");
    expect(audit?.userId).toBe(USER);
  });

  test("rejects swapping onto an asset already booked in the window (atomic guard)", async () => {
    const t = makeT(); await seed(t);
    await t.run(async (ctx) => {
      // A2 booked on the overlapping P2 → swapping L1 onto A2 must be refused.
      await ctx.db.insert("projectLineItems", { id: "L3", organizationId: ORG, projectId: "P2", modelId: "mdl", assetId: "A2", status: "CONFIRMED", quantity: 1, type: "EQUIPMENT" });
    });
    await expect(
      t.withIdentity(asUser).mutation(api.projectLineItems.swapLineItemAsset, {
        organizationId: ORG, lineItemId: "L1", newAssetId: "A2", now: NOW, actor, auditId: "a1",
      }),
    ).rejects.toThrow(/already booked/i);
  });

  // WS2 (#941) — the double-booking guard reads the candidate's PROJECT window too.
  test("rejects swapping onto an asset booked on a project whose RENTAL window doesn't overlap but PROJECT window does", async () => {
    const t = makeT(); await seed(t, { p2Overlaps: false });
    await t.run(async (ctx) => {
      await ctx.db.insert("projectLineItems", { id: "L3", organizationId: ORG, projectId: "P2", modelId: "mdl", assetId: "A2", status: "CONFIRMED", quantity: 1, type: "EQUIPMENT" });
      const p2 = await ctx.db.query("projects").withIndex("by_cuid", (q) => q.eq("id", "P2")).first();
      if (p2) await ctx.db.patch(p2._id, { projectStartDate: NOW, projectEndDate: NOW + 3 * DAY });
    });
    await expect(
      t.withIdentity(asUser).mutation(api.projectLineItems.swapLineItemAsset, {
        organizationId: ORG, lineItemId: "L1", newAssetId: "A2", now: NOW, actor, auditId: "a1",
      }),
    ).rejects.toThrow(/already booked/i);
  });

  test("rejects a member without project:manage_line_items", async () => {
    const t = makeT(); await seed(t);
    await t.run(async (ctx) => {
      const m = await ctx.db.query("members").withIndex("by_cuid", (q) => q.eq("id", "m1")).first();
      if (m) await ctx.db.patch(m._id, { role: "viewer" });
    });
    await expect(
      t.withIdentity({ subject: USER, orgId: ORG, role: "viewer" }).mutation(api.projectLineItems.swapLineItemAsset, {
        organizationId: ORG, lineItemId: "L1", newAssetId: "A2", now: NOW, actor, auditId: "a1",
      }),
    ).rejects.toThrow(/Forbidden|permission/i);
  });

  test("cross-tenant: cannot swap a line item in another org", async () => {
    const t = makeT(); await seed(t, { org: OTHER });
    await expect(
      t.withIdentity(asUser).mutation(api.projectLineItems.swapLineItemAsset, {
        organizationId: ORG, lineItemId: "L1", newAssetId: "A2", now: NOW, actor, auditId: "a1",
      }),
    ).rejects.toThrow(/not found|Forbidden|organization/i);
  });
});
