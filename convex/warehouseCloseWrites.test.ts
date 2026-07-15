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
