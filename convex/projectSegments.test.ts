// @vitest-environment node
//
// Jobs list segments (UX unification §9b.3): the shared status map, the derived
// "needs you" set (D13), and the listPage filters that use them. Includes the
// cross-tenant case for every new read.
import { convexTest, type TestConvex } from "convex-test";
import { register as registerRateLimiter } from "@convex-dev/rate-limiter/test";
import { describe, test, expect } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";
import { inStatusSegment, isOutPastEnd, matchesJobFilter, overlapsWindow } from "./lib/projectSegments";

const modules = import.meta.glob("./**/*.ts");
type T = TestConvex<typeof schema>;

const ORG = "org_1";
const OTHER = "org_2";
const USER = "user_1";
const asUser = { subject: USER, orgId: ORG };
const NOW = Date.UTC(2026, 10, 19);
const DAY = 24 * 60 * 60 * 1000;

function makeT(): T {
  const t = convexTest(schema, modules);
  registerRateLimiter(t, "rateLimiter");
  return t;
}

const base = (id: string, status: string, extra: Record<string, unknown> = {}) => ({
  id,
  organizationId: ORG,
  projectNumber: `P-${id}`,
  name: `Job ${id}`,
  status: status as never,
  isTemplate: false,
  ...extra,
});

async function seed(t: T) {
  await t.run(async (ctx) => {
    await ctx.db.insert("members", { id: "m1", organizationId: ORG, userId: USER, role: "owner" });
    await ctx.db.insert("clients", { id: "c1", organizationId: ORG, name: "Acme" });
    await ctx.db.insert("projects", base("enq", "ENQUIRY", { clientId: "c1", projectManagerId: "pm1" }));
    // QUOTED, quote sent 20 days ago and untouched: needs you.
    await ctx.db.insert("projects", base("stale", "QUOTED", { updatedAt: NOW - 30 * DAY }));
    // QUOTED, quote sent 2 days ago: fine.
    await ctx.db.insert("projects", base("fresh", "QUOTED", { updatedAt: NOW - 30 * DAY }));
    await ctx.db.insert("projects", base("conf", "CONFIRMED", { rentalStartDate: NOW + 5 * DAY, rentalEndDate: NOW + 7 * DAY }));
    await ctx.db.insert("projects", base("late", "CHECKED_OUT", { rentalEndDate: NOW - 2 * DAY }));
    await ctx.db.insert("projects", base("ontime", "ON_SITE", { rentalEndDate: NOW + 2 * DAY }));
    await ctx.db.insert("projects", base("block", "CONFIRMED"));
    await ctx.db.insert("projects", base("done", "COMPLETED"));
    await ctx.db.insert("projects", base("gone", "CANCELLED"));
    await ctx.db.insert("projects", base("tmpl", "CONFIRMED", { isTemplate: true }));
    await ctx.db.insert("quotes", {
      id: "q-stale", organizationId: ORG, projectId: "stale", version: 1, status: "SENT", snapshot: {}, sentAt: NOW - 20 * DAY,
    });
    await ctx.db.insert("quotes", {
      id: "q-fresh", organizationId: ORG, projectId: "fresh", version: 1, status: "SENT", snapshot: {}, sentAt: NOW - 2 * DAY,
    });
    await ctx.db.insert("commentThreads", {
      orgId: ORG, entityType: "project", entityId: "block", projectId: "block", status: "open", isBlocking: true,
      createdBy: USER, createdByName: "U", createdAt: NOW, updatedAt: NOW,
    });
    // A foreign org's job + blocking thread must never leak into ORG's set.
    await ctx.db.insert("projects", { ...base("foreign", "CHECKED_OUT", { rentalEndDate: NOW - 9 * DAY }), organizationId: OTHER });
    await ctx.db.insert("commentThreads", {
      orgId: OTHER, entityType: "project", entityId: "enq", projectId: "enq", status: "open", isBlocking: true,
      createdBy: "x", createdByName: "X", createdAt: NOW, updatedAt: NOW,
    });
  });
}

