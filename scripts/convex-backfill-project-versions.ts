/**
 * #1226 (Phase 1 — "Project versioning v2", parent #1221) backfill driver.
 * See `convex/backfillProjectVersions.ts` for the full rationale.
 *
 *   npx tsx --env-file=.env --env-file=.env.local scripts/convex-backfill-project-versions.ts                          # dry-run
 *   npx tsx --env-file=.env --env-file=.env.local scripts/convex-backfill-project-versions.ts --apply                  # writes
 *   npx tsx --env-file=.env --env-file=.env.local scripts/convex-backfill-project-versions.ts --apply --expect-projects=1234
 *
 * Creates ONE `projectVersions` row (number 1, contentState "ready") per
 * project — templates included — points `projects.liveVersionId` at it, and
 * stamps `versionId`/`lineageId` on every current `projectCategories` /
 * `projectGroups` / `projectLineItems` / `projectServices` / `categorySlots`
 * row belonging to that project. Idempotent — a project with `liveVersionId`
 * already set is skipped entirely (see the file-level comment in
 * `backfillProjectVersions.ts` for why that alone is a sufficient
 * idempotency gate). Re-verifies via `verifyProjectVersions` after applying
 * and FAILS THE RUN unless every project has exactly one version, a
 * `liveVersionId`, and that pointer resolves to a version belonging to the
 * SAME project + org (the cross-tenant-pointer check). A fresh Convex client
 * is fetched per page so the short-lived service token can't expire mid-run.
 */
import { getConvexClient } from "@/lib/convex-client";
import { api } from "../convex/_generated/api";
import { assertExpectedProjectCount } from "../convex/backfillProjectVersions";

const apply = process.argv.includes("--apply");
const expectArg = process.argv.find((a) => a.startsWith("--expect-projects="));
const expectProjects = expectArg ? Number(expectArg.split("=")[1]) : undefined;

type VerifyCounts = {
  totalProjects: number;
  projectsMissingLiveVersionId: number;
  projectsWithBadVersionPointer: number;
  projectsWithVersionCountNotOne: number;
};

async function runVerification(): Promise<VerifyCounts> {
  const totals: VerifyCounts = {
    totalProjects: 0,
    projectsMissingLiveVersionId: 0,
    projectsWithBadVersionPointer: 0,
    projectsWithVersionCountNotOne: 0,
  };
  let cursor: string | null = null;
  for (;;) {
    const convex = await getConvexClient();
    const r: VerifyCounts & { isDone: boolean; continueCursor: string } = await convex.query(
      api.backfillProjectVersions.verifyProjectVersions,
      { cursor },
    );
    totals.totalProjects += r.totalProjects;
    totals.projectsMissingLiveVersionId += r.projectsMissingLiveVersionId;
    totals.projectsWithBadVersionPointer += r.projectsWithBadVersionPointer;
    totals.projectsWithVersionCountNotOne += r.projectsWithVersionCountNotOne;
    if (r.isDone) break;
    cursor = r.continueCursor;
  }
  return totals;
}

async function main() {
  console.log("projectVersions (#1226 Phase 1) backfill");
  console.log("─".repeat(60));
  console.log(`Mode: ${apply ? "APPLY (will create versions + stamp child rows)" : "dry-run"}`);
  console.log();

  const before = await runVerification();
  console.log(
    `Before: ${before.totalProjects} project(s) total (templates included), ` +
      `${before.projectsMissingLiveVersionId} missing liveVersionId.`,
  );
  assertExpectedProjectCount(before.totalProjects, expectProjects);
  console.log();

  let cursor: string | null = null;
  let scanned = 0;
  let versionsCreated = 0;
  let childRowsStamped = 0;
  let page = 0;
  for (;;) {
    const convex = await getConvexClient();
    const r: {
      scanned: number;
      versionsCreated: number;
      childRowsStamped: number;
      isDone: boolean;
      continueCursor: string;
    } = await convex.mutation(api.backfillProjectVersions.backfillProjectVersionsPage, { cursor, apply });
    scanned += r.scanned;
    versionsCreated += r.versionsCreated;
    childRowsStamped += r.childRowsStamped;
    page++;
    if (r.scanned > 0) {
      console.log(
        `  page ${page}: ${apply ? "created" : "would create"} ${r.versionsCreated} version(s), ` +
          `${apply ? "stamped" : "would stamp"} ${r.childRowsStamped} child row(s)`,
      );
    }
    if (r.isDone) break;
    cursor = r.continueCursor;
  }

  console.log();
  console.log(`${scanned} project(s) needing a version found across ${page} page(s), ${childRowsStamped} child row(s) total.`);
  if (!apply) {
    console.log(`(Dry run — re-run with --apply to create ${versionsCreated} version(s).)`);
    return;
  }
  console.log(`✓ Created ${versionsCreated} version(s), stamped ${childRowsStamped} child row(s).`);

  const after = await runVerification();
  console.log();
  console.log(
    `After: ${after.projectsMissingLiveVersionId} missing liveVersionId, ` +
      `${after.projectsWithBadVersionPointer} with a bad (cross-project/org) version pointer, ` +
      `${after.projectsWithVersionCountNotOne} without exactly one version row.`,
  );
  if (
    after.projectsMissingLiveVersionId !== 0 ||
    after.projectsWithBadVersionPointer !== 0 ||
    after.projectsWithVersionCountNotOne !== 0
  ) {
    throw new Error("Backfill incomplete — see the After counts above.");
  }
  console.log("✓ Verified — every project has exactly one same-project/org version and a liveVersionId.");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("\nBackfill failed:", err);
    process.exit(1);
  });
