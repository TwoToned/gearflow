// @vitest-environment node
import { convexTest } from "convex-test";
import { describe, test, expect } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";
import { register as registerRateLimiter } from "@convex-dev/rate-limiter/test";
import { register as registerShardedCounter } from "@convex-dev/sharded-counter/test";

const modules = import.meta.glob("./**/*.ts");
function makeT() {
  const t = convexTest(schema, modules);
  registerRateLimiter(t, "rateLimiter");
  registerShardedCounter(t, "shardedCounter");
  return t;
}
const ORG = "org_1";
const USER = "user_1";
const NOW = 1_700_000_000_000;
const asUser = (orgId: string) => ({ subject: USER, orgId });
const ACTOR = { userId: USER, userName: "Alice" };

async function member(t: ReturnType<typeof convexTest>, role: string) {
  await t.run(async (ctx) => {
    await ctx.db.insert("members", { id: "m", organizationId: ORG, userId: USER, role });
  });
}

/** Seed a project + its top-level EQUIPMENT lines (returnCondition per line). */
async function seedProject(
  t: ReturnType<typeof convexTest>,
  opts: {
    projectId: string;
    orgId?: string;
    name?: string;
    isTemplate?: boolean;
    lines?: Array<{ status: string; returnCondition?: string; isKitChild?: boolean; type?: string }>;
  },
) {
  const orgId = opts.orgId ?? ORG;
  await t.run(async (ctx) => {
    await ctx.db.insert("projects", {
      id: opts.projectId,
      organizationId: orgId,
      projectNumber: `PN-${opts.projectId}`,
      name: opts.name ?? "Show",
      isTemplate: opts.isTemplate ?? false,
    });
    let i = 0;
    for (const li of opts.lines ?? []) {
      await ctx.db.insert("projectLineItems", {
        id: `${opts.projectId}_li_${i++}`,
        organizationId: orgId,
        projectId: opts.projectId,
        type: li.type ?? "EQUIPMENT",
        isKitChild: li.isKitChild ?? false,
        status: li.status,
        returnCondition: li.returnCondition,
      });
    }
  });
}

describe("warehouseCloseWrites.closeOutNative", () => {
  const args = {
    id: "wc1",
    orgId: ORG,
    projectId: "p1",
    now: NOW,
    actor: ACTOR,
    auditId: "log1",
  };

  test("member closes out — counts tally, warehouseClose row + UPDATE audit", async () => {
    const t = makeT();
    await member(t, "manager");
    await seedProject(t, {
      projectId: "p1",
      name: "Gala",
      lines: [
        { status: "RETURNED", returnCondition: "GOOD" },
        { status: "RETURNED" }, // no condition → stored
        { status: "RETURNED", returnCondition: "DAMAGED" },
        { status: "RETURNED", returnCondition: "MISSING" },
        { status: "CANCELLED" }, // terminal, not returned → not counted
        { status: "RETURNED", isKitChild: true, returnCondition: "DAMAGED" }, // kit child excluded
      ],
    });
    const res = await t.withIdentity(asUser(ORG)).mutation(api.warehouseCloseWrites.closeOutNative, args);
    expect(res).toEqual({ id: "wc1", storedCount: 2, damagedCount: 1, lostCount: 1 });
    await t.run(async (ctx) => {
      const wc = await ctx.db.query("warehouseCloses").withIndex("by_cuid", (q) => q.eq("id", "wc1")).first();
      expect(wc?.projectId).toBe("p1");
      expect(wc?.closedById).toBe(USER);
      expect(wc?.closedAt).toBe(NOW);
      expect(wc?.storedCount).toBe(2);
      expect(wc?.damagedCount).toBe(1);
      expect(wc?.lostCount).toBe(1);
      const log = await ctx.db.query("activityLogs").withIndex("by_cuid", (q) => q.eq("id", "log1")).first();
      expect(log?.action).toBe("UPDATE");
      expect(log?.entityType).toBe("project");
      expect(log?.entityId).toBe("p1");
      expect(log?.summary).toBe('Closed out warehouse for "Gala" — 2 stored, 1 damaged, 1 lost');
    });
  });

  test("pending (unreturned) items block the close", async () => {
    const t = makeT();
    await member(t, "manager");
    await seedProject(t, {
      projectId: "p1",
      lines: [{ status: "RETURNED", returnCondition: "GOOD" }, { status: "CHECKED_OUT" }],
    });
    await expect(
      t.withIdentity(asUser(ORG)).mutation(api.warehouseCloseWrites.closeOutNative, args),
    ).rejects.toThrow(/Cannot close: 1 item still not returned/i);
    await t.run(async (ctx) => {
      const wc = await ctx.db.query("warehouseCloses").withIndex("by_cuid", (q) => q.eq("id", "wc1")).first();
      expect(wc).toBeNull();
    });
  });

  test("an already-closed project throws", async () => {
    const t = makeT();
    await member(t, "manager");
    await seedProject(t, { projectId: "p1", lines: [{ status: "RETURNED", returnCondition: "GOOD" }] });
    await t.run(async (ctx) => {
      await ctx.db.insert("warehouseCloses", { id: "prior", organizationId: ORG, projectId: "p1", closedById: USER });
    });
    await expect(
      t.withIdentity(asUser(ORG)).mutation(api.warehouseCloseWrites.closeOutNative, args),
    ).rejects.toThrow(/already been closed out/i);
  });

  test("a template project is rejected", async () => {
    const t = makeT();
    await member(t, "manager");
    await seedProject(t, { projectId: "p1", isTemplate: true, lines: [] });
    await expect(
      t.withIdentity(asUser(ORG)).mutation(api.warehouseCloseWrites.closeOutNative, args),
    ).rejects.toThrow(/Project not found/i);
  });

  test("a project in another org is rejected", async () => {
    const t = makeT();
    await member(t, "manager");
    await seedProject(t, { projectId: "p1", orgId: "org_other", lines: [] });
    await expect(
      t.withIdentity(asUser(ORG)).mutation(api.warehouseCloseWrites.closeOutNative, args),
    ).rejects.toThrow(/Project not found/i);
  });

  test("viewer denied", async () => {
    const t = makeT();
    await member(t, "viewer");
    await seedProject(t, { projectId: "p1", lines: [] });
    await expect(
      t.withIdentity(asUser(ORG)).mutation(api.warehouseCloseWrites.closeOutNative, args),
    ).rejects.toThrow(/insufficient permissions/i);
  });
});

