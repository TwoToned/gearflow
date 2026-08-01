/**
 * #1080/#1085 (Phase 1 — version model) backfill driver.
 * See `convex/backfillProjectLiveRevision.ts` for the full rationale.
 *
 *   npx tsx --env-file=.env --env-file=.env.local scripts/convex-backfill-project-live-revision.ts          # dry-run
 *   npx tsx --env-file=.env --env-file=.env.local scripts/convex-backfill-project-live-revision.ts --apply  # writes
 *
 * Belt-and-braces, not a correctness dependency — `projectLiveRevision()`
 * already coalesces an absent `liveRevision` to `revision` on read. Pages the
 * `projects` table via
 * `api.backfillProjectLiveRevision.backfillProjectLiveRevisionPage` until
 * done, then re-verifies via `verifyProjectLiveRevision` and FAILS THE RUN
 * unless every non-template project reports a `liveRevision`. Idempotent —
 * safe to re-run; a second run reports 0 work. A fresh Convex client is
 * fetched per page so the short-lived service token can't expire mid-run.
 */
import { getConvexClient } from "@/lib/convex-client";
import { api } from "../convex/_generated/api";

const apply = process.argv.includes("--apply");

async function runVerification(): Promise<{ nonTemplateProjects: number; projectsMissingLiveRevision: number }> {
  let nonTemplateProjects = 0;
  let projectsMissingLiveRevision = 0;
  let cursor: string | null = null;
  for (;;) {
    const convex = await getConvexClient();
    const r: {
      nonTemplateProjects: number;
      projectsMissingLiveRevision: number;
      isDone: boolean;
      continueCursor: string;
    } = await convex.query(api.backfillProjectLiveRevision.verifyProjectLiveRevision, { cursor });
    nonTemplateProjects += r.nonTemplateProjects;
    projectsMissingLiveRevision += r.projectsMissingLiveRevision;
    if (r.isDone) break;
    cursor = r.continueCursor;
  }
  return { nonTemplateProjects, projectsMissingLiveRevision };
}

async function main() {
  console.log("projects.liveRevision (#1085) backfill");
  console.log("─".repeat(60));
  console.log(`Mode: ${apply ? "APPLY (will stamp liveRevision)" : "dry-run"}`);
  console.log();

  const before = await runVerification();
  console.log(
    `Before: ${before.nonTemplateProjects} non-template project(s), ${before.projectsMissingLiveRevision} missing liveRevision.`,
  );
  console.log();

  let cursor: string | null = null;
  let scanned = 0;
  let updated = 0;
  let page = 0;
  for (;;) {
    const convex = await getConvexClient();
    const r: { scanned: number; updated: number; isDone: boolean; continueCursor: string } = await convex.mutation(
      api.backfillProjectLiveRevision.backfillProjectLiveRevisionPage,
      { cursor, apply },
    );
    scanned += r.scanned;
    updated += r.updated;
    page++;
    if (r.scanned > 0) {
      console.log(`  page ${page}: ${apply ? `stamped ${r.updated}` : `would stamp ${r.scanned}`} project(s)`);
    }
    if (r.isDone) break;
    cursor = r.continueCursor;
  }

  console.log();
  console.log(`${scanned} project(s) missing liveRevision found across ${page} page(s).`);
  if (!apply) {
    console.log(`(Dry run — re-run with --apply to stamp ${scanned} project(s).)`);
    return;
  }
  console.log(`✓ Stamped ${updated} project(s).`);

  const after = await runVerification();
  console.log();
  console.log(`After: ${after.projectsMissingLiveRevision} project(s) still missing liveRevision.`);
  if (after.projectsMissingLiveRevision !== 0) {
    throw new Error(`Backfill incomplete — ${after.projectsMissingLiveRevision} project(s) still missing liveRevision.`);
  }
  console.log("✓ Verified — every non-template project has a liveRevision.");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("\nBackfill failed:", err);
    process.exit(1);
  });