describe("pure segment rules", () => {
  test("status segments and the all segment", () => {
    expect(inStatusSegment({ status: "QUOTED" }, "quoting")).toBe(true);
    expect(inStatusSegment({ status: "AWAITING_PAYMENT" }, "booked")).toBe(true);
    expect(inStatusSegment({ status: "ON_SITE" }, "out")).toBe(true);
    expect(inStatusSegment({ status: "INVOICED" }, "done")).toBe(true);
    expect(inStatusSegment({ status: "CANCELLED" }, "all")).toBe(false);
  });

  test("out past end only for CHECKED_OUT / ON_SITE with a passed end", () => {
    expect(isOutPastEnd({ status: "CHECKED_OUT", rentalEndDate: NOW - 1 }, NOW)).toBe(true);
    expect(isOutPastEnd({ status: "CHECKED_OUT", rentalEndDate: NOW + 1 }, NOW)).toBe(false);
    expect(isOutPastEnd({ status: "CONFIRMED", rentalEndDate: NOW - 1 }, NOW)).toBe(false);
    expect(isOutPastEnd({ status: "ON_SITE" }, NOW)).toBe(false);
  });

  test("window overlap treats open ends as matching and undated jobs as not", () => {
    expect(overlapsWindow({ rentalStartDate: 5, rentalEndDate: 9 }, 8, 20)).toBe(true);
    expect(overlapsWindow({ rentalStartDate: 5, rentalEndDate: 9 }, 10, 20)).toBe(false);
    expect(overlapsWindow({}, 1, 2)).toBe(false);
    expect(overlapsWindow({}, undefined, undefined)).toBe(true);
  });

  test("cancelled shows under all only when asked for", () => {
    const p = { status: "CANCELLED", isTemplate: false, id: "x" } as never;
    expect(matchesJobFilter(p, { segment: "all" }, new Set())).toBe(false);
    expect(matchesJobFilter(p, { segment: "all", includeCancelled: true }, new Set())).toBe(true);
    expect(matchesJobFilter(p, { segment: "all", statusIn: ["CANCELLED"] }, new Set())).toBe(true);
  });
});

describe("projects.segmentCounts / needsYouIds", () => {
  test("counts every segment; cancelled and templates are excluded", async () => {
    const t = makeT();
    await seed(t);
    const c = await t.withIdentity(asUser).query(api.projects.segmentCounts, { orgId: ORG, now: NOW });
    expect(c).toEqual({ all: 8, quoting: 3, booked: 2, out: 2, done: 1, needs: 3 });
  });

  test("needs you = stale quote + out past end + blocking thread, never another org's", async () => {
    const t = makeT();
    await seed(t);
    const ids = await t.withIdentity(asUser).query(api.projects.needsYouIds, { orgId: ORG, now: NOW });
    expect(ids).toEqual(["block", "late", "stale"]);
  });

  test("a caller from another org is rejected", async () => {
    const t = makeT();
    await seed(t);
    const other = { subject: "user_x", orgId: OTHER };
    await expect(t.withIdentity(other).query(api.projects.segmentCounts, { orgId: ORG })).rejects.toThrow();
    await expect(t.withIdentity(other).query(api.projects.needsYouIds, { orgId: ORG })).rejects.toThrow();
  });
});

describe("projects.listPage list-page filters", () => {
  const list = (t: T, args: Record<string, unknown>) =>
    t.withIdentity(asUser).query(api.projects.listPage, { orgId: ORG, now: NOW, ...args } as never);

  test("segment narrows; all hides cancelled; needs uses the derived set", async () => {
    const t = makeT();
    await seed(t);
    expect((await list(t, { segment: "booked" })).items.map((p) => p.id).sort()).toEqual(["block", "conf"]);
    expect((await list(t, { segment: "all" })).items.map((p) => p.id)).not.toContain("gone");
    expect((await list(t, { segment: "all", includeCancelled: true })).items.map((p) => p.id)).toContain("gone");
    expect((await list(t, { segment: "needs" })).items.map((p) => p.id).sort()).toEqual(["block", "late", "stale"]);
  });

  test("an unknown segment reads as no segment", async () => {
    const t = makeT();
    await seed(t);
    expect((await list(t, { segment: "bogus" })).total).toBe(9);
  });

  test("clientIn, pmIn and date window filter; client name is searchable", async () => {
    const t = makeT();
    await seed(t);
    expect((await list(t, { clientIn: ["c1"] })).items.map((p) => p.id)).toEqual(["enq"]);
    expect((await list(t, { pmIn: ["pm1"] })).items.map((p) => p.id)).toEqual(["enq"]);
    expect((await list(t, { dateFrom: NOW + 6 * DAY, dateTo: NOW + 30 * DAY })).items.map((p) => p.id)).toEqual(["conf"]);
    expect((await list(t, { search: "acme" })).items.map((p) => p.id)).toEqual(["enq"]);
  });

  test("never returns another org's jobs", async () => {
    const t = makeT();
    await seed(t);
    expect((await list(t, {})).items.map((p) => p.id)).not.toContain("foreign");
  });
});
