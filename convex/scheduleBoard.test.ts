// @vitest-environment node
//
// convex/scheduleBoard.ts `jobs` (UX Phase 18): the Schedule's Jobs read. The
// clash words come from the Overbookings board's own claim math; the read is
// bounded by ONE ReadBudget and says so (`truncated`, clash `unknown`). The
// query takes its range as args and never reads the clock, so a fixed NOW is
// safe here (no `resolveNow` clamp).
import { convexTest, type TestConvex } from "convex-test";
import { register as registerRateLimiter } from "@convex-dev/rate-limiter/test";
import { describe, test, expect } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";
import { loadSchedule, SCHEDULE_LIMITS } from "./lib/scheduleFetch";

const modules = import.meta.glob("./**/*.ts");
type T = TestConvex<typeof schema>;

const ORG = "org_1";
const USER = "user_1";
const NOW = 1_700_000_000_000;
const DAY = 86_400_000;
const asUser = { subject: USER, orgId: ORG };
const START = NOW;
const END = NOW + 6 * DAY;

function makeT(): T {
  const t = convexTest(schema, modules);
  registerRateLimiter(t, "rateLimiter");
  return t;
}

interface SeedJob {
  id: string;
  status: string;
  from: number;
  to: number;
  lines?: { qty: number; off?: number; modelId?: string; optional?: boolean }[];
  org?: string;
}

async function seedJob(t: T, j: SeedJob) {
  const org = j.org ?? ORG;
  await t.run(async (ctx) => {
    await ctx.db.insert("projects", {
      id: j.id, organizationId: org, projectNumber: `#${j.id}`, name: `Job ${j.id}`, status: j.status as "CONFIRMED",
      isTemplate: false, rentalStartDate: j.from, rentalEndDate: j.to, createdAt: NOW, updatedAt: NOW, liveVersionId: `v-${j.id}`,
    });
    await ctx.db.insert("projectVersions", { id: `v-${j.id}`, organizationId: org, projectId: j.id, number: 1, contentState: "ready", createdAt: NOW, createdById: "u1" });
    let i = 0;
    for (const l of j.lines ?? []) {
      const id = `L-${j.id}-${i++}`;
      await ctx.db.insert("projectLineItems", {
        id, organizationId: org, projectId: j.id, modelId: l.modelId ?? "mdl", status: "CONFIRMED", quantity: l.qty,
        offInventoryQuantity: l.off, isOptional: l.optional, type: "EQUIPMENT", versionId: `v-${j.id}`, lineageId: id,
      });
    }
  });
}

async function seedBase(t: T, stock = 2) {
  await t.run(async (ctx) => {
    await ctx.db.insert("members", { id: "m1", organizationId: ORG, userId: USER, role: "owner" });
    await ctx.db.insert("models", { id: "mdl", organizationId: ORG, name: "EM4 receiver", assetType: "SERIALIZED" });
    for (let i = 0; i < stock; i++) {
      await ctx.db.insert("assets", { id: `A${i}`, organizationId: ORG, modelId: "mdl", assetTag: `A-${i}`, status: "AVAILABLE" });
    }
  });
}

/** `loadSchedule` through the test DB, as plain (serialisable) data. */
async function load(t: T, limits: Partial<typeof SCHEDULE_LIMITS>) {
  return await t.run(async (ctx) => {
    const r = await loadSchedule(ctx, ORG, { start: START, end: END }, { ...SCHEDULE_LIMITS, ...limits });
    return { visible: r.visible.map((p) => p.id).sort(), truncated: r.truncated, claimsComplete: r.claimsComplete, facts: Object.fromEntries(r.facts) };
  });
}

const jobsOf = (t: T) => t.withIdentity(asUser).query(api.scheduleBoard.jobs, { orgId: ORG, startMs: START, endMs: END });

