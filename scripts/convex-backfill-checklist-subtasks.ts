/**
 * #1243 Phase 1 — expand-migrate backfill driver. See
 * convex/backfillChecklistSubtasks.ts and FEATUREDOCS/50-project-tasks.md.
 *
 *   npx tsx --env-file=.env --env-file=.env.local scripts/convex-backfill-checklist-subtasks.ts          # dry-run
 *   npx tsx --env-file=.env --env-file=.env.local scripts/convex-backfill-checklist-subtasks.ts --apply  # writes
 *
 * Pages `projectTasks` via api.backfillChecklistSubtasks.backfillChecklistSubtasksPage
 * until done, creating one child (subtask) `projectTasks` row per non-empty
 * `checklist` item on a parent that doesn't already have a subtask. Idempotent —
 * safe to re-run. Does NOT touch/clear the parent's `checklist` field — that stays
 * for exactly one release after this backfill ships (expand-contract), then a
 * separate follow-up drops it.
 *
 * A fresh Convex client is fetched per page so the short-lived service token can't
 * expire mid-run (mirrors convex-backfill-client-contacts.ts).
 */
import { getConvexClient } from "@/lib/convex-client";
import { api } from "../convex/_generated/api";

const apply = process.argv.includes("--apply");

async function main() {
  console.log("Checklist → subtask backfill (#1243 Phase 1)");
  console.log("─".repeat(60));
  console.log(`Mode: ${apply ? "APPLY (will write subtasks)" : "dry-run"}`);
  console.log();

  let cursor: string | null = null;
  let scanned = 0;
  let created = 0;
  let page = 0;
  for (;;) {
    // Fresh client per page — the service token is short-lived.
    const convex = await getConvexClient();
    const r: { scanned: number; created: number; isDone: boolean; continueCursor: string } =
      await convex.mutation(api.backfillChecklistSubtasks.backfillChecklistSubtasksPage, { cursor, apply });
    scanned += r.scanned;
    created += r.created;
    page++;
    if (r.scanned > 0) {
      console.log(`  page ${page}: ${apply ? `created ${r.created} subtask(s)` : `would migrate ${r.scanned} parent(s)`}`);
    }
    if (r.isDone) break;
    cursor = r.continueCursor;
  }

  console.log();
  console.log(`${scanned} parent task(s) with a non-empty checklist and no existing subtask found across ${page} page(s).`);
  if (apply) console.log(`✓ Created ${created} subtask row(s).`);
  else console.log(`(Dry run — re-run with --apply to write subtasks for ${scanned} parent task(s).)`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("\nBackfill failed:", err);
    process.exit(1);
  });
