/**
 * #986 (Phase A — quote revision model) backfill driver.
 * See `convex/backfillQuoteRevisions.ts` for the full rationale.
 *
 *   npx tsx --env-file=.env --env-file=.env.local scripts/convex-backfill-quote-revisions.ts
 *   npx tsx --env-file=.env --env-file=.env.local scripts/convex-backfill-quote-revisions.ts --apply
 *   npx tsx --env-file=.env --env-file=.env.local scripts/convex-backfill-quote-revisions.ts --apply --expect-quotes=3
 *   npx tsx --env-file=.env --env-file=.env.local scripts/convex-backfill-quote-revisions.ts --verify-only
 *
 * ALWAYS COUNTS FIRST. Production is expected to hold effectively no live quote
 * data (decision 12), which is the basis for the simple forward migration — not
 * a licence to skip verification. The run:
 *
 *   1. verifies (counts every project/quote and every un-migrated condition),
 *   2. halts if `--expect-quotes` was supplied and doesn't match the count,
 *   3. applies page by page,
 *   4. re-verifies and FAILS THE RUN unless every un-migrated counter reads 0.
 *
 * Idempotent — safe to re-run; a second run reports 0 work. A fresh Convex client
 * is fetched per page so the short-lived service token can't expire mid-run.
 */
import { getConvexClient } from "@/lib/convex-client";
import { api } from "../convex/_generated/api";
import { assertExpectedQuoteRows } from "../convex/backfillQuoteRevisions";

const apply = process.argv.includes("--apply");
const verifyOnly = process.argv.includes("--verify-only");
const expectFlag = process.argv.find((a) => a.startsWith("--expect-quotes="));
const expectedQuotes = expectFlag ? Number(expectFlag.split("=")[1]) : undefined;

/** Declared rather than inferred: `runVerification` accumulates into the same
 *  shape it returns, so inferring from the call would be circular. */
type VerifyPage = {
  nonTemplateProjects: number;
  liveQuoteRows: number;
  projectsMissingRevision: number;
  projectsWithNoQuote: number;
  projectsWithRevisionBelowQuotes: number;
  quotesStillPublished: number;
  quotesMissingSentAt: number;
  quotesMissingValidUntil: number;
  duplicateRevisionRows: number;
  isDone: boolean;
  continueCursor: string;
};
type MigratePage = {
  scanned: number;
  projectsStamped: number;
  quotesMigrated: number;
  draftsInserted: number;
  isDone: boolean;
  continueCursor: string;
};
type Verification = Omit<VerifyPage, "isDone" | "continueCursor">;

const UNMIGRATED_KEYS = [
  "projectsMissingRevision",
  "projectsWithNoQuote",
  "projectsWithRevisionBelowQuotes",
  "quotesStillPublished",
  "quotesMissingSentAt",
  "quotesMissingValidUntil",
  "duplicateRevisionRows",
] as const;

async function runVerification(): Promise<Verification> {
  const totals: Verification = {
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
  let cursor: string | null = null;
  for (;;) {
    const convex = await getConvexClient();
    const r: VerifyPage = await convex.query(api.backfillQuoteRevisions.verifyQuoteRevisions, { cursor });
    for (const key of Object.keys(totals) as (keyof typeof totals)[]) totals[key] += r[key];
    if (r.isDone) break;
    cursor = r.continueCursor;
  }
  return totals;
}

function printVerification(label: string, v: Verification) {
  console.log(`${label}:`);
  console.log(`  non-template projects .............. ${v.nonTemplateProjects}`);
  console.log(`  live quote rows ................... ${v.liveQuoteRows}`);
  for (const key of UNMIGRATED_KEYS) {
    console.log(`  ${key.padEnd(33, ".")} ${v[key]}`);
  }
}

function unmigratedTotal(v: Verification): number {
  return UNMIGRATED_KEYS.reduce((sum, key) => sum + v[key], 0);
}

/** The paginated apply pass, split out so `main` stays a readable sequence. */
async function runMigration(): Promise<void> {
  let cursor: string | null = null;
  let page = 0;
  const applied = { scanned: 0, projectsStamped: 0, quotesMigrated: 0, draftsInserted: 0 };
  for (;;) {
    const convex = await getConvexClient();
    const r: MigratePage = await convex.mutation(api.backfillQuoteRevisions.backfillQuoteRevisionsPage, {
      cursor,
      apply,
    });
    applied.scanned += r.scanned;
    applied.projectsStamped += r.projectsStamped;
    applied.quotesMigrated += r.quotesMigrated;
    applied.draftsInserted += r.draftsInserted;
    page++;
    if (r.scanned > 0) {
      console.log(
        `  page ${page}: ${apply ? "migrated" : "would migrate"} ${r.scanned} project(s) — ` +
          `${r.projectsStamped} revision stamp(s), ${r.quotesMigrated} quote(s), ${r.draftsInserted} draft(s)`,
      );
    }
    if (r.isDone) break;
    cursor = r.continueCursor;
  }

  console.log();
  console.log(
    `${applied.scanned} project(s) needing work across ${page} page(s): ` +
      `${applied.projectsStamped} revision stamp(s), ${applied.quotesMigrated} quote row(s), ` +
      `${applied.draftsInserted} draft v1 insert(s).`,
  );
}

/** Fail the run unless every un-migrated counter reads 0. */
function assertFullyMigrated(v: Verification): void {
  const remaining = unmigratedTotal(v);
  if (remaining > 0) {
    console.error(`\n✗ ${remaining} un-migrated row(s) remain — investigate before shipping Phase B.`);
    process.exit(1);
  }
  console.log("\n✓ Zero un-migrated rows.");
}

async function main() {
  console.log("Quote revision model (#986) backfill");
  console.log("─".repeat(60));
  console.log(`Mode: ${verifyOnly ? "verify only" : apply ? "APPLY (will write)" : "dry-run"}`);
  console.log();

  const before = await runVerification();
  printVerification("Before", before);
  console.log();

  if (verifyOnly) {
    assertFullyMigrated(before);
    return;
  }

  // Halt on a mismatch against expectation BEFORE writing anything.
  assertExpectedQuoteRows(before.liveQuoteRows, expectedQuotes);

  await runMigration();

  if (!apply) {
    console.log("(Dry run — re-run with --apply to write.)");
    return;
  }

  console.log();
  const after = await runVerification();
  printVerification("After", after);
  assertFullyMigrated(after);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("\nBackfill failed:", err);
    process.exit(1);
  });
