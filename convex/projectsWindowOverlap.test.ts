// @vitest-environment node
//
// projects.windowOverlap: the wizard's dates-and-availability line and the
// calendar's busy-day dots. Org isolation, the window rule (project window else
// rental), exclusions, and a cap applied AFTER the filter with the true total.
import { convexTest, type TestConvex } from "convex-test";
import { register as registerRateLimiter } from "@convex-dev/rate-limiter/test";
import { describe, test, expect } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";

const modules = import.meta.glob("./**/*.ts");
type T = TestConvex<typeof schema>;

const ORG = "org_1";
const asUser = { subject: "user_1", orgId: ORG };
const DAY = 86_400_000;
const D0 = Date.UTC(2026, 11, 1);

function makeT(): T {
  const t = convexTest(schema, modules);
  registerRateLimiter(t, "rateLimiter");
  return t;
}

type Seed = { id: string; org?: string; status?: string; isTemplate?: boolean; rental?: [number, number]; window?: [number, number] };
async function seed(t: T, rows: Seed[]) {
  await t.run(async (ctx) => {
    await ctx.db.insert("members", { id: "m1", organizationId: ORG, userId: "user_1", role: "owner" });
    for (const r of rows) {
      await ctx.db.insert("projects", {
        id: r.id, organizationId: r.org ?? ORG, projectNumber: `#${r.id}`, name: r.id,
        status: (r.status ?? "CONFIRMED") as "CONFIRMED", isTemplate: r.isTemplate ?? false,
        ...(r.rental ? { rentalStartDate: r.rental[0], rentalEndDate: r.rental[1] } : {}),
        ...(r.window ? { projectStartDate: r.window[0], projectEndDate: r.window[1] } : {}),
      });
    }
  });
}
const run = (t: T, over: Partial<{ start: number; end: number; excludeProjectId: string }> = {}) =>
  t.withIdentity(asUser).query(api.projects.windowOverlap, { orgId: ORG, start: D0 + 2 * DAY, end: D0 + 4 * DAY, ...over });

describe("projects.windowOverlap", () => {
  test("finds overlapping jobs, using the project window over the rental window", async () => {
    const t = makeT();
    await seed(t, [
      { id: "in", rental: [D0 + 3 * DAY, D0 + 5 * DAY] },
      { id: "before", rental: [D0, D0 + DAY] },
      { id: "rentalOutsideWindowInside", rental: [D0, D0 + DAY], window: [D0 + 3 * DAY, D0 + 3 * DAY] },
      { id: "dateless" },
    ]);
    const r = await run(t);
    expect(r.jobs.map((j) => j.id).sort()).toEqual(["in", "rentalOutsideWindowInside"]);
    expect(r.total).toBe(2);
  });

  test("excludes the job itself, templates and cancelled jobs; marks hard-hold statuses", async () => {
    const t = makeT();
    const w: [number, number] = [D0 + 3 * DAY, D0 + 3 * DAY];
    await seed(t, [
      { id: "self", rental: w },
      { id: "tpl", rental: w, isTemplate: true },
      { id: "gone", rental: w, status: "CANCELLED" },
      { id: "soft", rental: w, status: "ENQUIRY" },
      { id: "hard", rental: w, status: "CONFIRMED" },
    ]);
    const r = await run(t, { excludeProjectId: "self" });
    expect(r.jobs.map((j) => [j.id, j.hard]).sort()).toEqual([["hard", true], ["soft", false]]);
  });

  test("never returns another org's jobs", async () => {
    const t = makeT();
    await seed(t, [{ id: "mine", rental: [D0 + 3 * DAY, D0 + 3 * DAY] }, { id: "theirs", org: "org_2", rental: [D0 + 3 * DAY, D0 + 3 * DAY] }]);
    expect((await run(t)).jobs.map((j) => j.id)).toEqual(["mine"]);
  });

  test("caps the rows after the filter and reports the true total", async () => {
    const t = makeT();
    const w: [number, number] = [D0 + 3 * DAY, D0 + 3 * DAY];
    await seed(t, [
      ...Array.from({ length: 55 }, (_, i) => ({ id: `j${i}`, rental: w })),
      { id: "far", rental: [D0 + 60 * DAY, D0 + 61 * DAY] as [number, number] },
    ]);
    const r = await run(t);
    expect(r.jobs).toHaveLength(50);
    expect(r.total).toBe(55);
  });

  test("a caller from another org is refused", async () => {
    const t = makeT();
    await seed(t, []);
    await expect(t.withIdentity({ subject: "user_9", orgId: "org_2" }).query(api.projects.windowOverlap, { orgId: ORG, start: D0, end: D0 + DAY })).rejects.toThrow();
  });
});
