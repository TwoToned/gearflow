// @vitest-environment node
//
// convex/backfillQuoteRevisions.ts — the #986 forward migration. Verifies the
// dry-run/apply split, every migration step, idempotency, template exclusion,
// SERVICE-only access, and that `verifyQuoteRevisions` reads ZERO un-migrated
// rows afterwards (the "verification query proving zero un-migrated rows" the
// acceptance criteria ask for).
import { convexTest } from "convex-test";
import { describe, test, expect } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";
import { assertExpectedQuoteRows } from "./backfillQuoteRevisions";
import { computeValidUntil, startOfDayInTimezone } from "./lib/quoteDates";

const modules = import.meta.glob("./**/*.ts");
/** `convexTest(schema, …)` is what makes `ctx.db` schema-aware inside `t.run`. */
const makeT = () => convexTest(schema, modules);
type T = ReturnType<typeof makeT>;
const ORG = "org_1";
const NOW = 1_700_000_000_000;
const SERVICE = { subject: "gearflow-service", svc: true };

const run = (t: T, apply: boolean) =>
  t.withIdentity(SERVICE).mutation(api.backfillQuoteRevisions.backfillQuoteRevisionsPage, { cursor: null, apply });
const verify = (t: T) =>
  t.withIdentity(SERVICE).query(api.backfillQuoteRevisions.verifyQuoteRevisions, { cursor: null });

/** A pre-#986 world: one project with a PUBLISHED quote, one with none, one
 *  template. No `projects.revision` anywhere. */
async function seedLegacy(t: T) {
  await t.run(async (ctx) => {
    await ctx.db.insert("orgSettings", {
      organizationId: ORG,
      settings: JSON.stringify({ timezone: "Australia/Sydney", documents: { quoteValidityDays: 14 } }),
    });
    await ctx.db.insert("projects", {
      id: "p1", organizationId: ORG, projectNumber: "P1", name: "Quoted gig",
      status: "QUOTED", isTemplate: false, createdAt: NOW, updatedAt: NOW,
    });
    await ctx.db.insert("quotes", {
      id: "q1", organizationId: ORG, projectId: "p1", version: 2, status: "PUBLISHED",
      snapshot: { total: 110 }, publishedAt: NOW, publishedById: "user_1", createdAt: NOW,
    });
    await ctx.db.insert("quotes", {
      id: "q0", organizationId: ORG, projectId: "p1", version: 1, status: "SUPERSEDED",
      snapshot: { total: 100 }, publishedAt: NOW - 1000, publishedById: "user_1", createdAt: NOW - 1000,
    });
    await ctx.db.insert("projects", {
      id: "p2", organizationId: ORG, projectNumber: "P2", name: "Never quoted",
      status: "ENQUIRY", isTemplate: false, createdAt: NOW, updatedAt: NOW,
    });
    await ctx.db.insert("projects", {
      id: "tpl", organizationId: ORG, projectNumber: "TPL", name: "Template",
      status: "ENQUIRY", isTemplate: true, createdAt: NOW, updatedAt: NOW,
    });
  });
}

const quotesFor = (t: T, projectId: string) =>
  t.run(async (ctx) => ctx.db.query("quotes").withIndex("by_projectId", (q) => q.eq("projectId", projectId)).collect());
const projectById = (t: T, id: string) =>
  t.run(async (ctx) => ctx.db.query("projects").withIndex("by_cuid", (q) => q.eq("id", id)).first());

