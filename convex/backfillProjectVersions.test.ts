// @vitest-environment node
//
// convex/backfillProjectVersions.ts — #1226 Phase 1 ("Project versioning
// v2", parent #1221). Verifies: exactly one `projectVersions` row + a
// same-project `liveVersionId` per project (templates included), `number`
// is always 1, every live child row (including the categorySlots
// PARENT_JOIN case) gets `versionId`/`lineageId` stamped, label derivation
// from a sent quote, idempotency on re-run, dry-run writes nothing, and
// cross-tenant safety of the `by_projectId_number`/`by_organizationId`
// read helpers (`convex/lib/projectVersionState.ts`) against a `projectId`
// cuid collision across two orgs.
import { convexTest, type TestConvex } from "convex-test";
import { describe, test, expect } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";
import { assertExpectedProjectCount, BACKFILL_SYSTEM_USER_ID } from "./backfillProjectVersions";
import { listProjectVersions, findVersionByNumber } from "./lib/projectVersionState";

const modules = import.meta.glob("./**/*.ts");
const ORG = "org_1";
const OTHER = "org_2";
const NOW = 1_700_000_000_000;
const SERVICE = { subject: "gearflow-service", svc: true };
type T = TestConvex<typeof schema>;
const makeT = (): T => convexTest(schema, modules);

function project(id: string, orgId: string, extra: Record<string, unknown> = {}) {
  return {
    id,
    organizationId: orgId,
    projectNumber: `P-${id}`,
    name: "Gig",
    status: "CONFIRMED" as const,
    isTemplate: false,
    revision: 1,
    createdAt: NOW,
    updatedAt: NOW,
    ...extra,
  };
}

function category(id: string, orgId: string, projectId: string) {
  return { id, organizationId: orgId, projectId, name: `Cat ${id}`, createdAt: NOW };
}
function group(id: string, orgId: string, projectId: string) {
  return { id, organizationId: orgId, projectId, title: `Group ${id}`, createdAt: NOW };
}
function lineItem(id: string, orgId: string, projectId: string) {
  return { id, organizationId: orgId, projectId, description: `Line ${id}`, createdAt: NOW };
}
function service(id: string, orgId: string, projectId: string) {
  return { id, organizationId: orgId, projectId, type: "LABOUR" as const, title: `Svc ${id}`, createdAt: NOW };
}
function slot(id: string, projectCategoryId: string, sortOrder: number, extra: Record<string, unknown> = {}) {
  return { id, projectCategoryId, sortOrder, createdAt: NOW, ...extra };
}
function quote(id: string, orgId: string, projectId: string, version: number, extra: Record<string, unknown> = {}) {
  return { id, organizationId: orgId, projectId, version, status: "SENT" as const, snapshot: null, ...extra };
}

async function runBackfill(t: T, apply = true) {
  let cursor: string | null = null;
  let scanned = 0;
  let versionsCreated = 0;
  let childRowsStamped = 0;
  for (;;) {
    const r: {
      scanned: number;
      versionsCreated: number;
      childRowsStamped: number;
      isDone: boolean;
      continueCursor: string;
    } = await t.withIdentity(SERVICE).mutation(api.backfillProjectVersions.backfillProjectVersionsPage, { cursor, apply });
    scanned += r.scanned;
    versionsCreated += r.versionsCreated;
    childRowsStamped += r.childRowsStamped;
    if (r.isDone) break;
    cursor = r.continueCursor;
  }
  return { scanned, versionsCreated, childRowsStamped };
}

async function verify(t: T) {
  let cursor: string | null = null;
  const totals = { totalProjects: 0, projectsMissingLiveVersionId: 0, projectsWithBadVersionPointer: 0, projectsWithVersionCountNotOne: 0 };
  for (;;) {
    const r: typeof totals & { isDone: boolean; continueCursor: string } = await t
      .withIdentity(SERVICE)
      .query(api.backfillProjectVersions.verifyProjectVersions, { cursor });
    totals.totalProjects += r.totalProjects;
    totals.projectsMissingLiveVersionId += r.projectsMissingLiveVersionId;
    totals.projectsWithBadVersionPointer += r.projectsWithBadVersionPointer;
    totals.projectsWithVersionCountNotOne += r.projectsWithVersionCountNotOne;
    if (r.isDone) break;
    cursor = r.continueCursor;
  }
  return totals;
}

const projById = (t: T, id: string) =>
  t.run(async (ctx) => ctx.db.query("projects").withIndex("by_cuid", (q) => q.eq("id", id)).first());
const versionByCuid = (t: T, id: string) =>
  t.run(async (ctx) => ctx.db.query("projectVersions").withIndex("by_cuid", (q) => q.eq("id", id)).first());
const lineItemById = (t: T, id: string) =>
  t.run(async (ctx) => ctx.db.query("projectLineItems").withIndex("by_cuid", (q) => q.eq("id", id)).first());
