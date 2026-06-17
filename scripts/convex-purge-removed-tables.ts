/**
 * Purge orphaned Convex documents from the tables removed by the June-2026
 * feature-removal effort (stocktake, reports, discord, crew certifications,
 * damage capture). Drives `convex/purgeRemovedTables:purgeBatch` in a loop
 * per table until each is empty, then verifies with `pendingCounts`.
 *
 * Uses the Convex deployment from the environment (CONVEX_DEPLOYMENT / deploy
 * key), same as the existing backfill scripts.
 *
 *   pnpm exec tsx scripts/convex-purge-removed-tables.ts           # dev deployment
 *   pnpm exec tsx scripts/convex-purge-removed-tables.ts --prod    # prod deployment
 *   pnpm exec tsx scripts/convex-purge-removed-tables.ts --dry     # counts only, no deletes
 *
 * On Coolify/prod, run inside the app container (env vars injected) exactly
 * like the backfill scripts. Ideal timing: run it AROUND the removal deploy —
 * before is fully typed; after still works (orphan cleanup via `as any`).
 */
import { execFileSync } from "node:child_process";

const REMOVED_TABLES = [
  "stocktakes",
  "stocktakeItems",
  "savedReports",
  "crewCertifications",
  "discordIntegrations",
  "discordAccountLinks",
  "discordLinkTokens",
  "discordOutboxes",
  "damageEvents",
];

const PROD = process.argv.includes("--prod");
const DRY = process.argv.includes("--dry");
const TARGET = PROD ? ["--prod"] : [];

/** Run a Convex function via the CLI and parse its returned JSON value. */
function convexRun(fn: string, args?: Record<string, unknown>): unknown {
  const argv = ["exec", "convex", "run", ...TARGET, fn];
  if (args) argv.push(JSON.stringify(args));
  const raw = execFileSync("pnpm", argv, { encoding: "utf8" });
  // `convex run` prints the return value; grab the last JSON object/value.
  const match = raw.match(/(\{[\s\S]*\}|\[[\s\S]*\]|\d+)\s*$/);
  if (!match) {
    throw new Error(`could not parse output of \`convex run ${fn}\`:\n${raw}`);
  }
  return JSON.parse(match[1]);
}

function main() {
  console.log(
    `Convex purge — target: ${PROD ? "PROD" : "dev"}${DRY ? " (dry run)" : ""}`,
  );

  const before = convexRun("purgeRemovedTables:pendingCounts") as Record<
    string,
    number
  >;
  console.log("Before:", JSON.stringify(before));

  if (DRY) {
    const total = Object.values(before).reduce((a, b) => a + b, 0);
    console.log(`Dry run: ${total}+ documents across ${REMOVED_TABLES.length} tables would be purged.`);
    return;
  }

  let grand = 0;
  for (const table of REMOVED_TABLES) {
    let total = 0;
    for (let guard = 0; guard < 100000; guard++) {
      const res = convexRun("purgeRemovedTables:purgeBatch", { table }) as {
        deleted: number;
        done: boolean;
      };
      total += res.deleted;
      if (res.done) break;
    }
    grand += total;
    console.log(`  ${table}: purged ${total}`);
  }

  const after = convexRun("purgeRemovedTables:pendingCounts") as Record<
    string,
    number
  >;
  const remaining = Object.values(after).reduce((a, b) => a + b, 0);
  console.log(
    `\nDone. Purged ${grand} documents. Remaining (should be 0): ${remaining}`,
  );
  if (remaining > 0) {
    console.error("WARNING: some documents remain:", JSON.stringify(after));
    process.exit(1);
  }
}

main();
