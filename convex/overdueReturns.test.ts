// @vitest-environment node
//
// Overdue returns: the ONE definition (convex/lib/overdueReturns.ts, UX Phase 11
// D85/D86) read by Home's tile (dashboardStats.bundle), the Jobs list's
// `overdue=1` filter (projects.listPage) and the Jobs "Needs you" set. Pins that
// the three agree, that the tile counts jobs with lines as its sub-line, the
// bounds, and that another org's overdue job never counts.
import { convexTest, type TestConvex } from "convex-test";
import { register as registerRateLimiter } from "@convex-dev/rate-limiter/test";
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";
import { OVERDUE_PROBE_CAP, isOverdueCandidate, overdueReturnsFromRows, returnDueAt } from "./lib/overdueReturns";

const modules = import.meta.glob("./**/*.ts");
type T = TestConvex<typeof schema>;

const ORG = "org_1";
const OTHER = "org_2";
const USER = "user_1";
const asUser = { subject: USER, orgId: ORG };
const NOW = Date.UTC(2026, 10, 21);
const DAY = 24 * 60 * 60 * 1000;

beforeAll(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
});
afterAll(() => vi.useRealTimers());

function makeT(): T {
  const t = convexTest(schema, modules);
  registerRateLimiter(t, "rateLimiter");
  return t;
}

type Line = { status: string };

async function job(
  t: T,
  id: string,
  status: string,
  extra: Record<string, unknown>,
  lines: Line[] = [],
  org = ORG,
) {
  await t.run(async (ctx) => {
    await ctx.db.insert("projects", {
      id,
      organizationId: org,
      projectNumber: `P-${id}`,
      name: `Job ${id}`,
      status: status as never,
      isTemplate: false,
      liveVersionId: `v-${id}`,
      ...extra,
    });
    for (const [i, l] of lines.entries()) {
      await ctx.db.insert("projectLineItems", {
        id: `${id}-l${i}`,
        organizationId: org,
        projectId: id,
        status: l.status as never,
        quantity: 1,
        versionId: `v-${id}`,
        lineageId: `${id}-l${i}`,
      });
    }
  });
}

const OUT: Line = { status: "CHECKED_OUT" };
const BACK: Line = { status: "RETURNED" };

async function seed(t: T) {
  await t.run(async (ctx) => {
    await ctx.db.insert("members", { id: "m1", organizationId: ORG, userId: USER, role: "owner" });
  });
  // Overdue: Out past its end with gear out (2 lines out, 1 back).
  await job(t, "late", "CHECKED_OUT", { rentalEndDate: NOW - 2 * DAY }, [OUT, OUT, BACK]);
  // Overdue: part-deployed PREPPING job past its end (status never reached Out).
  await job(t, "partial", "PREPPING", { rentalEndDate: NOW - DAY }, [OUT, { status: "CONFIRMED" }]);
  // Overdue via the projectEndDate fallback (no rental window).
  await job(t, "projend", "ON_SITE", { projectEndDate: NOW - DAY }, [OUT]);
  // NOT overdue: Out past its end but every line is back.
  await job(t, "allback", "CHECKED_OUT", { rentalEndDate: NOW - 3 * DAY }, [BACK, BACK]);
  // NOT overdue: gear out but the end is still ahead.
  await job(t, "ontime", "CHECKED_OUT", { rentalEndDate: NOW + 2 * DAY }, [OUT]);
  // NOT overdue: terminal status, template, no end date, no live version.
  await job(t, "closed", "COMPLETED", { rentalEndDate: NOW - 9 * DAY }, [OUT]);
  await job(t, "tmpl", "CHECKED_OUT", { rentalEndDate: NOW - 9 * DAY, isTemplate: true }, [OUT]);
  await job(t, "nodate", "CHECKED_OUT", {}, [OUT]);
  await job(t, "noversion", "CHECKED_OUT", { rentalEndDate: NOW - 9 * DAY, liveVersionId: undefined });
  // Another org's overdue job must never count.
  await job(t, "foreign", "CHECKED_OUT", { rentalEndDate: NOW - 5 * DAY }, [OUT, OUT], OTHER);
}

const OVERDUE = ["late", "partial", "projend"];

describe("pure rules", () => {
  test("due date falls back to the project end", () => {
    expect(returnDueAt({ rentalEndDate: 5, projectEndDate: 9 })).toBe(5);
    expect(returnDueAt({ projectEndDate: 9 })).toBe(9);
    expect(returnDueAt({})).toBeUndefined();
  });

  test("a candidate is open, dated in the past, not a template, with a live version", () => {
    const p = { status: "PREPPING", rentalEndDate: NOW - 1, liveVersionId: "v" } as const;
    expect(isOverdueCandidate(p, NOW)).toBe(true);
    expect(isOverdueCandidate({ ...p, status: "RETURNED" }, NOW)).toBe(false);
    expect(isOverdueCandidate({ ...p, isTemplate: true }, NOW)).toBe(false);
    expect(isOverdueCandidate({ ...p, rentalEndDate: NOW + 1 }, NOW)).toBe(false);
    expect(isOverdueCandidate({ ...p, liveVersionId: undefined }, NOW)).toBe(false);
  });
});

