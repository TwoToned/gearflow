/**
 * WS2 (#941) — two-window date model backfill driver.
 * See convex/backfillProjectWindow.ts for the full rationale.
 *
 *   npx tsx --env-file=.env --env-file=.env.local scripts/convex-backfill-project-window.ts          # dry-run
 *   npx tsx --env-file=.env --env-file=.env.local scripts/convex-backfill-project-window.ts --apply  # writes
 *
 * Pages the `projects` table via api.backfillProjectWindow.backfillProjectWindowPage
 * until done, copying projectStartDate/projectStartTime = loadInDate/loadInTime and
 * projectEndDate/projectEndTime = loadOutDate/loadOutTime wherever the project*
 * counterpart is unset. eventStartDate/eventEndDate are NOT migrated (the
 * two-window model has no field for them). Idempotent — safe to re-run.
 *
 * A fresh Convex client is fetched per page so the short-lived service token
 * can't expire mid-run. No ANALYZE — Convex.
 */
import { getConvexClient } from "@/lib/convex-client";
import { api } from "../convex/_generated/api";

const apply = process.argv.includes("--apply");

async function main() {
  console.log("Project window (WS2 #941) backfill");
  console.log("─".repeat(60));
  console.log(`Mode: ${apply ? "APPLY (will write projectStartDate/projectEndDate)" : "dry-run"}`);
  console.log();

  let cursor: string | null = null;
  let scanned = 0;
  let updated = 0;
  let page = 0;
  for (;;) {
    // Fresh client per page — the service token is short-lived.
    const convex = await getConvexClient();
    const r: { scanned: number; updated: number; isDone: boolean; continueCursor: string } =
      await convex.mutation(api.backfillProjectWindow.backfillProjectWindowPage, { cursor, apply });
    scanned += r.scanned;
    updated += r.updated;
    page++;
    if (r.scanned > 0) {
      console.log(`  page ${page}: ${apply ? `updated ${r.updated}` : `would update ${r.scanned}`} project(s)`);
    }
    if (r.isDone) break;
    cursor = r.continueCursor;
  }

  console.log();
  console.log(`${scanned} project(s) with a loadIn/loadOut date but no project-window counterpart found across ${page} page(s).`);
  if (apply) console.log(`✓ Updated ${updated} project(s).`);
  else console.log(`(Dry run — re-run with --apply to write ${scanned} project(s).)`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("\nBackfill failed:", err);
    process.exit(1);
  });
