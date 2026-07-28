import { v, ConvexError } from "convex/values";
import { createId } from "@paralleldrive/cuid2";
import { mutation, query } from "./_generated/server";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
import { requireService } from "./lib/auth";
import { resolveOrgQuoteConfig } from "./lib/orgSettings";
import { computeValidUntil, startOfDayInTimezone } from "./lib/quoteDates";
import { listProjectQuotes } from "./lib/quoteState";

/**
 * #986 forward migration — bring every project and quote onto the revision model.
 *
 * Production has effectively no live quote data (the #940 finance features
 * shipped days ago and haven't been used in anger — decision 12), so this is a
 * SIMPLE forward migration, not a defensive one: no lazy-creation path, no
 * dual-read window, no reconstruction of history that never happened.
 *
 * Per project (paginated, `apply`-gated, idempotent — same shape as
 * `backfillProjectWindow.ts` / `backfillStripProjectDepositPercent.ts`):
 *
 * 1. `projects.revision` ← `max(quotes.version)`, else 1. Only ever SET when
 *    absent or lower than the quote rows demand — never lowered (monotonic).
 * 2. `quotes.status: "PUBLISHED"` → `"SENT"`; `publishedAt/ById` → `sentAt/ById`.
 * 3. `quoteDate` ← `sentAt`; `validUntil` ← `quoteDate + org quoteValidityDays`,
 *    both resolved on the ORG's calendar day, same as `sendNative` stamps them.
 * 4. A project with NO quote row gets a `DRAFT` v1 inserted directly, so every
 *    project has a coherent revision from day one.
 * 5. Pre-existing sent quotes get **no artifact**. Retro-rendering one from
 *    today's project state would manufacture a document that was never sent —
 *    the exact defect this program removes. Their rows render "no stored
 *    document (pre-versioning)" in the Finance tab.
 *
 * Templates are skipped entirely: they're never quoted and carry no revision.
 *
 * `verifyQuoteRevisions` is the companion verification query — the driver runs it
 * BEFORE applying (so the operator sees the counts and halts on a mismatch
 * against expectation) and AFTER (to prove zero un-migrated rows remain).
 *
 * Driver: `scripts/convex-backfill-quote-revisions.ts`. SERVICE-only.
 */

/** Cached per page so a 300-project page doesn't re-read the same org settings
 *  row 300 times (the org set on one page is small). */
type QuoteConfig = { quoteValidityDays: number; timezone: string | undefined };

/** What one project still needs. `null` ⇒ already migrated (the idempotent
 *  no-op case, which is every project on a re-run). */
interface ProjectWork {
  maxVersion: number;
  needsRevision: boolean;
  staleQuotes: Doc<"quotes">[];
  needsDraft: boolean;
}

/** Read-only inspection, shared by the dry run and the apply pass so the two can
 *  never disagree about what work exists. */
async function planProjectWork(ctx: MutationCtx, project: Doc<"projects">): Promise<ProjectWork | null> {
  // `listProjectQuotes` re-checks org — `by_projectId` is a GLOBAL index (R-8.4.3),
  // and that holds even inside a service-token migration.
  const quotes = await listProjectQuotes(ctx, project.organizationId, project.id);

  const maxVersion = quotes.reduce((max, q) => Math.max(max, q.version ?? 1), 1);
  const needsRevision = project.revision == null || project.revision < maxVersion;
  const staleQuotes = quotes.filter((q) => q.status === "PUBLISHED" || (q.publishedAt != null && q.sentAt == null));
  const needsDraft = quotes.length === 0;

  if (!needsRevision && staleQuotes.length === 0 && !needsDraft) return null;
  return { maxVersion, needsRevision, staleQuotes, needsDraft };
}

