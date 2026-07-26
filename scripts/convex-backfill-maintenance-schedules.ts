/**
 * WS6 #945 — expand-migrate backfill driver. See
 * convex/backfillMaintenanceSchedules.ts and FEATUREDOCS/15-maintenance.md.
 *
 *   npx tsx --env-file=.env --env-file=.env.local scripts/convex-backfill-maintenance-schedules.ts          # dry-run
 *   npx tsx --env-file=.env --env-file=.env.local scripts/convex-backfill-maintenance-schedules.ts --apply  # writes
 *
 * Pages `models` via api.backfillMaintenanceSchedules.backfillMaintenanceSchedulesPage
 * until done, creating one `serviceSchedules` row for every model with a
 * positive `maintenanceIntervalDays` and no schedule yet. Idempotent — safe to
 * re-run. Run this BEFORE (or as part of) shipping a follow-up PR that drops
 * `maintenanceIntervalDays` from the Convex schema entirely.
 *
 * A fresh Convex client is fetched per page so the short-lived service token
 * can't expire mid-run (mirrors convex-backfill-client-contacts.ts).
 */
import { getConvexClient } from "@/lib/convex-client";
import { api } from "../convex/_generated/api";

const apply = process.argv.includes("--apply");

async function main() {
  console.log("Maintenance-schedule backfill (WS6 #945)");
  console.log("─".repeat(60));
  console.log(`Mode: ${apply ? "APPLY (will write schedules)" : "dry-run"}`);
  console.log();

  let cursor: string | null = null;
  let scanned = 0;
  let created = 0;
  let page = 0;
  const now = Date.now();
  for (;;) {
    const convex = await getConvexClient();
    const r: { scanned: number; created: number; isDone: boolean; continueCursor: string } =
      await convex.mutation(api.backfillMaintenanceSchedules.backfillMaintenanceSchedulesPage, { cursor, apply, now });
    scanned += r.scanned;
    created += r.created;
    page++;
    if (r.scanned > 0) {
      console.log(`  page ${page}: ${apply ? `created ${r.created}` : `would create ${r.scanned}`} schedule(s)`);
    }
    if (r.isDone) break;
    cursor = r.continueCursor;
  }

  console.log();
  console.log(`${scanned} model(s) with a positive maintenanceIntervalDays and no schedule found across ${page} page(s).`);
  if (apply) console.log(`✓ Created ${created} schedule(s).`);
  else console.log(`(Dry run — re-run with --apply to write ${scanned} schedule(s).)`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("\nBackfill failed:", err);
    process.exit(1);
  });
