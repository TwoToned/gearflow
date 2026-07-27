// @vitest-environment node
//
// Hotfix for #940 (WS1 — finance model): strips the deprecated
// `projects.depositPercent` field so it can eventually be fully removed from
// the schema validator. See convex/backfillStripProjectDepositPercent.ts.
import { convexTest } from "convex-test";
import { describe, test, expect } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";

const modules = import.meta.glob("./**/*.ts");
const ORG = "org_1";
const NOW = 1_700_000_000_000;
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
      await t.withIdentity(SERVICE).mutation(
        api.backfillStripProjectDepositPercent.backfillStripProjectDepositPercentPage,
        { cursor, apply },
      );
    scanned += r.scanned;
    updated += r.updated;
    if (r.isDone) break;
    cursor = r.continueCursor;
  }
  return { scanned, updated };
}
const projById = (t: T, id: string) => t.run(async (ctx) => ctx.db.query("projects").withIndex("by_cuid", (q) => q.eq("id", id)).first());

describe("backfillStripProjectDepositPercent — removes the deprecated field", () => {
  test("strips depositPercent from a project that has it", async () => {
    const t = makeT();
    await t.run(async (ctx) => {
      await ctx.db.insert("projects", project("p1", { depositPercent: 0 }));
    });
    const { scanned, updated } = await runBackfill(t);
    expect(scanned).toBe(1);
    expect(updated).toBe(1);
    const p = await projById(t, "p1");
    expect(p?.depositPercent).toBeUndefined();
  });

  test("a project without depositPercent is skipped", async () => {
    const t = makeT();
    await t.run(async (ctx) => {
      await ctx.db.insert("projects", project("p1"));
    });
    const { scanned, updated } = await runBackfill(t);
    expect(scanned).toBe(0);
    expect(updated).toBe(0);
  });

  test("re-running the backfill strips nothing new", async () => {
    const t = makeT();
    await t.run(async (ctx) => { await ctx.db.insert("projects", project("p1", { depositPercent: 25 })); });
    expect((await runBackfill(t)).updated).toBe(1);
    expect((await runBackfill(t)).updated).toBe(0);
  });

  test("dry-run scans but writes nothing", async () => {
    const t = makeT();
    await t.run(async (ctx) => { await ctx.db.insert("projects", project("p1", { depositPercent: 10 })); });
    const { scanned, updated } = await runBackfill(t, false);
    expect(scanned).toBe(1);
    expect(updated).toBe(0);
    const p = await projById(t, "p1");
    expect(p?.depositPercent).toBe(10);
  });
});