/** Steps 2 + 3: PUBLISHED → SENT, published* → sent*, and the derived dates. */
async function migrateQuoteRow(ctx: MutationCtx, quote: Doc<"quotes">, config: QuoteConfig): Promise<void> {
  const sentAt = quote.sentAt ?? quote.publishedAt ?? quote.createdAt ?? quote._creationTime;
  const quoteDate = quote.quoteDate ?? startOfDayInTimezone(sentAt, config.timezone);
  await ctx.db.patch(quote._id, {
    status: quote.status === "PUBLISHED" ? "SENT" : quote.status,
    sentAt: quote.sentAt ?? sentAt,
    sentById: quote.sentById ?? quote.publishedById,
    quoteDate,
    validUntil: quote.validUntil ?? computeValidUntil(quoteDate, config.quoteValidityDays, config.timezone),
    validityDays: quote.validityDays ?? config.quoteValidityDays,
    // The deprecated columns are cleared once their values have moved, so the
    // validator can drop them in a follow-up (the `depositPercent` lesson: a
    // field can only leave the schema once no live row still carries it).
    publishedAt: undefined,
    publishedById: undefined,
  });
}

/** Step 4: every project without a quote row gets a DRAFT at its revision. */
async function insertDraftRevision(ctx: MutationCtx, project: Doc<"projects">, version: number): Promise<void> {
  await ctx.db.insert("quotes", {
    id: createId(),
    organizationId: project.organizationId,
    projectId: project.id,
    version,
    status: "DRAFT",
    // A draft carries no frozen money — its figures are the project's live totals
    // until it is sent (parity with `newVersionNative`).
    snapshot: null,
    createdAt: project.createdAt ?? project._creationTime,
    updatedAt: project.updatedAt ?? project._creationTime,
  });
}

/** The write half, split from the handler so the page loop stays a plain
 *  plan → tally → apply sequence (R-3.6). */
async function applyProjectWork(
  ctx: MutationCtx,
  project: Doc<"projects">,
  work: ProjectWork,
  configFor: (orgId: string) => Promise<QuoteConfig>,
): Promise<void> {
  if (work.needsRevision) await ctx.db.patch(project._id, { revision: work.maxVersion });
  if (work.staleQuotes.length > 0) {
    const config = await configFor(project.organizationId);
    for (const quote of work.staleQuotes) await migrateQuoteRow(ctx, quote, config);
  }
  if (work.needsDraft) await insertDraftRevision(ctx, project, project.revision ?? work.maxVersion);
}

export const backfillQuoteRevisionsPage = mutation({
  args: {
    cursor: v.union(v.string(), v.null()),
    apply: v.boolean(),
    numItems: v.optional(v.number()),
  },
  returns: v.object({
    scanned: v.number(),
    projectsStamped: v.number(),
    quotesMigrated: v.number(),
    draftsInserted: v.number(),
    isDone: v.boolean(),
    continueCursor: v.string(),
  }),
  handler: async (ctx, { cursor, apply, numItems }) => {
    await requireService(ctx);
    const res = await ctx.db.query("projects").paginate({ cursor, numItems: numItems ?? 300 });

    const configCache = new Map<string, QuoteConfig>();
    const configFor = async (orgId: string): Promise<QuoteConfig> => {
      const hit = configCache.get(orgId);
      if (hit) return hit;
      const config = await resolveOrgQuoteConfig(ctx, orgId);
      configCache.set(orgId, config);
      return config;
    };

    const tally = { scanned: 0, projectsStamped: 0, quotesMigrated: 0, draftsInserted: 0 };

    for (const project of res.page) {
      if (project.isTemplate) continue; // templates are never quoted
      const work = await planProjectWork(ctx, project);
      if (!work) continue;

      tally.scanned++;
      if (work.needsRevision) tally.projectsStamped++;
      tally.quotesMigrated += work.staleQuotes.length;
      if (work.needsDraft) tally.draftsInserted++;
      if (apply) await applyProjectWork(ctx, project, work, configFor);
    }

    return { ...tally, isDone: res.isDone, continueCursor: res.continueCursor };
  },
});

/**
 * Verification — the "prove zero un-migrated rows" query the acceptance criteria
 * ask for. Every number must read 0 after a full apply run; `liveQuoteRows` and
 * `nonTemplateProjects` are the totals the operator compares against expectation
 * BEFORE applying (decision 12: "effectively none" is a basis for choosing the
 * simple path, not a licence to skip counting).
 *
 * Paginated like the migration itself so it can't blow the read limit on a large
 * org — the driver accumulates across pages.
 */