describe("warehouseCloseWrites.batchCloseOutNative", () => {
  const batchArgs = (items: Array<{ projectId: string; id: string; auditId: string }>) => ({
    orgId: ORG,
    items,
    now: NOW,
    actor: ACTOR,
    batchAuditId: "batchlog",
  });

  test("partial success — one closes, one fails on pending; batch audit written once", async () => {
    const t = makeT();
    await member(t, "manager");
    await seedProject(t, { projectId: "pOk", name: "Alpha", lines: [{ status: "RETURNED", returnCondition: "GOOD" }] });
    await seedProject(t, { projectId: "pBad", name: "Beta", lines: [{ status: "CHECKED_OUT" }] });

    const res = await t.withIdentity(asUser(ORG)).mutation(
      api.warehouseCloseWrites.batchCloseOutNative,
      batchArgs([
        { projectId: "pOk", id: "wcOk", auditId: "logOk" },
        { projectId: "pBad", id: "wcBad", auditId: "logBad" },
      ]),
    );
    expect(res).toHaveLength(2);
    const ok = res.find((r) => r.projectId === "pOk");
    const bad = res.find((r) => r.projectId === "pBad");
    expect(ok).toMatchObject({ projectName: "Alpha", success: true });
    expect(bad?.success).toBe(false);
    expect(bad?.projectName).toBe("Beta");
    expect(bad?.error).toMatch(/still not returned/i);

    await t.run(async (ctx) => {
      // The good project got a close row + its per-project audit; the bad one did not.
      expect(await ctx.db.query("warehouseCloses").withIndex("by_cuid", (q) => q.eq("id", "wcOk")).first()).not.toBeNull();
      expect(await ctx.db.query("warehouseCloses").withIndex("by_cuid", (q) => q.eq("id", "wcBad")).first()).toBeNull();
      expect(await ctx.db.query("activityLogs").withIndex("by_cuid", (q) => q.eq("id", "logOk")).first()).not.toBeNull();
      expect(await ctx.db.query("activityLogs").withIndex("by_cuid", (q) => q.eq("id", "logBad")).first()).toBeNull();
      // One batch-summary audit (successCount=1 of 2).
      const batchLog = await ctx.db.query("activityLogs").withIndex("by_cuid", (q) => q.eq("id", "batchlog")).first();
      expect(batchLog?.summary).toBe("Batch closed 1 of 2 projects");
      expect(batchLog?.entityName).toBe("Batch close-out");
    });
  });

  test("no batch audit when nothing closes", async () => {
    const t = makeT();
    await member(t, "manager");
    await seedProject(t, { projectId: "pBad", name: "Beta", lines: [{ status: "CHECKED_OUT" }] });
    const res = await t.withIdentity(asUser(ORG)).mutation(
      api.warehouseCloseWrites.batchCloseOutNative,
      batchArgs([{ projectId: "pBad", id: "wcBad", auditId: "logBad" }]),
    );
    expect(res[0].success).toBe(false);
    await t.run(async (ctx) => {
      expect(await ctx.db.query("activityLogs").withIndex("by_cuid", (q) => q.eq("id", "batchlog")).first()).toBeNull();
    });
  });

  test("empty selection throws", async () => {
    const t = makeT();
    await member(t, "manager");
    await expect(
      t.withIdentity(asUser(ORG)).mutation(api.warehouseCloseWrites.batchCloseOutNative, batchArgs([])),
    ).rejects.toThrow(/No projects selected/i);
  });

  test("more than 25 projects throws", async () => {
    const t = makeT();
    await member(t, "manager");
    const items = Array.from({ length: 26 }, (_, i) => ({
      projectId: `p${i}`,
      id: `wc${i}`,
      auditId: `log${i}`,
    }));
    await expect(
      t.withIdentity(asUser(ORG)).mutation(api.warehouseCloseWrites.batchCloseOutNative, batchArgs(items)),
    ).rejects.toThrow(/Maximum 25 projects/i);
  });

  test("viewer denied", async () => {
    const t = makeT();
    await member(t, "viewer");
    await expect(
      t.withIdentity(asUser(ORG)).mutation(
        api.warehouseCloseWrites.batchCloseOutNative,
        batchArgs([{ projectId: "p1", id: "wc1", auditId: "log1" }]),
      ),
    ).rejects.toThrow(/insufficient permissions/i);
  });
});

