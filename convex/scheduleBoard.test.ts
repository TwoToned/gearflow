// @vitest-environment node
//
// convex/scheduleBoard.ts `jobs` (UX Phase 18): the Schedule's Jobs read. The
// clash words come from the Overbookings board's own claim math; the read is
// bounded by ONE ReadBudget and says so (`truncated`, clash `unknown`). The
// query takes its range as args and never reads the clock, so a fixed NOW is
// safe here (no `resolveNow` clamp).
import { convexTest, type TestConvex } from "convex-test";
import { register as registerRateLimiter } from "@convex-dev/rate-limiter/test";
import { describe, test, expect, beforeAll, afterAll } from "vitest";
import { rolePermissions } from "./lib/permissionsCore";
import schema from "./schema";
import { api } from "./_generated/api";
import { loadSchedule, SCHEDULE_LIMITS } from "./lib/scheduleFetch";
import { deriveGearGrid } from "./lib/gearGrid";
import { deriveJobFacts } from "./lib/scheduleBoard";

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
      id: j.id, organizationId: org, projectNumber: `#${j.id}`, name: `Job ${j.id}`, status: j.status === "NONE" ? undefined : (j.status as "CONFIRMED"),
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

const NO_JOBS = "test-no-jobs";
beforeAll(() => {
  rolePermissions[NO_JOBS] = { ...rolePermissions.member, project: [] };
});
afterAll(() => {
  delete rolePermissions[NO_JOBS];
});

describe("scheduleBoard.jobs: who may read it", () => {
  test("a role without project read, and a user who is not in the org, are refused", async () => {
    const t = makeT();
    await seedBase(t, 1);
    await t.run((ctx) => ctx.db.insert("members", { id: "m2", organizationId: ORG, userId: "user_2", role: NO_JOBS }));
    await expect(t.withIdentity({ subject: "user_2", orgId: ORG }).query(api.scheduleBoard.jobs, { orgId: ORG, startMs: START, endMs: END })).rejects.toThrow();
    await expect(t.withIdentity({ subject: "user_3", orgId: ORG }).query(api.scheduleBoard.jobs, { orgId: ORG, startMs: START, endMs: END })).rejects.toThrow();
    await expect(jobsOf(t)).resolves.toBeTruthy();
  });
});