describe("scheduleBoard.jobs: clash words", () => {
  test("a held job over stock says clash; the one that got there first does not; a pencilled job says would clash", async () => {
    const t = makeT();
    await seedBase(t, 2);
    await seedJob(t, { id: "first", status: "CONFIRMED", from: NOW, to: NOW + 3 * DAY, lines: [{ qty: 2 }] });
    await seedJob(t, { id: "second", status: "CONFIRMED", from: NOW + 1 * DAY, to: NOW + 2 * DAY, lines: [{ qty: 1 }] });
    await seedJob(t, { id: "pencil", status: "QUOTED", from: NOW + 1 * DAY, to: NOW + 2 * DAY, lines: [{ qty: 1 }] });
    await seedJob(t, { id: "clear", status: "QUOTED", from: NOW + 5 * DAY, to: NOW + 6 * DAY, lines: [{ qty: 1 }] });
    const res = await jobsOf(t);
    const by = Object.fromEntries(res.jobs.map((j) => [j.id, j]));
    expect(by.first.clash).toBe("none");
    expect(by.second.clash).toBe("clash");
    expect(by.second.clashes[0]).toMatchObject({ layer: "hard", modelName: "EM4 receiver", short: 1 });
    expect(by.second.clashes[0].with.map((w) => w.id)).toContain("first");
    expect(by.pencil.clash).toBe("wouldClash");
    expect(by.pencil.holds).toBe(false);
    expect(by.clear.clash).toBe("none");
    expect(res.truncated).toBe(false);
  });

  test("off-inventory units hold no stock (stockBackedQty): 3 on a line with 1 off-inventory fits 2 in stock", async () => {
    const t = makeT();
    await seedBase(t, 2);
    await seedJob(t, { id: "custom", status: "CONFIRMED", from: NOW, to: NOW + 1 * DAY, lines: [{ qty: 3, off: 1 }] });
    const res = await jobsOf(t);
    expect(res.jobs[0].clash).toBe("none");
    expect(res.jobs[0].unitCount).toBe(2);
  });

  test("a held job's own optional line never prints a word", async () => {
    const t = makeT();
    await seedBase(t, 1);
    await seedJob(t, { id: "held", status: "CONFIRMED", from: NOW, to: NOW + 1 * DAY, lines: [{ qty: 1 }, { qty: 1, optional: true }] });
    const res = await jobsOf(t);
    expect(res.jobs[0].clash).toBe("none");
  });

  test("a cancelled job and another org's job are not drawn, and another org cannot be read", async () => {
    const t = makeT();
    await seedBase(t, 1);
    await seedJob(t, { id: "gone", status: "CANCELLED", from: NOW, to: NOW + 1 * DAY });
    await seedJob(t, { id: "theirs", status: "CONFIRMED", from: NOW, to: NOW + 1 * DAY, org: "org_2" });
    const res = await jobsOf(t);
    expect(res.jobs).toHaveLength(0);
    await expect(t.withIdentity(asUser).query(api.scheduleBoard.jobs, { orgId: "org_2", startMs: START, endMs: END })).rejects.toThrow();
  });

  test("a range over two months is refused", async () => {
    const t = makeT();
    await seedBase(t, 1);
    await expect(t.withIdentity(asUser).query(api.scheduleBoard.jobs, { orgId: ORG, startMs: START, endMs: START + 90 * DAY })).rejects.toThrow();
  });
});