describe("warehouseCloses.closeOutSummary (browser-direct read)", () => {
  test("categorizes stored/damaged/lost/pending + exceptions + canClose", async () => {
    const t = makeT();
    await member(t, "manager");
    await seedProject(t, {
      projectId: "p1",
      lines: [
        { status: "RETURNED", returnCondition: "GOOD" }, // stored
        { status: "RETURNED", returnCondition: "GOOD" }, // stored
        { status: "RETURNED", returnCondition: "DAMAGED" }, // damaged + exc
        { status: "RETURNED", returnCondition: "MISSING" }, // lost + exc
        { status: "CHECKED_OUT" }, // not returned → pending + exc
        { status: "RETURNED", isKitChild: true, returnCondition: "DAMAGED" }, // kit child excluded
      ],
    });
    const s = await t.withIdentity(asUser(ORG)).query(api.warehouseCloses.closeOutSummary, { orgId: ORG, projectId: "p1" });
    expect(s.totalItems).toBe(5); // kit child excluded
    expect(s.storedCount).toBe(2);
    expect(s.damagedCount).toBe(1);
    expect(s.lostCount).toBe(1);
    expect(s.pendingCount).toBe(1);
    expect(s.canClose).toBe(false); // 1 pending
    expect(s.alreadyClosed).toBe(false);
    expect(s.closedBy).toBeNull();
    expect(s.exceptions).toHaveLength(3); // damaged + lost + pending
  });

  test("alreadyClosed + closedBy resolves from the users mirror (name or null)", async () => {
    const t = makeT();
    await member(t, "manager");
    await seedProject(t, { projectId: "p1", lines: [{ status: "RETURNED", returnCondition: "GOOD" }] });
    await t.run(async (ctx) => {
      await ctx.db.insert("users", { id: USER, name: "Alice", email: "a@x.co" });
      await ctx.db.insert("warehouseCloses", { id: "wc1", organizationId: ORG, projectId: "p1", closedById: USER, closedAt: NOW });
    });
    const s = await t.withIdentity(asUser(ORG)).query(api.warehouseCloses.closeOutSummary, { orgId: ORG, projectId: "p1" });
    expect(s.alreadyClosed).toBe(true);
    expect(s.closedBy).toBe("Alice");
    expect(typeof s.closedAt).toBe("string"); // ISO string, not raw ms
    expect(s.canClose).toBe(true); // all stored
  });

  test("RBAC: warehouse:close required — a member (no close) is rejected", async () => {
    const t = makeT();
    await member(t, "member"); // member role lacks warehouse:close
    await seedProject(t, { projectId: "p1", lines: [] });
    await expect(
      t.withIdentity(asUser(ORG)).query(api.warehouseCloses.closeOutSummary, { orgId: ORG, projectId: "p1" }),
    ).rejects.toThrow();
  });

  test("a project in another org → not found", async () => {
    const t = makeT();
    await member(t, "manager");
    await seedProject(t, { projectId: "pOther", orgId: "org_other", lines: [] });
    await expect(
      t.withIdentity(asUser(ORG)).query(api.warehouseCloses.closeOutSummary, { orgId: ORG, projectId: "pOther" }),
    ).rejects.toThrow();
  });
});

