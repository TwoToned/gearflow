/**
 * One-time cleanup driver for orphaned comment threads / review markers left
 * behind by line items deleted BEFORE `deleteCommentsAndMarkersForTarget` was
 * wired into the delete paths. See `convex/backfillOrphanedLineItemComments.ts`
 * for the full rationale.
 *
 *   npx tsx --env-file=.env --env-file=.env.local scripts/convex-backfill-orphaned-line-item-comments.ts
 *   npx tsx --env-file=.env --env-file=.env.local scripts/convex-backfill-orphaned-line-item-comments.ts --apply
 *
 * ALWAYS COUNTS FIRST (dry run by default). The run:
 *   1. verifies both tables (counts orphaned threads / markers),
 *   2. applies page by page for each table (skipped in dry-run mode),
 *   3. re-verifies and FAILS THE RUN unless both counts read 0.
 *
 * Idempotent — safe to re-run; a second run reports 0 work. Needs the real app
 * env (NEXT_PUBLIC_CONVEX_URL + the Better Auth service-signer secret) pointed
 * at the target deployment — same requirement as every other convex-backfill-*
 * driver in this repo.
 */
import { getConvexClient } from "@/lib/convex-client";
import { api } from "../convex/_generated/api";

const apply = process.argv.includes("--apply");

type Page = { scanned: number; orphaned: number; isDone: boolean; continueCursor: string };
type VerifyPage = { orphaned: number; isDone: boolean; continueCursor: string };

async function verify(fn: typeof api.backfillOrphanedLineItemComments.verifyOrphanedCommentThreads): Promise<number> {
  let cursor: string | null = null;
  let total = 0;
  for (;;) {
    const convex = await getConvexClient();
    const r: VerifyPage = await convex.query(fn, { cursor });
    total += r.orphaned;
    if (r.isDone) break;
    cursor = r.continueCursor;
  }
  return total;
}

async function runPages(
  label: string,
  fn: typeof api.backfillOrphanedLineItemComments.backfillOrphanedCommentThreadsPage,
): Promise<{ scanned: number; orphaned: number }> {
  let cursor: string | null = null;
  let page = 0;
  const totals = { scanned: 0, orphaned: 0 };
  for (;;) {
    const convex = await getConvexClient();
    const r: Page = await convex.mutation(fn, { cursor, apply });
    totals.scanned += r.scanned;
    totals.orphaned += r.orphaned;
    page++;
    if (r.orphaned > 0) {
      console.log(`  [${label}] page ${page}: ${apply ? "deleted" : "would delete"} ${r.orphaned} orphan(s) of ${r.scanned} scanned`);
    }
    if (r.isDone) break;
    cursor = r.continueCursor;
  }
  return totals;
}

async function main() {
  console.log("Orphaned line-item comment/marker cleanup");
  console.log("─".repeat(60));
  console.log(`Mode: ${apply ? "APPLY (will write)" : "dry-run"}`);
  console.log();

  const beforeThreads = await verify(api.backfillOrphanedLineItemComments.verifyOrphanedCommentThreads);
  const beforeMarkers = await verify(api.backfillOrphanedLineItemComments.verifyOrphanedReviewMarkers);
  console.log(`Before: ${beforeThreads} orphaned thread(s), ${beforeMarkers} orphaned marker(s)`);
  console.log();

  const threads = await runPages("threads", api.backfillOrphanedLineItemComments.backfillOrphanedCommentThreadsPage);
  const markers = await runPages("markers", api.backfillOrphanedLineItemComments.backfillOrphanedReviewMarkersPage);
  console.log();
  console.log(
    `Scanned ${threads.scanned} thread(s) (${threads.orphaned} orphaned), ` +
      `${markers.scanned} marker(s) (${markers.orphaned} orphaned).`,
  );

  if (!apply) {
    console.log("\n(Dry run — re-run with --apply to write.)");
    return;
  }

  console.log();
  const afterThreads = await verify(api.backfillOrphanedLineItemComments.verifyOrphanedCommentThreads);
  const afterMarkers = await verify(api.backfillOrphanedLineItemComments.verifyOrphanedReviewMarkers);
  if (afterThreads > 0 || afterMarkers > 0) {
    console.error(`\n✗ ${afterThreads} thread(s) + ${afterMarkers} marker(s) still orphaned — investigate.`);
    process.exit(1);
  }
  console.log("\n✓ Zero orphaned threads/markers remain.");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("\nCleanup failed:", err);
    process.exit(1);
  });
