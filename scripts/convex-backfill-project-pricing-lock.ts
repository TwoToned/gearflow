/**
 * #1230 (Phase 4 — "Project versioning v2", parent #1221) backfill driver.
 * See `convex/backfillProjectPricingLock.ts` for the full rationale.
 *
 *   npx tsx --env-file=.env --env-file=.env.local scripts/convex-backfill-project-pricing-lock.ts                          # dry-run
 *   npx tsx --env-file=.env --env-file=.env.local scripts/convex-backfill-project-pricing-lock.ts --apply                  # writes
 *   npx tsx --env-file=.env --env-file=.env.local scripts/convex-backfill-project-pricing-lock.ts --apply --expect-projects=1234
 *
 * Sets `projects.pricingLocked = true` (+ pricingLockedAt/pricingLockedById/
 * pricingLockedByName) for every non-template project whose status is
 * CONFIRMED or later, OR whose live revision's quote is currently SENT,
 * ACCEPTED, or EXPIRED — the same two checks `sendNative`/`updateStatusNative`
 * use to raise the flag going forward, run once against history. Never
 * LOWERS the flag. Idempotent — a project already `pricingLocked: true` is
 * skipped. Re-verifies via `verifyProjectPricingLock` after applying and
 * FAILS THE RUN unless every project matching the lock predicate reads
 * `pricingLocked: true`. A fresh Convex client is fetched per page so the
 * short-lived service token can't expire mid-run.
 *
 * Run this AFTER `convex-backfill-project-versions.ts` (Phase 1) — though the
 * two backfills are independent in practice (this one reads `projects.status`
 * and `quotes`, not `projectVersions`), running Phase 1 first matches the
 * program's own dependency order and keeps the "what's been migrated" story
 * simple to reason about.
 */
import { getConvexClient } from "@/lib/convex-client";
import { api } from "../convex/_generated/api";
import { assertExpectedProjectCount } from "../convex/backfillProjectPricingLock";

const apply = process.argv.includes("--apply");
const expectArg = process.argv.find((a) => a.startsWith("--expect-projects="));
const expectProjects = expectArg ? Number(expectArg.split("=")[1]) : undefined;

type VerifyCounts = {
  totalProjects: number;
  projectsNeedingLockButUnlocked: number;
};

async function runVerification(): Promise<VerifyCounts> {
  const totals: VerifyCounts = { totalProjects: 0, projectsNeedingLockButUnlocked: 0 };
  let cursor: string | null = null;
  for (;;) {
    const convex = await getConvexClient();
    const r: VerifyCounts & { isDone: boolean; continueCursor: string } = await convex.query(
      api.backfillProjectPricingLock.verifyProjectPricingLock,
      { cursor },
    );
    totals.totalProjects += r.totalProjects;
    totals.projectsNeedingLockButUnlocked += r.projectsNeedingLockButUnlocked;
    if (r.isDone) break;
    cursor = r.continueCursor;
  }
  return totals;
}

async function main() {
  console.log("projects.pricingLocked (#1230 Phase 4) backfill");
  console.log("─".repeat(60));
  console.log(`Mode: ${apply ? "APPLY (will set pricingLocked on matching projects)" : "dry-run"}`);
  console.log();

  const before = await runVerification();
  console.log(
    `Before: ${before.totalProjects} project(s) total (templates excluded), ` +
      `${before.projectsNeedingLockButUnlocked} needing pricingLocked but not yet set.`,
  );
  assertExpectedProjectCount(before.totalProjects, expectProjects);
  console.log();

  let cursor: string | null = null;
  let scanned = 0;
  let locked = 0;
  let page = 0;
  for (;;) {
    const convex = await getConvexClient();
    const r: { scanned: number; locked: number; isDone: boolean; continueCursor: string } = await convex.mutation(
      api.backfillProjectPricingLock.backfillProjectPricingLockPage,
      { cursor, apply },
    );
    scanned += r.scanned;
    locked += r.locked;
    page++;
    if (r.scanned > 0) {
      console.log(`  page ${page}: ${apply ? "locked" : "would lock"} ${r.locked} project(s)`);
    }
    if (r.isDone) break;
    cursor = r.continueCursor;
  }

  console.log();
  console.log(`${scanned} project(s) scanned across ${page} page(s), ${locked} matching the lock predicate.`);
  if (!apply) {
    console.log(`(Dry run — re-run with --apply to lock ${locked} project(s).)`);
    return;
  }
  console.log(`✓ Locked ${locked} project(s).`);

  const after = await runVerification();
  console.log();
  console.log(`After: ${after.projectsNeedingLockButUnlocked} still needing pricingLocked but not set.`);
  if (after.projectsNeedingLockButUnlocked !== 0) {
    throw new Error("Backfill incomplete — see the After count above.");
  }
  console.log("✓ Verified — every matching project now reads pricingLocked: true.");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("\nBackfill failed:", err);
    process.exit(1);
  });
