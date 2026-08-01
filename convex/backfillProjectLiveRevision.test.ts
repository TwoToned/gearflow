// @vitest-environment node
//
// #1080/#1085 backfill: stamps `projects.liveRevision` onto every non-template
// project that doesn't have one yet. Belt-and-braces (projectLiveRevision()
// already coalesces to `revision` on read) — see
// convex/backfillProjectLiveRevision.ts.
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
    isTemplate: false, revision: 1, createdAt: NOW, updatedAt: NOW, ...extra,
  };
}

async function runBackfill(t: T, apply = true) {
  let cursor: string | null = null;
  let scanned = 0;
  let updated = 0;
  for (;;) {
    const r: { scanned: number; updated: number; isDone: boolean; continueCursor: string } =
      await t.withIdentity(SERVICE).mutation(
        api.backfillProjectLiveRevision.backfillProjectLiveRevisionPage,
        { cursor, apply },
      );
    scanned += r.scanned;
    updated += r.updated;
    if (r.isDone) break;
    cursor = r.continueCursor;
  }
  return { scanned, updated };
}

async function verify(t: T) {
  let cursor: string | null = null;
  let nonTemplateProjects = 0;
  let projectsMissingLiveRevision = 0;
  for (;;) {
    const r: {
      nonTemplateProjects: number;
      projectsMissingLiveRevision: number;
      isDone: boolean;
      continueCursor: string;
    } = await t.withIdentity(SERVICE).query(api.backfillProjectLiveRevision.verifyProjectLiveRevision, { cursor });
    nonTemplateProjects += r.nonTemplateProjects;
    projectsMissingLiveRevision += r.projectsMissingLiveRevision;
    if (r.isDone) break;
    cursor = r.continueCursor;
  }
  return { nonTemplateProjects, projectsMissingLiveRevision };
}

const projById = (t: T, id: string) => t.run(async (ctx) => ctx.db.query("projects").withIndex("by_cuid", (q) => q.eq("id", id)).first());

describe("backfillProjectLiveRevision — stamps liveRevision from revision", () => {
  test("stamps liveRevision onto a project missing it", async () => {
    const t = makeT();
    await t.run(async (ctx) => { await ctx.db.insert("projects", project("p1", { revision: 3 })); });

    const { scanned, updated } = await runBackfill(t);
    expect(scanned).toBe(1);
    expect(updated).toBe(1);
    expect((await projById(t, "p1"))?.liveRevision).toBe(3);
  });

  test("defaults to 1 when revision itself is absent", async () => {
    const t = makeT();
    await t.run(async (ctx) => { await ctx.db.insert("projects", project("p1", { revision: undefined })); });

    await runBackfill(t);
    expect((await projById(t, "p1"))?.liveRevision).toBe(1);
  });

  test("a project that already has liveRevision is skipped", async () => {
    const t = makeT();
    await t.run(async (ctx) => { await ctx.db.insert("projects", project("p1", { revision: 2, liveRevision: 2 })); });

    const { scanned, updated } = await runBackfill(t);
    expect(scanned).toBe(0);
    expect(updated).toBe(0);
  });

  test("templates are skipped entirely", async () => {
    const t = makeT();
    await t.run(async (ctx) => { await ctx.db.insert("projects", project("p1", { isTemplate: true, revision: undefined })); });

    const { scanned } = await runBackfill(t);
    expect(scanned).toBe(0);
    expect((await projById(t, "p1"))?.liveRevision).toBeUndefined();
  });

  test("dry-run scans but writes nothing", async () => {
    const t = makeT();
    await t.run(async (ctx) => { await ctx.db.insert("projects", project("p1", { revision: 4 })); });

    const { scanned, updated } = await runBackfill(t, false);
    expect(scanned).toBe(1);
    expect(updated).toBe(0);
    expect((await projById(t, "p1"))?.liveRevision).toBeUndefined();
  });

  test("re-running the backfill stamps nothing new", async () => {
    const t = makeT();
    await t.run(async (ctx) => { await ctx.db.insert("projects", project("p1")); });
    expect((await runBackfill(t)).updated).toBe(1);
    expect((await runBackfill(t)).updated).toBe(0);
  });

  test("verifyProjectLiveRevision reports zero un-migrated projects after a full apply run", async () => {
    const t = makeT();
    await t.run(async (ctx) => {
      await ctx.db.insert("projects", project("p1", { revision: 1 }));
      await ctx.db.insert("projects", project("p2", { revision: 5 }));
      await ctx.db.insert("projects", project("p3", { isTemplate: true, revision: undefined }));
    });

    expect(await verify(t)).toEqual({ nonTemplateProjects: 2, projectsMissingLiveRevision: 2 });
    await runBackfill(t);
    expect(await verify(t)).toEqual({ nonTemplateProjects: 2, projectsMissingLiveRevision: 0 });
  });
});
