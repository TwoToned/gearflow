/**
 * Packing containers (#1296) — build plan phase 1d backfill driver.
 * See docs/designs/packing-containers-{manifest,build-plan}.md and
 * convex/backfillProjectContainers.ts.
 *
 *   npx tsx --env-file=.env --env-file=.env.local scripts/convex-backfill-project-containers.ts          # dry-run
 *   npx tsx --env-file=.env --env-file=.env.local scripts/convex-backfill-project-containers.ts --apply  # writes
 *
 * Two stages, run in order (rule 1 — readers before the backfill; phases
 * 1a-1c must already be deployed): units first (creates/reuses a container
 * per distinct label and stamps `containerId` on every unit still carrying
 * only the label), then lines (catches an `isContainerLineItem` line no
 * content unit ever referenced). Idempotent — safe to re-run. Run against a
 * preview deployment first (`pnpm exec convex deploy --preview-name …`,
 * CLAUDE.md), then prod.
 *
 * A fresh Convex client is fetched per page so the short-lived service token
 * can't expire mid-run (see convex-backfill-kit-units.ts's identical note).
 */
import { getConvexClient } from "@/lib/convex-client";
import { api } from "../convex/_generated/api";

const apply = process.argv.includes("--apply");

type PageResult = { scanned: number; backfilled: number; isDone: boolean; continueCursor: string };

async function runStage(
  label: string,
  mutation: typeof api.backfillProjectContainers.backfillProjectContainersUnitsPage,
): Promise<{ scanned: number; backfilled: number }> {
  let cursor: string | null = null;
  let scanned = 0;
  let backfilled = 0;
  let page = 0;
  for (;;) {
    const convex = await getConvexClient();
    const r: PageResult = await convex.mutation(mutation, { cursor, apply });
    scanned += r.scanned;
    backfilled += r.backfilled;
    page++;
    if (r.scanned > 0) {
      console.log(`  [${label}] page ${page}: ${apply ? `backfilled ${r.backfilled}` : `would backfill ${r.scanned}`}`);
    }
    if (r.isDone) break;
    cursor = r.continueCursor;
  }
  return { scanned, backfilled };
}

async function assertComplete(): Promise<void> {
  let cursor: string | null = null;
  let unbackfilled = 0;
  for (;;) {
    const convex = await getConvexClient();
    const r: { unbackfilled: number; isDone: boolean; continueCursor: string } =
      await convex.query(api.backfillProjectContainers.countUnbackfilledUnits, { cursor });
    unbackfilled += r.unbackfilled;
    if (r.isDone) break;
    cursor = r.continueCursor;
  }
  console.log();
  if (unbackfilled === 0) {
    console.log("✓ Post-run assertion holds: zero units with a prepContainer and no containerId.");
  } else {
    console.log(`✗ Post-run assertion FAILED: ${unbackfilled} unit(s) still have a prepContainer with no containerId.`);
    process.exitCode = 1;
  }
}

async function main() {
  console.log("Packing containers backfill (#1296, phase 1d)");
  console.log("─".repeat(60));
  console.log(`Mode: ${apply ? "APPLY (will write containers)" : "dry-run"}`);
  console.log();

  const units = await runStage("units", api.backfillProjectContainers.backfillProjectContainersUnitsPage);
  const lines = await runStage("lines", api.backfillProjectContainers.backfillProjectContainersLinesPage);

  console.log();
  console.log(`${units.scanned} unit(s) needing a container found (units stage).`);
  console.log(`${lines.scanned} orphaned container line(s) found (lines stage).`);
  if (apply) {
    console.log(`✓ Backfilled ${units.backfilled} unit(s), ${lines.backfilled} line(s).`);
    await assertComplete();
  } else {
    console.log(`(Dry run — re-run with --apply to write.)`);
  }
}

main()
  .then(() => process.exit(process.exitCode ?? 0))
  .catch((err) => {
    console.error("\nBackfill failed:", err);
    process.exit(1);
  });