// ─── gearflow#797 follow-up: per-unit-tracked returns and close-out ──────────
// returnLineUnits (convex/lib/fulfillment.ts) only ever patches a UNIT's
// returnCondition, never the LINE's — so for any modern per-unit-tracked item,
// line.returnCondition stayed permanently null. closeOutSummary read that null
// as "still pending" (blocking the close-out tab) while closeOutCore defaulted
// the same null to "GOOD"/stored — a silent audit-trail miscount for anything
// actually returned DAMAGED/MISSING. Fixed by having syncLineItemRollup derive
// the line's returnCondition from its units (deriveOrderLineReturnCondition).
describe("gearflow#797 — per-unit return syncs line.returnCondition", () => {
  const SERVICE = { subject: "gearflow-service", svc: true };

  async function seedDeployedItem(t: ReturnType<typeof convexTest>, id: string) {
    await t.run(async (ctx) => {
      await ctx.db.insert("members", { id: "m1", organizationId: ORG, userId: USER, role: "manager" });
      await ctx.db.insert("projects", { id: "p1", organizationId: ORG, projectNumber: "P-1", name: "Test", createdAt: NOW, updatedAt: NOW });
      await ctx.db.insert("models", { id: "mdl1", organizationId: ORG, name: "Drum Shield", createdAt: NOW, updatedAt: NOW });
      await ctx.db.insert("assets", { id, organizationId: ORG, modelId: "mdl1", assetTag: id.toUpperCase(), status: "CHECKED_OUT", isActive: true, createdAt: NOW, updatedAt: NOW });
      await ctx.db.insert("projectLineItems", {
        id: `L_${id}`, organizationId: ORG, projectId: "p1", type: "EQUIPMENT", modelId: "mdl1", assetId: id,
        quantity: 1, status: "CHECKED_OUT", prepStatus: "PACKED", createdAt: NOW, updatedAt: NOW,
      });
      await ctx.db.insert("projectLineItemUnits", {
        id: `u_${id}`, organizationId: ORG, lineItemId: `L_${id}`, ordinal: 1, assetId: id,
        quantity: 1, returnedQuantity: 0, status: "CHECKED_OUT", prepStatus: "PACKED", createdAt: NOW, updatedAt: NOW,
      });
    });
  }

  test("a GOOD return is not flagged pending and counts as stored", async () => {
    const t = makeT();
    await seedDeployedItem(t, "as1");
    await t.withIdentity(SERVICE).mutation(api.warehouseOps.checkinItems, {
      organizationId: ORG, projectId: "p1", userId: USER,
      items: [{ lineItemId: "L_as1", assetId: "as1", returnCondition: "GOOD" }],
      now: NOW,
    });

    const s = await t.withIdentity(asUser(ORG)).query(api.warehouseCloses.closeOutSummary, { orgId: ORG, projectId: "p1" });
    expect(s.pendingCount).toBe(0);
    expect(s.storedCount).toBe(1);
    expect(s.canClose).toBe(true);

    // The actual close-out mutation must also tally it as stored, not miscount it.
    const res = await t.withIdentity(asUser(ORG)).mutation(api.warehouseCloseWrites.closeOutNative, {
      id: "wc1", orgId: ORG, projectId: "p1", now: NOW, actor: ACTOR, auditId: "log1",
    });
    expect(res.storedCount).toBe(1);
    expect(res.damagedCount).toBe(0);
  });

  test("a DAMAGED return surfaces as an exception, not a silent stored count", async () => {
    const t = makeT();
    await seedDeployedItem(t, "as2");
    await t.withIdentity(SERVICE).mutation(api.warehouseOps.checkinItems, {
      organizationId: ORG, projectId: "p1", userId: USER,
      items: [{ lineItemId: "L_as2", assetId: "as2", returnCondition: "DAMAGED" }],
      now: NOW,
    });

    const s = await t.withIdentity(asUser(ORG)).query(api.warehouseCloses.closeOutSummary, { orgId: ORG, projectId: "p1" });
    expect(s.pendingCount).toBe(0);
    expect(s.damagedCount).toBe(1);
    expect(s.storedCount).toBe(0);
    expect(s.exceptions).toHaveLength(1);

    // Regression: before the fix this silently landed in storedCount (line.returnCondition
    // was null, and closeOutCore's `!li.returnCondition || "GOOD"` default treated null as GOOD).
    const res = await t.withIdentity(asUser(ORG)).mutation(api.warehouseCloseWrites.closeOutNative, {
      id: "wc1", orgId: ORG, projectId: "p1", now: NOW, actor: ACTOR, auditId: "log1",
    });
    expect(res.damagedCount).toBe(1);
    expect(res.storedCount).toBe(0);
  });
});
