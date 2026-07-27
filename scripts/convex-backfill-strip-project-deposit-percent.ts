/**
 * Hotfix for #940 (WS1 — finance model) driver.
 * See convex/backfillStripProjectDepositPercent.ts for the full rationale.
 *
 *   npx tsx --env-file=.env --env-file=.env.local scripts/convex-backfill-strip-project-deposit-percent.ts          # dry-run
 *   npx tsx --env-file=.env --env-file=.env.local scripts/convex-backfill-strip-project-deposit-percent.ts --apply  # writes
 *
 * Pages the `projects` table via
 * api.backfillStripProjectDepositPercent.backfillStripProjectDepositPercentPage
 * until done, removing the deprecated `depositPercent` field from every project
 * that still has it. Idempotent — safe to re-run. Once a full run reports
 * `updated === scanned` and a re-run reports 0/0, `depositPercent` can be fully
 * deleted from `convex/schema.ts`'s `projects` validator.
 *
 * A fresh Convex client is fetched per page so the short-lived service token
 * can't expire mid-run. No ANALYZE — Convex.
 */
import { getConvexClient } from "@/lib/convex-client";
import { api } from "../convex/_generated/api";

const apply = process.argv.includes("--apply");

async function main() {
  console.log("Strip projects.depositPercent (#940 hotfix) backfill");
  console.log("─".repeat(60));
  console.log(`Mode: ${apply ? "APPLY (will remove depositPercent)" : "dry-run"}`);
  console.log();

  let cursor: string | null = null;
  let scanned = 0;
  let updated = 0;
  let page = 0;
  for (;;) {
    // Fresh client per page — the service token is short-lived.
    const convex = await getConvexClient();
    const r: { scanned: number; updated: number; isDone: boolean; continueCursor: string } =
      await convex.mutation(api.backfillStripProjectDepositPercent.backfillStripProjectDepositPercentPage, { cursor, apply });
    scanned += r.scanned;
    updated += r.updated;
    page++;
    if (r.scanned > 0) {
      console.log(`  page ${page}: ${apply ? `stripped ${r.updated}` : `would strip ${r.scanned}`} project(s)`);
    }
    if (r.isDone) break;
    cursor = r.continueCursor;
  }

  console.log();
  console.log(`${scanned} project(s) with a stray depositPercent found across ${page} page(s).`);
  if (apply) console.log(`✓ Stripped ${updated} project(s).`);
  else console.log(`(Dry run — re-run with --apply to strip ${scanned} project(s).)`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("\nBackfill failed:", err);
    process.exit(1);
  });
