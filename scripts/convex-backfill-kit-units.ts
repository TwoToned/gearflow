/**
 * Kit per-unit fulfillment — Phase 2 backfill driver.
 * See docs/designs/kit-per-unit-fulfillment.md and convex/backfillKitUnits.ts.
 *
 *   npx tsx --env-file=.env --env-file=.env.local scripts/convex-backfill-kit-units.ts          # dry-run
 *   npx tsx --env-file=.env --env-file=.env.local scripts/convex-backfill-kit-units.ts --apply  # writes
 *
 * Pages projectLineItems via api.backfillKitUnits.backfillKitUnitsPage until done,
 * creating a projectLineItemUnit for every unit-less kit MEMBER line and carrying that
 * line's current lifecycle (deployed / returned / prepped / bulk quantity). Kits added
 * after Phase 1 already seed their units at kit-add, so this only touches the pre-Phase-1
 * backlog. Idempotent — safe to re-run.
 *
 * A fresh Convex client is fetched per page so the short-lived service token can't
 * expire mid-run (see the convex-backfill-token-refresh note). No ANALYZE — Convex.
 */
import { getConvexClient } from "@/lib/convex-client";
import { api } from "../convex/_generated/api";

const apply = process.argv.includes("--apply");

async function main() {
  console.log("Kit-member unit backfill (Phase 2)");
  console.log("─".repeat(60));
  console.log(`Mode: ${apply ? "APPLY (will write units)" : "dry-run"}`);
  console.log();

  let cursor: string | null = null;
  let scanned = 0;
  let created = 0;
  let page = 0;
  for (;;) {
    // Fresh client per page — the service token is short-lived.
    const convex = await getConvexClient();
    const r: { scanned: number; created: number; isDone: boolean; continueCursor: string } =
      await convex.mutation(api.backfillKitUnits.backfillKitUnitsPage, { cursor, apply });
    scanned += r.scanned;
    created += r.created;
    page++;
    if (r.scanned > 0) {
      console.log(`  page ${page}: ${apply ? `created ${r.created}` : `would create ${r.scanned}`} unit(s)`);
    }
    if (r.isDone) break;
    cursor = r.continueCursor;
  }

  console.log();
  console.log(`${scanned} unit-less kit member line(s) found across ${page} page(s).`);
  if (apply) console.log(`✓ Created ${created} unit row(s).`);
  else console.log(`(Dry run — re-run with --apply to write ${scanned} unit row(s).)`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("\nBackfill failed:", err);
    process.exit(1);
  });