/** The un-migrated conditions, counted per project so the query handler stays a
 *  plain accumulation loop. Every field must read 0 after a full apply run. */
const EMPTY_COUNTS = {
  nonTemplateProjects: 0,
  liveQuoteRows: 0,
  projectsMissingRevision: 0,
  projectsWithNoQuote: 0,
  projectsWithRevisionBelowQuotes: 0,
  quotesStillPublished: 0,
  quotesMissingSentAt: 0,
  quotesMissingValidUntil: 0,
  duplicateRevisionRows: 0,
};
type VerifyCounts = typeof EMPTY_COUNTS;

async function inspectProject(ctx: QueryCtx, project: Doc<"projects">): Promise<VerifyCounts> {
  const counts = { ...EMPTY_COUNTS, nonTemplateProjects: 1 };
  const quotes = await listProjectQuotes(ctx, project.organizationId, project.id);
  counts.liveQuoteRows = quotes.length;

  if (project.revision == null) counts.projectsMissingRevision = 1;
  if (quotes.length === 0) counts.projectsWithNoQuote = 1;

  const maxVersion = quotes.reduce((max, q) => Math.max(max, q.version ?? 1), 1);
  if (project.revision != null && project.revision < maxVersion) counts.projectsWithRevisionBelowQuotes = 1;

  countQuoteIssues(quotes, counts);
  return counts;
}

/** The per-row un-migrated conditions, accumulated into `counts` in place. */
function countQuoteIssues(quotes: Doc<"quotes">[], counts: VerifyCounts): void {
  const seenVersions = new Set<number>();
  for (const quote of quotes) {
    if (seenVersions.has(quote.version)) counts.duplicateRevisionRows++;
    seenVersions.add(quote.version);
    if (quote.status === "PUBLISHED") counts.quotesStillPublished++;
    if (quote.publishedAt != null && quote.sentAt == null) counts.quotesMissingSentAt++;
    if (quote.status === "SENT" && quote.validUntil == null) counts.quotesMissingValidUntil++;
  }
}

export const verifyQuoteRevisions = query({
  args: { cursor: v.union(v.string(), v.null()), numItems: v.optional(v.number()) },
  returns: v.object({
    nonTemplateProjects: v.number(),
    liveQuoteRows: v.number(),
    projectsMissingRevision: v.number(),
    projectsWithNoQuote: v.number(),
    projectsWithRevisionBelowQuotes: v.number(),
    quotesStillPublished: v.number(),
    quotesMissingSentAt: v.number(),
    quotesMissingValidUntil: v.number(),
    duplicateRevisionRows: v.number(),
    isDone: v.boolean(),
    continueCursor: v.string(),
  }),
  handler: async (ctx, { cursor, numItems }) => {
    await requireService(ctx);
    const res = await ctx.db.query("projects").paginate({ cursor, numItems: numItems ?? 300 });

    const totals = { ...EMPTY_COUNTS };
    for (const project of res.page) {
      if (project.isTemplate) continue;
      const counts = await inspectProject(ctx, project);
      for (const key of Object.keys(totals) as (keyof VerifyCounts)[]) totals[key] += counts[key];
    }

    return { ...totals, isDone: res.isDone, continueCursor: res.continueCursor };
  },
});

/** Guard used by the driver so a mismatch between the counted live rows and the
 *  operator's `--expect-quotes` halts BEFORE anything is written. Exported (and
 *  unit-tested) rather than inlined in the script so the halt condition is
 *  itself covered. */
export function assertExpectedQuoteRows(counted: number, expected: number | undefined): void {
  if (expected === undefined) return;
  if (counted !== expected) {
    throw new ConvexError(
      `Refusing to migrate: expected ${expected} live quote row(s), found ${counted}. ` +
        "Re-run the dry run and confirm the figure before applying.",
    );
  }
}
