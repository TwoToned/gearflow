/**
 * One-off repair driver — release line items whose `groupId` points at a group
 * that no longer exists. See `convex/repairOrphanedGroupLines.ts` for the why.
 *
 *   npx tsx --env-file=.env --env-file=.env.local scripts/convex-repair-orphaned-group-lines.ts          # dry-run
 *   npx tsx --env-file=.env --env-file=.env.local scripts/convex-repair-orphaned-group-lines.ts --apply  # writes
 *
 * Dry-run lists every orphaned line it WOULD release (project, version, line
 * description) and changes nothing. `--apply` clears `groupId` only (the line
 * keeps its category and its price) so the line shows up again as a standalone
 * item you can edit or delete. Idempotent — a second run reports 0.
 */
import { getConvexClient } from "@/lib/convex-client";
import { api } from "../convex/_generated/api";

const apply = process.argv.includes("--apply");

type Row = { lineId: string; projectId: string; versionId: string | null; groupId: string; description: string | null };

async function main() {
  console.log("Orphaned group-line repair");
  console.log("─".repeat(60));
  console.log(`Mode: ${apply ? "APPLY (will clear dangling groupId)" : "dry-run"}`);
  console.log();

  let cursor: string | null = null;
  let scanned = 0;
  let orphaned = 0;
  let released = 0;
  const rows: Row[] = [];
  for (;;) {
    const convex = await getConvexClient();
    const r: {
      scanned: number;
      orphaned: number;
      released: number;
      sample: Row[];
      isDone: boolean;
      continueCursor: string;
    } = await convex.mutation(api.repairOrphanedGroupLines.repairOrphanedGroupLinesPage, { cursor, apply });
    scanned += r.scanned;
    orphaned += r.orphaned;
    released += r.released;
    rows.push(...r.sample);
    if (r.isDone) break;
    cursor = r.continueCursor;
  }

  console.log(`${scanned} grouped line(s) checked, ${orphaned} orphaned.`);
  for (const row of rows) {
    console.log(`  project ${row.projectId}  version ${row.versionId ?? "-"}  line ${row.lineId}  ${row.description ?? ""}`.trimEnd());
  }
  if (rows.length < orphaned) console.log(`  … and ${orphaned - rows.length} more (list is capped per page).`);
  console.log();
  if (!apply) {
    console.log(`(Dry run — re-run with --apply to release ${orphaned} line(s).)`);
    return;
  }
  console.log(`✓ Released ${released} line(s).`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("\nRepair failed:", err);
    process.exit(1);
  });