describe("scheduleBoard: the read is bounded and says so", () => {
    test("older jobs are read nearest the window first: a cut hides the oldest, never one inside the window", async () => {
    const t = makeT();
    await seedBase(t, 2);
    await seedJob(t, { id: "inside", status: "CONFIRMED", from: NOW + 1 * DAY, to: NOW + 2 * DAY });
    // A FINISHED job that started 3 days before the window and ran into it: the nearest older.
    await seedJob(t, { id: "running", status: "RETURNED", from: NOW - 3 * DAY, to: NOW + 2 * DAY });
    // Older history, all ended long before the window.
    for (let i = 0; i < 6; i++) await seedJob(t, { id: `old${i}`, status: "RETURNED", from: NOW - (100 + i) * DAY, to: NOW - (99 + i) * DAY });
    const read = await load(t, { older: 3 });
    expect(read.visible).toEqual(["inside", "running"]);
    // The older allowance ran out before the oldest history: the cut is surfaced.
    expect(read.truncated).toBe(true);
  });

  test("an alive job that started years ago still counts (claims never depend on history), and one that clashes says so", async () => {
    const t = makeT();
    await seedBase(t, 1);
    await seedJob(t, { id: "ancient", status: "CONFIRMED", from: NOW - 900 * DAY, to: NOW + 2 * DAY, lines: [{ qty: 1 }] });
    for (let i = 0; i < 6; i++) await seedJob(t, { id: `old${i}`, status: "RETURNED", from: NOW - (100 + i) * DAY, to: NOW - (99 + i) * DAY });
    await seedJob(t, { id: "later", status: "CONFIRMED", from: NOW + 1 * DAY, to: NOW + 3 * DAY, lines: [{ qty: 1 }] });
    const read = await load(t, { older: 2 });
    expect(read.visible).toEqual(["ancient", "later"]);
    expect(read.claimsComplete).toBe(true);
    expect(read.facts.later.state).toBe("clash");
    expect(read.facts.ancient.state).toBe("none");
  });

  test("when the budget cuts the alive scan, no job is none: the check cannot be trusted", async () => {
    const t = makeT();
    await seedBase(t, 5);
    await seedJob(t, { id: "a", status: "CONFIRMED", from: NOW, to: NOW + 1 * DAY, lines: [{ qty: 1 }] });
    await seedJob(t, { id: "b", status: "CONFIRMED", from: NOW, to: NOW + 1 * DAY, lines: [{ qty: 1 }] });
    const read = await load(t, { reads: 1 });
    expect(read.claimsComplete).toBe(false);
    expect(Object.values(read.facts).every((f) => (f as { state: string }).state !== "none")).toBe(true);
  });

  test("a cut that bites the older jobs still reports every job that starts inside the window", async () => {
    const t = makeT();
    await seedBase(t, 2);
    for (let i = 0; i < 5; i++) await seedJob(t, { id: `in${i}`, status: "QUOTED", from: NOW + i * DAY, to: NOW + i * DAY });
    for (let i = 0; i < 5; i++) await seedJob(t, { id: `old${i}`, status: "RETURNED", from: NOW - (50 + i) * DAY, to: NOW - (49 + i) * DAY });
    const read = await load(t, { older: 1 });
    expect(read.visible).toEqual(["in0", "in1", "in2", "in3", "in4"]);
    expect(read.truncated).toBe(true);
  });

  test("a job whose lines are over the cap is unknown, never none", async () => {
    const t = makeT();
    await seedBase(t, 2);
    await seedJob(t, { id: "big", status: "CONFIRMED", from: NOW, to: NOW + 1 * DAY, lines: [{ qty: 1 }, { qty: 1 }, { qty: 1 }] });
    const read = await load(t, { perProjectLines: 2 });
    expect(read.facts.big.state).toBe("unknown");
    expect(read.facts.big.lineCount).toBeNull();
  });

  test("a model whose stock the budget cannot cover leaves its jobs unknown", async () => {
    const t = makeT();
    await seedBase(t, 1);
    await seedJob(t, { id: "a", status: "CONFIRMED", from: NOW, to: NOW + 1 * DAY, lines: [{ qty: 1 }] });
    await seedJob(t, { id: "b", status: "CONFIRMED", from: NOW + 1, to: NOW + 1 * DAY, lines: [{ qty: 1 }] });
    // 2 projects + 2 lines fit; the model's stock does not: its check cannot run.
    const read = await load(t, { reads: 6 });
    expect(read.facts.a.state).toBe("unknown");
    expect(read.facts.b.state).toBe("unknown");
  });
});