describe("one definition, three readers", () => {
  test("Home's tile counts jobs; lines are the sub-line", async () => {
    const t = makeT();
    await seed(t);
    const s = await t.withIdentity(asUser).query(api.dashboardStats.bundle, { orgId: ORG, now: NOW });
    expect(s.overdueReturnJobs).toBe(3);
    expect(s.overdueReturns).toBe(4); // late 2 + partial 1 + projend 1
    expect(s.overdueTruncated).toBe(false);
  });

  test("the Jobs overdue filter lists exactly the tile's jobs", async () => {
    const t = makeT();
    await seed(t);
    const page = await t.withIdentity(asUser).query(api.projects.listPage, { orgId: ORG, now: NOW, overdue: true });
    expect(page.items.map((p) => p.id).sort()).toEqual(OVERDUE);
    expect(page.total).toBe(3);
  });

  test("Needs you carries the same overdue jobs", async () => {
    const t = makeT();
    await seed(t);
    const ids = await t.withIdentity(asUser).query(api.projects.needsYouIds, { orgId: ORG, now: NOW });
    for (const id of OVERDUE) expect(ids).toContain(id);
    expect(ids).not.toContain("allback");
    expect(ids).not.toContain("ontime");
    expect(ids).not.toContain("foreign");
  });

  test("a caller from another org is rejected", async () => {
    const t = makeT();
    await seed(t);
    const other = { subject: "user_x", orgId: OTHER };
    await expect(t.withIdentity(other).query(api.dashboardStats.bundle, { orgId: ORG, now: NOW })).rejects.toThrow();
    await expect(t.withIdentity(other).query(api.projects.listPage, { orgId: ORG, now: NOW, overdue: true })).rejects.toThrow();
  });
});

describe("bounds", () => {
  test("past the probe cap the count is a lower bound and says so; the oldest drop first", async () => {
    const t = makeT();
    await t.run(async (ctx) => {
      await ctx.db.insert("members", { id: "m1", organizationId: ORG, userId: USER, role: "owner" });
      for (let i = 0; i < OVERDUE_PROBE_CAP; i++) {
        await ctx.db.insert("projects", {
          id: `c${i}`, organizationId: ORG, projectNumber: `C${i}`, name: `C${i}`, status: "CONFIRMED",
          isTemplate: false, liveVersionId: `v-c${i}`, rentalEndDate: NOW - DAY - i,
        });
      }
    });
    // The one job with gear out ended before every other candidate: past the cap it is not probed.
    await job(t, "oldest", "CHECKED_OUT", { rentalEndDate: NOW - 400 * DAY }, [OUT]);
    const s = await t.withIdentity(asUser).query(api.dashboardStats.bundle, { orgId: ORG, now: NOW });
    expect(s.overdueTruncated).toBe(true);
    expect(s.overdueReturnJobs).toBe(0);
  });
});

describe("overdue returns — read budget", () => {
  /** A fake ctx that records each line probe's take(n) and hands back that many out lines. */
  function probeCtx() {
    const takes: number[] = [];
    const ctx = {
      db: {
        query: () => ({ withIndex: () => ({ take: async (n: number) => (takes.push(n), Array.from({ length: Math.min(n, 3) }, () => ({}))) }) }),
      },
    } as unknown as Parameters<typeof overdueReturnsFromRows>[0];
    return { ctx, takes };
  }
  const rows = ["a", "b"].map((id) => ({
    id, isTemplate: false, status: "CHECKED_OUT", rentalEndDate: NOW - DAY, liveVersionId: `v-${id}`,
  })) as unknown as Parameters<typeof overdueReturnsFromRows>[1];

  test("presence only (Jobs filter, Needs you, More sheet): ONE line per job", async () => {
    const { ctx, takes } = probeCtx();
    const r = await overdueReturnsFromRows(ctx, rows, NOW);
    expect(takes).toEqual([1, 1]);
    expect([...r.projectIds].sort()).toEqual(["a", "b"]);
  });

  test("the Home tile counts the lines (its sub-line), capped", async () => {
    const { ctx, takes } = probeCtx();
    const r = await overdueReturnsFromRows(ctx, rows, NOW, { countLines: true });
    expect(takes).toEqual([1001, 1001]);
    expect(r.lineCount).toBe(6);
  });
});