const categoryById = (t: T, id: string) =>
  t.run(async (ctx) => ctx.db.query("projectCategories").withIndex("by_cuid", (q) => q.eq("id", id)).first());
const slotById = (t: T, id: string) =>
  t.run(async (ctx) => ctx.db.query("categorySlots").withIndex("by_cuid", (q) => q.eq("id", id)).first());

describe("backfillProjectVersions — creates one live version per project", () => {
  test("creates a projectVersions row, sets liveVersionId, and stamps every child row", async () => {
    const t = makeT();
    await t.run(async (ctx) => {
      await ctx.db.insert("projects", project("p1", ORG));
      await ctx.db.insert("projectCategories", category("c1", ORG, "p1"));
      await ctx.db.insert("projectGroups", group("g1", ORG, "p1"));
      await ctx.db.insert("projectLineItems", lineItem("li1", ORG, "p1"));
      await ctx.db.insert("projectServices", service("s1", ORG, "p1"));
      await ctx.db.insert("categorySlots", slot("cs1", "c1", 0, { lineItemId: "li1" }));
    });

    const { scanned, versionsCreated, childRowsStamped } = await runBackfill(t);
    expect(scanned).toBe(1);
    expect(versionsCreated).toBe(1);
    expect(childRowsStamped).toBe(5); // category + group + lineItem + service + slot

    const p = await projById(t, "p1");
    expect(p?.liveVersionId).toBeTruthy();
    const version = await versionByCuid(t, p!.liveVersionId!);
    expect(version).toMatchObject({
      projectId: "p1",
      organizationId: ORG,
      number: 1,
      contentState: "ready",
      createdById: BACKFILL_SYSTEM_USER_ID,
      label: "Version 1",
    });

    const li = await lineItemById(t, "li1");
    expect(li?.versionId).toBe(version!.id);
    expect(li?.lineageId).toBe("li1");
    const cat = await categoryById(t, "c1");
    expect(cat?.versionId).toBe(version!.id);
    expect(cat?.lineageId).toBe("c1");
    const cs = await slotById(t, "cs1");
    expect(cs?.versionId).toBe(version!.id);
    expect(cs?.lineageId).toBe("cs1");
  });

  test("templates are included (unlike backfillProjectLiveRevision/backfillQuoteRevisions)", async () => {
    const t = makeT();
    await t.run(async (ctx) => {
      await ctx.db.insert("projects", project("tpl1", ORG, { isTemplate: true, revision: undefined }));
    });

    const { scanned } = await runBackfill(t);
    expect(scanned).toBe(1);
    const p = await projById(t, "tpl1");
    expect(p?.liveVersionId).toBeTruthy();
  });

  test("number is always 1", async () => {
    const t = makeT();
    await t.run(async (ctx) => {
      await ctx.db.insert("projects", project("p1", ORG));
      await ctx.db.insert("projects", project("p2", ORG));
    });
    await runBackfill(t);
    const v1 = await versionByCuid(t, (await projById(t, "p1"))!.liveVersionId!);
    const v2 = await versionByCuid(t, (await projById(t, "p2"))!.liveVersionId!);
    expect(v1?.number).toBe(1);
    expect(v2?.number).toBe(1);
  });

  test("label derives from the most recently sent quote's own label", async () => {
    const t = makeT();
    await t.run(async (ctx) => {
      await ctx.db.insert("projects", project("p1", ORG));
      await ctx.db.insert("quotes", quote("q1", ORG, "p1", 1, { label: "Budget option", sentAt: NOW }));
      await ctx.db.insert("quotes", quote("q2", ORG, "p1", 2, { label: "With LED wall", sentAt: NOW + 1000 }));
    });
    await runBackfill(t);
    const version = await versionByCuid(t, (await projById(t, "p1"))!.liveVersionId!);
    expect(version?.label).toBe("With LED wall");
  });

  test("label defaults to 'Version 1' when no sent quote has a label", async () => {
    const t = makeT();
    await t.run(async (ctx) => {
      await ctx.db.insert("projects", project("p1", ORG));
      await ctx.db.insert("quotes", quote("q1", ORG, "p1", 1, { status: "DRAFT", sentAt: undefined }));
    });
    await runBackfill(t);
    const version = await versionByCuid(t, (await projById(t, "p1"))!.liveVersionId!);
    expect(version?.label).toBe("Version 1");
  });

  test("dry-run scans and reports work but writes nothing", async () => {
    const t = makeT();
    await t.run(async (ctx) => {
      await ctx.db.insert("projects", project("p1", ORG));
    });
    const { scanned, versionsCreated } = await runBackfill(t, false);
    expect(scanned).toBe(1);
    expect(versionsCreated).toBe(1);
    expect((await projById(t, "p1"))?.liveVersionId).toBeUndefined();
    expect(await t.run(async (ctx) => ctx.db.query("projectVersions").collect())).toHaveLength(0);
  });

  test("idempotent — re-running the backfill creates nothing new", async () => {
    const t = makeT();
    await t.run(async (ctx) => {
      await ctx.db.insert("projects", project("p1", ORG));
      await ctx.db.insert("projectLineItems", lineItem("li1", ORG, "p1"));
    });
    expect((await runBackfill(t)).versionsCreated).toBe(1);
    const firstVersionId = (await projById(t, "p1"))!.liveVersionId;

    expect((await runBackfill(t)).versionsCreated).toBe(0);
    expect((await projById(t, "p1"))?.liveVersionId).toBe(firstVersionId);
    expect(await t.run(async (ctx) => ctx.db.query("projectVersions").collect())).toHaveLength(1);
    // The child row wasn't re-stamped with a different version on the second run.
    expect((await lineItemById(t, "li1"))?.versionId).toBe(firstVersionId);
  });

  test("verifyProjectVersions reports zero un-migrated projects after a full apply run, including a cross-project-pointer check", async () => {
    const t = makeT();
    await t.run(async (ctx) => {
      await ctx.db.insert("projects", project("p1", ORG));
      await ctx.db.insert("projects", project("p2", ORG, { isTemplate: true, revision: undefined }));
    });

    expect(await verify(t)).toEqual({
      totalProjects: 2,
      projectsMissingLiveVersionId: 2,
      projectsWithBadVersionPointer: 0,
      projectsWithVersionCountNotOne: 2, // 0 version rows exist yet, so "count === 1" fails too
    });
    await runBackfill(t);
    expect(await verify(t)).toEqual({
      totalProjects: 2,
      projectsMissingLiveVersionId: 0,
      projectsWithBadVersionPointer: 0,
      projectsWithVersionCountNotOne: 0,
    });
  });

  test("verifyProjectVersions flags a liveVersionId planted to point at a DIFFERENT project's version (the cross-tenant-pointer bug class)", async () => {
    const t = makeT();
    await t.run(async (ctx) => {
      await ctx.db.insert("projects", project("p1", ORG));
      await ctx.db.insert("projects", project("p2", ORG));
    });
    await runBackfill(t);
    const v2 = (await projById(t, "p2"))!.liveVersionId!;
    // Corrupt p1 to point at p2's version row — the exact bug class CLAUDE.md warns about.
    await t.run(async (ctx) => {
      const p1 = await ctx.db.query("projects").withIndex("by_cuid", (q) => q.eq("id", "p1")).first();
      await ctx.db.patch(p1!._id, { liveVersionId: v2 });
    });
    const result = await verify(t);
    expect(result.projectsWithBadVersionPointer).toBe(1);
  });

  test("assertExpectedProjectCount throws on mismatch, passes on match, no-ops when undefined", () => {
    expect(() => assertExpectedProjectCount(5, 5)).not.toThrow();
    expect(() => assertExpectedProjectCount(5, undefined)).not.toThrow();
    expect(() => assertExpectedProjectCount(5, 4)).toThrow(/expected 4/);
  });

  // Regression for a real prod incident: `planProjectWork` used to re-run the
  // four org-wide `by_organizationId` scans for EVERY un-migrated project in
  // the page, so N un-migrated projects in one org multiplied the read cost
  // by N — against real data (not these small fixtures) that blew Convex's
  // per-function 16MB read limit outright on a single-org, 54-project
  // deployment where every project was un-migrated on the first run. The fix
  // fetches each org's rows once per page and groups by `projectId`. This
  // test can't measure bytes read, so it proves the thing that fix could
  // have gotten wrong instead: with several un-migrated projects sharing one
  // org, each project ends up with EXACTLY its own rows — no cross-project
  // leakage from the shared, grouped-by-org fetch.
  test("several un-migrated projects in the SAME org, in the SAME page, each get exactly their own rows", async () => {
    const t = makeT();
    await t.run(async (ctx) => {
      await ctx.db.insert("projects", project("p1", ORG));
      await ctx.db.insert("projects", project("p2", ORG));
      await ctx.db.insert("projects", project("p3", ORG));
      await ctx.db.insert("projectCategories", category("c1", ORG, "p1"));
      await ctx.db.insert("projectCategories", category("c2", ORG, "p2"));
      await ctx.db.insert("projectCategories", category("c3", ORG, "p3"));
      await ctx.db.insert("projectLineItems", lineItem("li1", ORG, "p1"));
      await ctx.db.insert("projectLineItems", lineItem("li2a", ORG, "p2"));
      await ctx.db.insert("projectLineItems", lineItem("li2b", ORG, "p2"));
      await ctx.db.insert("projectLineItems", lineItem("li3", ORG, "p3"));
    });

    const result = await runBackfill(t);
    expect(result).toEqual({ scanned: 3, versionsCreated: 3, childRowsStamped: 7 }); // 3 categories + 4 line items

    const p1 = (await projById(t, "p1"))!;
    const p2 = (await projById(t, "p2"))!;
    const p3 = (await projById(t, "p3"))!;
    expect(p1.liveVersionId).not.toBe(p2.liveVersionId);
    expect(p2.liveVersionId).not.toBe(p3.liveVersionId);

    // Each line item's versionId must match its OWN project's version — not
    // a sibling project's, which is exactly the bug a shared, mis-grouped
    // fetch would produce.
    expect((await lineItemById(t, "li1"))!.versionId).toBe(p1.liveVersionId);
    expect((await lineItemById(t, "li2a"))!.versionId).toBe(p2.liveVersionId);
    expect((await lineItemById(t, "li2b"))!.versionId).toBe(p2.liveVersionId);
    expect((await lineItemById(t, "li3"))!.versionId).toBe(p3.liveVersionId);
    expect((await categoryById(t, "c1"))!.versionId).toBe(p1.liveVersionId);
    expect((await categoryById(t, "c2"))!.versionId).toBe(p2.liveVersionId);
    expect((await categoryById(t, "c3"))!.versionId).toBe(p3.liveVersionId);

    expect(await verify(t)).toEqual({
      totalProjects: 3,
      projectsMissingLiveVersionId: 0,
      projectsWithBadVersionPointer: 0,
      projectsWithVersionCountNotOne: 0,
    });
  });
});