describe("scheduleBoard.jobs: clash words", () => {
  test("a finished or cancelled job stays none and takes no stock from anyone", async () => {
    const t = makeT();
    await seedBase(t, 1);
    await seedJob(t, { id: "closed", status: "RETURNED", from: NOW, to: NOW + 2 * DAY, lines: [{ qty: 1 }] });
    await seedJob(t, { id: "dropped", status: "CANCELLED", from: NOW, to: NOW + 2 * DAY, lines: [{ qty: 1 }] });
    await seedJob(t, { id: "live", status: "CONFIRMED", from: NOW, to: NOW + 2 * DAY, lines: [{ qty: 1 }] });
    const res = await jobsOf(t);
    const by = Object.fromEntries(res.jobs.map((j) => [j.id, j]));
    expect(by.closed.clash).toBe("none");
    expect(by.dropped).toBeUndefined();
    expect(by.live.clash).toBe("none");
  });

  test("a job reads the same in Week and Month: a clash outside the week still counts", async () => {
    const t = makeT();
    await seedBase(t, 1);
    // `short` is created second so it is the one that does not fit; the other
    // job it collides with is only on the 20th, outside the 9-15 week.
    await seedJob(t, { id: "first", status: "CONFIRMED", from: NOW + 11 * DAY, to: NOW + 11 * DAY, lines: [{ qty: 1 }] });
    await seedJob(t, { id: "long", status: "CONFIRMED", from: NOW, to: NOW + 20 * DAY, lines: [{ qty: 1 }] });
    const week = await t.withIdentity(asUser).query(api.scheduleBoard.jobs, { orgId: ORG, startMs: NOW, endMs: NOW + 7 * DAY - 1 });
    const month = await t.withIdentity(asUser).query(api.scheduleBoard.jobs, { orgId: ORG, startMs: NOW, endMs: NOW + 30 * DAY });
    expect(week.jobs.find((j) => j.id === "long")?.clash).toBe("clash");
    expect(month.jobs.find((j) => j.id === "long")?.clash).toBe("clash");
    expect(week.jobs.find((j) => j.id === "long")?.clashes[0].short).toBe(month.jobs.find((j) => j.id === "long")?.clashes[0].short);
  });

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

  test("an ancient QUOTED job's would-clash depends on the alive scan reaching pencilled statuses", async () => {
    const t = makeT();
    await seedBase(t, 1);
    await seedJob(t, { id: "ancient", status: "QUOTED", from: NOW - 900 * DAY, to: NOW + 2 * DAY, lines: [{ qty: 1 }] });
    for (let i = 0; i < 6; i++) await seedJob(t, { id: `old${i}`, status: "RETURNED", from: NOW - (100 + i) * DAY, to: NOW - (99 + i) * DAY });
    await seedJob(t, { id: "held", status: "CONFIRMED", from: NOW + 1 * DAY, to: NOW + 3 * DAY, lines: [{ qty: 1 }] });
    const read = await load(t, { older: 2 });
    expect(read.visible).toEqual(["ancient", "held"]);
    expect(read.facts.ancient.state).toBe("wouldClash");
  });

  test("a job with NO status is alive to the board (pencilled), so the schedule reads it too: its demand is never missed", async () => {
    const t = makeT();
    await seedBase(t, 1);
    await seedJob(t, { id: "nostatus", status: "NONE", from: NOW - 900 * DAY, to: NOW + 2 * DAY, lines: [{ qty: 1 }] });
    for (let i = 0; i < 6; i++) await seedJob(t, { id: `old${i}`, status: "RETURNED", from: NOW - (100 + i) * DAY, to: NOW - (99 + i) * DAY });
    await seedJob(t, { id: "held", status: "CONFIRMED", from: NOW + 1 * DAY, to: NOW + 3 * DAY, lines: [{ qty: 1 }] });
    const read = await load(t, { older: 2 });
    expect(read.visible).toEqual(["held", "nostatus"]);
    expect(read.facts.nostatus.state).toBe("wouldClash");
    // and the Gear grid counts its unit as pencilled demand
    const grid = await t.withIdentity(asUser).query(api.scheduleBoard.grid, { orgId: ORG, startMs: START, endMs: START + 3 * DAY });
    expect(grid.rows[0].claims.map((c) => `${c.projectId}:${c.layer}`).sort()).toEqual(["held:hard", "nostatus:pencilled"]);
  });

  test("claimsComplete: false alone makes every job unknown, even when its lines were read in full", () => {
    const base = {
      range: { start: NOW, end: NOW + DAY },
      projects: [{ id: "a", status: "CONFIRMED", name: "A", projectNumber: "#a", rentalStartDate: NOW, rentalEndDate: NOW + DAY }],
      lines: [{ id: "l", projectId: "a", modelId: "mdl", quantity: 1, status: "CONFIRMED", type: "EQUIPMENT" }],
      unreadProjectIds: new Set<string>(),
      models: [{ id: "mdl", name: "EM4", assetType: "SERIALIZED" }],
      assets: [{ modelId: "mdl", status: "AVAILABLE" }],
      bulkAssets: [],
      unknownModelIds: new Set<string>(),
    };
    expect(deriveJobFacts({ ...base, claimsComplete: true }).get("a")?.state).toBe("none");
    expect(deriveJobFacts({ ...base, claimsComplete: false }).get("a")?.state).toBe("unknown");
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

  test("a spent budget that leaves lines unread is truncated, and the exact-spend case is unread (never read as complete)", async () => {
    const t = makeT();
    await seedBase(t, 2);
    await seedJob(t, { id: "a", status: "CONFIRMED", from: NOW, to: NOW + 1 * DAY, lines: [{ qty: 1 }, { qty: 1 }] });
    // 2 project reads leave exactly 2 documents: the job's 2 lines would spend it to zero.
    const read = await load(t, { reads: 4 });
    expect(read.facts.a.lineCount).toBeNull();
    expect(read.facts.a.state).toBe("unknown");
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

describe("scheduleBoard.grid: the free count per model per day", () => {
  const dayStarts = [0, 1, 2, 3, 4].map((i) => NOW + i * DAY);
  const gridOf = (t: T) => t.withIdentity(asUser).query(api.scheduleBoard.grid, { orgId: ORG, startMs: START, endMs: START + 4 * DAY });
  /** The grid through `loadSchedule` with limits, as plain data: per row, which cells are unknown. */
  const unknownCells = (t: T, limits: Partial<typeof SCHEDULE_LIMITS>) =>
    t.run(async (ctx) => {
      const r = await loadSchedule(ctx, ORG, { start: START, end: START + 4 * DAY }, { ...SCHEDULE_LIMITS, ...limits });
      return { complete: r.claimsComplete, rows: deriveGearGrid(r.inputs, dayStarts).map((row) => row.cells.map((c) => c.unknown)) };
    });

  test("free = stock - held; short on a hard overage; pencilled risk only when it would take the free count below zero", async () => {
    const t = makeT();
    await seedBase(t, 2);
    await seedJob(t, { id: "a", status: "CONFIRMED", from: NOW, to: NOW + 2 * DAY, lines: [{ qty: 2 }] });
    await seedJob(t, { id: "b", status: "CONFIRMED", from: NOW + 1 * DAY, to: NOW + 1 * DAY, lines: [{ qty: 1 }] });
    await seedJob(t, { id: "p", status: "QUOTED", from: NOW + 3 * DAY, to: NOW + 3 * DAY, lines: [{ qty: 2 }] });
    await seedJob(t, { id: "q", status: "QUOTED", from: NOW, to: NOW, lines: [{ qty: 2 }] });
    const res = await gridOf(t);
    expect(res.rows).toHaveLength(1);
    const cells = res.rows[0].cells;
    // day 0: A holds 2 (free 0); Q pencils 2 with nothing free: at risk 2
    expect(cells[0]).toMatchObject({ unknown: false, free: 0, held: 2, short: 0, pencilled: 2, atRisk: 2 });
    // day 1: A 2 + B 1 over 2 in stock: short 1
    expect(cells[1]).toMatchObject({ free: -1, held: 3, short: 1 });
    // day 3: P pencils 2 against 2 free: fits, no risk
    expect(cells[3]).toMatchObject({ free: 2, held: 0, pencilled: 2, atRisk: 0 });
    expect(cells[4]).toMatchObject({ free: 2, held: 0, short: 0 });
    expect(res.rows[0]).toMatchObject({ owned: 2, inService: 0, unknown: false });
    expect(res.rows[0].claims.map((c) => `${c.projectId}:${c.layer}:${c.qty}`).sort()).toEqual(["a:hard:2", "b:hard:1", "p:pencilled:2", "q:pencilled:2"]);
  });

  test("it agrees with the job words: a day is short where a held job says clash, at risk where a pencilled one would clash", async () => {
    const t = makeT();
    await seedBase(t, 1);
    await seedJob(t, { id: "a", status: "CONFIRMED", from: NOW, to: NOW + 1 * DAY, lines: [{ qty: 1 }] });
    await seedJob(t, { id: "b", status: "CONFIRMED", from: NOW + 1 * DAY, to: NOW + 2 * DAY, lines: [{ qty: 1 }] });
    await seedJob(t, { id: "c", status: "QUOTED", from: NOW + 4 * DAY, to: NOW + 4 * DAY, lines: [{ qty: 1 }, { qty: 1 }] });
    const [grid, jobs] = await Promise.all([gridOf(t), jobsOf(t)]);
    const shortDays = grid.rows[0].cells.map((c, i) => (c.short > 0 ? i : -1)).filter((i) => i >= 0);
    expect(shortDays).toEqual([1]);
    expect(jobs.jobs.find((j) => j.id === "b")?.clash).toBe("clash");
    expect(jobs.jobs.find((j) => j.id === "a")?.clash).toBe("none");
    expect(grid.rows[0].cells[4].atRisk).toBe(1);
    expect(jobs.jobs.find((j) => j.id === "c")?.clash).toBe("wouldClash");
  });

  test("off-inventory units hold no stock, and units out of service shrink it", async () => {
    const t = makeT();
    await seedBase(t, 3);
    await t.run((ctx) => ctx.db.insert("assets", { id: "AM", organizationId: ORG, modelId: "mdl", assetTag: "A-M", status: "IN_MAINTENANCE" }));
    await seedJob(t, { id: "c", status: "CONFIRMED", from: NOW, to: NOW, lines: [{ qty: 4, off: 1 }] });
    const row = (await gridOf(t)).rows[0];
    expect(row).toMatchObject({ owned: 4, inService: 1 });
    expect(row.cells[0]).toMatchObject({ held: 3, free: 0, short: 0 });
  });

  test("a cell whose inputs were cut is unknown, never a number", async () => {
    const t = makeT();
    await seedBase(t, 2);
    await seedJob(t, { id: "a", status: "CONFIRMED", from: NOW, to: NOW + 1 * DAY, lines: [{ qty: 1 }] });
    await seedJob(t, { id: "big", status: "CONFIRMED", from: NOW + 2 * DAY, to: NOW + 3 * DAY, lines: [{ qty: 1 }, { qty: 1 }, { qty: 1 }] });
    // `big` has more lines than the cap: its days are blind for every model; `a`'s days still read.
    const blind = await unknownCells(t, { perProjectLines: 2 });
    expect(blind.rows[0]).toEqual([false, false, true, true, false]);
    // the alive scan cut: nothing is a number
    const cut = await unknownCells(t, { reads: 1 });
    expect(cut.complete).toBe(false);
    expect(cut.rows.every((r) => r.every(Boolean))).toBe(true);
  });

  test("another org's jobs never reach the grid, and a role without project read is refused", async () => {
    const t = makeT();
    await seedBase(t, 1);
    await seedJob(t, { id: "theirs", status: "CONFIRMED", from: NOW, to: NOW, lines: [{ qty: 1 }], org: "org_2" });
    expect((await gridOf(t)).rows).toHaveLength(0);
    await t.run((ctx) => ctx.db.insert("members", { id: "m2", organizationId: ORG, userId: "user_2", role: NO_JOBS }));
    await expect(t.withIdentity({ subject: "user_2", orgId: ORG }).query(api.scheduleBoard.grid, { orgId: ORG, startMs: START, endMs: END })).rejects.toThrow();
  });

  test("a model whose stock is beyond the per-model unit cap is unknown in the grid and in the job words", async () => {
    const t = makeT();
    await seedBase(t, 3);
    await seedJob(t, { id: "a", status: "CONFIRMED", from: NOW, to: NOW, lines: [{ qty: 1 }] });
    const r = await unknownCells(t, { perModelUnits: 2 });
    expect(r.rows[0].every(Boolean)).toBe(true);
    const facts = await load(t, { perModelUnits: 2 });
    expect(facts.facts.a.state).toBe("unknown");
    // within the cap the same job is a plain known cell
    expect((await unknownCells(t, { perModelUnits: 5 })).rows[0].some(Boolean)).toBe(false);
  });

  test("a model the budget could not read has no doc to name: the row says Model not loaded and every cell is unknown", async () => {
    const t = makeT();
    await seedBase(t, 1);
    await seedJob(t, { id: "a", status: "CONFIRMED", from: NOW, to: NOW + 1 * DAY, lines: [{ qty: 1 }] });
    const rows = await t.run(async (ctx) => {
      const r = await loadSchedule(ctx, ORG, { start: START, end: START + 4 * DAY }, { ...SCHEDULE_LIMITS, reads: 5 });
      return deriveGearGrid(r.inputs, dayStarts).map((g) => ({ name: g.name, unknown: g.unknown, cells: g.cells.map((c) => c.unknown) }));
    });
    expect(rows).toEqual([{ name: "Model not loaded", unknown: true, cells: [true, true, true, true, true] }]);
  });

  test("another org's units, lines and models never count: a foreign unit does not add stock, a foreign line holds nothing, a foreign model is not read", async () => {
    const t = makeT();
    await seedBase(t, 1);
    await seedJob(t, { id: "a", status: "CONFIRMED", from: NOW, to: NOW, lines: [{ qty: 2 }] });
    await t.run(async (ctx) => {
      // five units of the SAME model id, owned by another org
      for (let i = 0; i < 5; i++) await ctx.db.insert("assets", { id: `F${i}`, organizationId: "org_2", modelId: "mdl", assetTag: `F-${i}`, status: "AVAILABLE" });
      // a foreign line planted on OUR job's live version
      await ctx.db.insert("projectLineItems", { id: "FL", organizationId: "org_2", projectId: "a", modelId: "mdl", status: "CONFIRMED", quantity: 9, type: "EQUIPMENT", versionId: "v-a", lineageId: "FL" });
      // a foreign model doc with a name that must never be shown
      await ctx.db.insert("models", { id: "mdl_x", organizationId: "org_2", name: "Their secret model", assetType: "SERIALIZED" });
      await ctx.db.insert("projectLineItems", { id: "XL", organizationId: ORG, projectId: "a", modelId: "mdl_x", status: "CONFIRMED", quantity: 1, type: "EQUIPMENT", versionId: "v-a", lineageId: "XL" });
    });
    const res = await gridOf(t);
    const ours = res.rows.find((r) => r.modelId === "mdl")!;
    // 1 own unit, 2 held: short 1 (the 5 foreign units and the 9 foreign units of demand count for nothing)
    expect(ours).toMatchObject({ owned: 1, unknown: false });
    expect(ours.cells[0]).toMatchObject({ held: 2, short: 1 });
    // bulk stock is org-filtered too: 1 own unit, 5 foreign, 2 held
    await t.run(async (ctx) => {
      await ctx.db.insert("models", { id: "mb", organizationId: ORG, name: "Cable", assetType: "BULK" });
      await ctx.db.insert("bulkAssets", { id: "B1", organizationId: ORG, modelId: "mb", assetTag: "B-1", totalQuantity: 1 });
      await ctx.db.insert("bulkAssets", { id: "B2", organizationId: "org_2", modelId: "mb", assetTag: "B-2", totalQuantity: 5 });
      await ctx.db.insert("projectLineItems", { id: "BL", organizationId: ORG, projectId: "a", modelId: "mb", status: "CONFIRMED", quantity: 2, type: "EQUIPMENT", versionId: "v-a", lineageId: "BL" });
    });
    const bulk = (await gridOf(t)).rows.find((r) => r.modelId === "mb")!;
    expect(bulk).toMatchObject({ owned: 1 });
    expect(bulk.cells[0]).toMatchObject({ held: 2, short: 1 });
    // the foreign model is never read: no row carries its name
    expect(JSON.stringify(res)).not.toContain("Their secret model");
    expect(res.rows.find((r) => r.modelId === "mdl_x")).toMatchObject({ name: "Model not loaded", unknown: true });
  });
});

describe("scheduleBoard: an API key reads only with project scope (requireOrgReadFor's scope intersection)", () => {
  const KEY = "key_1";
  const asAgent = { subject: USER, orgId: ORG, akid: KEY };
  async function seedKey(t: T, scopes: string[]) {
    await seedBase(t, 1);
    await t.run((ctx) =>
      ctx.db.insert("apiKeys", {
        id: KEY, organizationId: ORG, name: "k", prefix: "gf_live_aaaaaa", tokenHash: "h",
        scopes: JSON.stringify(scopes), isActive: true, actingUserId: USER, createdById: USER,
      }),
    );
  }

  test("a key without project scope is refused by jobs and by grid; a project:read key is served", async () => {
    const t = makeT();
    await seedKey(t, ["asset:read"]);
    await expect(t.withIdentity(asAgent).query(api.scheduleBoard.jobs, { orgId: ORG, startMs: START, endMs: END })).rejects.toThrow(/scope/i);
    await expect(t.withIdentity(asAgent).query(api.scheduleBoard.grid, { orgId: ORG, startMs: START, endMs: END })).rejects.toThrow(/scope/i);
    const ok = makeT();
    await seedKey(ok, ["project:read"]);
    await expect(ok.withIdentity(asAgent).query(api.scheduleBoard.jobs, { orgId: ORG, startMs: START, endMs: END })).resolves.toBeTruthy();
    await expect(ok.withIdentity(asAgent).query(api.scheduleBoard.grid, { orgId: ORG, startMs: START, endMs: END })).resolves.toBeTruthy();
  });
});
