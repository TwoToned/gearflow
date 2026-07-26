// @vitest-environment node
//
// WS2 (#941) — two-window date model backfill. Verifies projectStartDate/
// projectStartTime = loadInDate/loadInTime and projectEndDate/projectEndTime =
// loadOutDate/loadOutTime are copied wherever the project* counterpart is unset,
// idempotently, dry-run-safely, and WITHOUT migrating eventStartDate/eventEndDate
// (they have no replacement in the two-window model).
import { convexTest } from "convex-test";
import { describe, test, expect } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";

const modules = import.meta.glob("./**/*.ts");
const ORG = "org_1";
const NOW = 1_700_000_000_000;
const DAY = 86_400_000;
const SERVICE = { subject: "gearflow-service", svc: true };
const makeT = () => convexTest(schema, modules);
type T = ReturnType<typeof makeT>;

function project(id: string, extra: Record<string, unknown> = {}) {
  return {
    id, organizationId: ORG, projectNumber: `P-${id}`, name: "Gig", status: "CONFIRMED" as const,
    createdAt: NOW, updatedAt: NOW, ...extra,
  };
}

async function runBackfill(t: T, apply = true) {
  let cursor: string | null = null;
  let scanned = 0;
  let updated = 0;
  for (;;) {
    const r: { scanned: number; updated: number; isDone: boolean; continueCursor: string } =
      await t.withIdentity(SERVICE).mutation(api.backfillProjectWindow.backfillProjectWindowPage, { cursor, apply });
    scanned += r.scanned;
    updated += r.updated;
    if (r.isDone) break;
    cursor = r.continueCursor;
  }
  return { scanned, updated };
}
const projById = (t: T, id: string) => t.run(async (ctx) => ctx.db.query("projects").withIndex("by_cuid", (q) => q.eq("id", id)).first());

describe("backfillProjectWindow — migrates loadIn/loadOut into the project window", () => {
  test("copies projectStartDate/projectStartTime from loadInDate/loadInTime", async () => {
    const t = makeT();
    await t.run(async (ctx) => {
      await ctx.db.insert("projects", project("p1", { loadInDate: NOW, loadInTime: "09:00" }));
    });
    const { scanned, updated } = await runBackfill(t);
    expect(scanned).toBe(1);
    expect(updated).toBe(1);
    const p = await projById(t, "p1");
    expect(p?.projectStartDate).toBe(NOW);
    expect(p?.projectStartTime).toBe("09:00");
    expect(p?.projectEndDate).toBeUndefined();
  });

  test("copies projectEndDate/projectEndTime from loadOutDate/loadOutTime", async () => {
    const t = makeT();
    await t.run(async (ctx) => {
      await ctx.db.insert("projects", project("p1", { loadOutDate: NOW + DAY, loadOutTime: "17:00" }));
    });
    const { updated } = await runBackfill(t);
    expect(updated).toBe(1);
    const p = await projById(t, "p1");
    expect(p?.projectEndDate).toBe(NOW + DAY);
    expect(p?.projectEndTime).toBe("17:00");
    expect(p?.projectStartDate).toBeUndefined();
  });

  test("copies both sides when both loadIn and loadOut are set", async () => {
    const t = makeT();
    await t.run(async (ctx) => {
      await ctx.db.insert("projects", project("p1", { loadInDate: NOW, loadOutDate: NOW + 3 * DAY }));
    });
    const { updated } = await runBackfill(t);
    expect(updated).toBe(1);
    const p = await projById(t, "p1");
    expect(p?.projectStartDate).toBe(NOW);
    expect(p?.projectEndDate).toBe(NOW + 3 * DAY);
  });

  test("does NOT migrate eventStartDate/eventEndDate — dropped, not backfilled", async () => {
    const t = makeT();
    await t.run(async (ctx) => {
      await ctx.db.insert("projects", project("p1", { eventStartDate: NOW, eventEndDate: NOW + DAY }));
    });
    const { scanned, updated } = await runBackfill(t);
    expect(scanned).toBe(0);
    expect(updated).toBe(0);
    const p = await projById(t, "p1");
    expect(p?.projectStartDate).toBeUndefined();
    expect(p?.projectEndDate).toBeUndefined();
  });

  test("a project with neither loadIn nor loadOut set is skipped (rental-only or dateless)", async () => {
    const t = makeT();
    await t.run(async (ctx) => {
      await ctx.db.insert("projects", project("p1", { rentalStartDate: NOW, rentalEndDate: NOW + DAY }));
      await ctx.db.insert("projects", project("p2"));
    });
    const { scanned, updated } = await runBackfill(t);
    expect(scanned).toBe(0);
    expect(updated).toBe(0);
  });
});

describe("backfillProjectWindow — idempotent + dry-run", () => {
  test("re-running the backfill updates nothing new", async () => {
    const t = makeT();
    await t.run(async (ctx) => { await ctx.db.insert("projects", project("p1", { loadInDate: NOW })); });
    expect((await runBackfill(t)).updated).toBe(1);
    expect((await runBackfill(t)).updated).toBe(0);
  });

  test("dry-run scans but writes nothing", async () => {
    const t = makeT();
    await t.run(async (ctx) => { await ctx.db.insert("projects", project("p1", { loadInDate: NOW, loadOutDate: NOW + DAY })); });
    const { scanned, updated } = await runBackfill(t, false);
    expect(scanned).toBe(1);
    expect(updated).toBe(0);
    const p = await projById(t, "p1");
    expect(p?.projectStartDate).toBeUndefined();
    expect(p?.projectEndDate).toBeUndefined();
  });

  test("never clobbers an already-diverged projectStartDate/projectEndDate", async () => {
    const t = makeT();
    await t.run(async (ctx) => {
      // A project that was already touched by the wizard (explicit project window
      // set) — must NOT be overwritten by the deprecated loadInDate value.
      await ctx.db.insert("projects", project("p1", { loadInDate: NOW - DAY, projectStartDate: NOW + 100 }));
    });
    const { scanned, updated } = await runBackfill(t);
    expect(scanned).toBe(0);
    expect(updated).toBe(0);
    const p = await projById(t, "p1");
    expect(p?.projectStartDate).toBe(NOW + 100);
  });
});