describe("backfillQuoteRevisions", () => {
  test("counts before it migrates — a dry run writes nothing", async () => {
    const t = makeT();
    await seedLegacy(t);

    const before = await verify(t);
    expect(before.nonTemplateProjects).toBe(2);
    expect(before.liveQuoteRows).toBe(2);
    expect(before.projectsMissingRevision).toBe(2);
    expect(before.projectsWithNoQuote).toBe(1);
    expect(before.quotesStillPublished).toBe(1);

    const dry = await run(t, false);
    expect(dry.scanned).toBe(2);
    expect(dry.projectsStamped).toBe(2);
    // BOTH legacy rows carry `publishedAt` — the superseded v1 gets its dates
    // migrated too, so its history reads in the new vocabulary as well.
    expect(dry.quotesMigrated).toBe(2);
    expect(dry.draftsInserted).toBe(1);
    // …and nothing changed on disk.
    expect((await projectById(t, "p1"))?.revision).toBeUndefined();
    expect((await quotesFor(t, "p1")).find((q) => q.id === "q1")?.status).toBe("PUBLISHED");
  });

  test("apply: stamps revision, renames PUBLISHED → SENT and derives the quote dates", async () => {
    const t = makeT();
    await seedLegacy(t);
    const applied = await run(t, true);
    expect(applied.projectsStamped).toBe(2);
    expect(applied.quotesMigrated).toBe(2);
    expect(applied.draftsInserted).toBe(1);

    // 1. revision ← max(quotes.version)
    expect((await projectById(t, "p1"))?.revision).toBe(2);
    // …else 1 for a project that has never been quoted.
    expect((await projectById(t, "p2"))?.revision).toBe(1);

    // 2 + 3. PUBLISHED → SENT, published* → sent*, dates derived in the org's timezone.
    const migrated = (await quotesFor(t, "p1")).find((q) => q.id === "q1");
    expect(migrated?.status).toBe("SENT");
    expect(migrated?.sentAt).toBe(NOW);
    expect(migrated?.sentById).toBe("user_1");
    expect(migrated?.publishedAt).toBeUndefined();
    expect(migrated?.publishedById).toBeUndefined();
    const expectedQuoteDate = startOfDayInTimezone(NOW, "Australia/Sydney");
    expect(migrated?.quoteDate).toBe(expectedQuoteDate);
    expect(migrated?.validUntil).toBe(computeValidUntil(expectedQuoteDate, 14, "Australia/Sydney"));
    expect(migrated?.validityDays).toBe(14);

    // 5. No artifact is fabricated for a pre-existing sent quote.
    expect(migrated?.pdfFileId).toBeUndefined();
    expect(migrated?.snapshotId).toBeUndefined();

  });

  test("apply: an already-SUPERSEDED row moves off the deprecated columns too", async () => {
    const t = makeT();
    await seedLegacy(t);
    await run(t, true);
    // Nothing is left for the schema validator to have to keep declaring — the
    // `depositPercent` lesson (FEATUREDOCS/66).
    const superseded = (await quotesFor(t, "p1")).find((q) => q.id === "q0");
    expect(superseded?.status).toBe("SUPERSEDED");
    expect(superseded?.sentAt).toBe(NOW - 1000);
    expect(superseded?.publishedAt).toBeUndefined();
  });

  test("apply: a project with no quote row gets a DRAFT v1 with no frozen money", async () => {
    const t = makeT();
    await seedLegacy(t);
    await run(t, true);

    const drafts = await quotesFor(t, "p2");
    expect(drafts).toHaveLength(1);
    expect(drafts[0]?.status).toBe("DRAFT");
    expect(drafts[0]?.version).toBe(1);
    expect(drafts[0]?.snapshot).toBeNull();
  });

  test("templates are skipped entirely — they're never quoted", async () => {
    const t = makeT();
    await seedLegacy(t);
    await run(t, true);
    expect((await projectById(t, "tpl"))?.revision).toBeUndefined();
    expect(await quotesFor(t, "tpl")).toHaveLength(0);
  });

  test("verification reads zero un-migrated rows after a full run", async () => {
    const t = makeT();
    await seedLegacy(t);
    await run(t, true);

    const after = await verify(t);
    expect(after.projectsMissingRevision).toBe(0);
    expect(after.projectsWithNoQuote).toBe(0);
    expect(after.projectsWithRevisionBelowQuotes).toBe(0);
    expect(after.quotesStillPublished).toBe(0);
    expect(after.quotesMissingSentAt).toBe(0);
    expect(after.quotesMissingValidUntil).toBe(0);
    expect(after.duplicateRevisionRows).toBe(0);
  });

  test("is idempotent — a second run does nothing", async () => {
    const t = makeT();
    await seedLegacy(t);
    await run(t, true);
    const second = await run(t, true);
    expect(second).toMatchObject({ scanned: 0, projectsStamped: 0, quotesMigrated: 0, draftsInserted: 0 });
  });

  test("never lowers an already-higher revision (monotonic)", async () => {
    const t = makeT();
    await seedLegacy(t);
    await t.run(async (ctx) => {
      const p = await ctx.db.query("projects").withIndex("by_cuid", (q) => q.eq("id", "p1")).first();
      await ctx.db.patch(p!._id, { revision: 5 });
    });
    await run(t, true);
    expect((await projectById(t, "p1"))?.revision).toBe(5);
  });

  test("is SERVICE-only", async () => {
    const t = makeT();
    await seedLegacy(t);
    await expect(
      t.withIdentity({ subject: "user_1", orgId: ORG }).mutation(api.backfillQuoteRevisions.backfillQuoteRevisionsPage, {
        cursor: null, apply: true,
      }),
    ).rejects.toThrow();
    await expect(
      t.withIdentity({ subject: "user_1", orgId: ORG }).query(api.backfillQuoteRevisions.verifyQuoteRevisions, {
        cursor: null,
      }),
    ).rejects.toThrow();
  });
});

describe("assertExpectedQuoteRows — the halt-on-mismatch guard", () => {
  test("passes when the count matches, or when no expectation was given", () => {
    expect(() => assertExpectedQuoteRows(3, 3)).not.toThrow();
    expect(() => assertExpectedQuoteRows(999, undefined)).not.toThrow();
  });

  test("halts on a mismatch rather than migrating", () => {
    expect(() => assertExpectedQuoteRows(41, 3)).toThrow(/expected 3 live quote row/i);
  });
});