describe("projectVersionState — cross-tenant read safety (R-8.4.3)", () => {
  test("listProjectVersions excludes a foreign-org version sharing the same projectId cuid", async () => {
    const t = makeT();
    await t.run(async (ctx) => {
      // Same projectId cuid appears in BOTH orgs — the collision the global
      // by_projectId_number index exposes.
      await ctx.db.insert("projectVersions", {
        id: "vA",
        organizationId: ORG,
        projectId: "shared-project-id",
        number: 1,
        createdAt: NOW,
        createdById: BACKFILL_SYSTEM_USER_ID,
        contentState: "ready",
      });
      await ctx.db.insert("projectVersions", {
        id: "vB",
        organizationId: OTHER,
        projectId: "shared-project-id",
        number: 1,
        createdAt: NOW,
        createdById: BACKFILL_SYSTEM_USER_ID,
        contentState: "ready",
      });
    });

    const rows = await t.run((ctx) => listProjectVersions(ctx, ORG, "shared-project-id"));
    expect(rows.map((r) => r.id)).toEqual(["vA"]); // org B's row NOT leaked
  });

  test("findVersionByNumber returns null for a (projectId, number) pair owned by a different org", async () => {
    const t = makeT();
    await t.run(async (ctx) => {
      await ctx.db.insert("projectVersions", {
        id: "vB",
        organizationId: OTHER,
        projectId: "shared-project-id",
        number: 1,
        createdAt: NOW,
        createdById: BACKFILL_SYSTEM_USER_ID,
        contentState: "ready",
      });
    });

    const row = await t.run((ctx) => findVersionByNumber(ctx, ORG, "shared-project-id", 1));
    expect(row).toBeNull();
  });

  test("findVersionByNumber returns the row when the org actually matches", async () => {
    const t = makeT();
    await t.run(async (ctx) => {
      await ctx.db.insert("projectVersions", {
        id: "vA",
        organizationId: ORG,
        projectId: "shared-project-id",
        number: 1,
        createdAt: NOW,
        createdById: BACKFILL_SYSTEM_USER_ID,
        contentState: "ready",
      });
    });

    const row = await t.run((ctx) => findVersionByNumber(ctx, ORG, "shared-project-id", 1));
    expect(row?.id).toBe("vA");
  });

  test("backfilling two orgs with the SAME projectId cuid never cross-contaminates liveVersionId", async () => {
    const t = makeT();
    await t.run(async (ctx) => {
      await ctx.db.insert("projects", project("shared-project-id", ORG, { projectNumber: "P-A" }));
      await ctx.db.insert("projects", project("shared-project-id", OTHER, { projectNumber: "P-B" }));
    });
    await runBackfill(t);

    const versions = await t.run(async (ctx) => ctx.db.query("projectVersions").collect());
    expect(versions).toHaveLength(2);
    for (const v of versions) {
      expect(v.projectId).toBe("shared-project-id");
    }
    const orgs = versions.map((v) => v.organizationId).sort();
    expect(orgs).toEqual([ORG, OTHER].sort());

    // Each project's liveVersionId must resolve to a version in ITS OWN org.
    const result = await verify(t);
    expect(result.projectsWithBadVersionPointer).toBe(0);
    expect(result.projectsMissingLiveVersionId).toBe(0);
  });
});
