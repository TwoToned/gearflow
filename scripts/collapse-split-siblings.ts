/**
 * Phase 3.8 — split-sibling collapse migration (CLI wrapper).
 *
 * Plan / apply logic lives in `src/server/split-sibling-collapse.ts`;
 * pure equivalence-key + planning helpers in
 * `src/lib/split-sibling-collapse.ts`. This file is just the CLI veneer
 * (arg parsing, reporting, exit codes).
 *
 * See docs/designs/line-item-fulfillment-model.md (Phase 2b).
 *
 * Usage:
 *   tsx --env-file=.env scripts/collapse-split-siblings.ts             # dry-run
 *   tsx --env-file=.env scripts/collapse-split-siblings.ts --apply     # writes
 *   tsx --env-file=.env scripts/collapse-split-siblings.ts --org <id>
 *   tsx --env-file=.env scripts/collapse-split-siblings.ts --project <id>
 *
 * DRY-RUN BY DEFAULT. The --apply flag is the only way to mutate data;
 * the script prints every move first so a human can sanity-check.
 */

import { prisma } from "../src/lib/prisma";
import { runCollapse } from "../src/server/split-sibling-collapse";

const args = process.argv.slice(2);
const apply = args.includes("--apply");
const orgIdx = args.indexOf("--org");
const orgFilter = orgIdx >= 0 ? args[orgIdx + 1] : undefined;
const projIdx = args.indexOf("--project");
const projectFilter = projIdx >= 0 ? args[projIdx + 1] : undefined;
const runId = `run-${new Date().toISOString().replace(/[:.]/g, "-")}`;

async function main() {
  console.log("Split-sibling collapse migration (Phase 3.8)");
  console.log("─".repeat(60));
  console.log(`Mode:    ${apply ? "APPLY (will mutate)" : "dry-run"}`);
  if (orgFilter) console.log(`Org:     ${orgFilter}`);
  if (projectFilter) console.log(`Project: ${projectFilter}`);
  console.log(`Run id:  ${runId}`);
  console.log();

  const { stats, plans, mergeable, flagged } = await runCollapse({
    apply,
    organizationId: orgFilter,
    projectId: projectFilter,
    runId,
  });

  console.log(`Equivalence groups (size ≥ 2): ${plans.length}`);
  console.log(`  Mergeable: ${mergeable.length}`);
  console.log(`  Flagged:   ${flagged.length}`);
  console.log();

  if (flagged.length > 0) {
    console.log("Flagged groups (NOT merged):");
    for (const g of flagged) {
      console.log(
        `  - canonical=${g.canonicalId}  flags=${g.flags.join(",")}  members=${g.moves.length + 1}`,
      );
    }
    console.log();
  }

  // Print one line per mergeable group + one per move, with project /
  // model context for human review.
  const canonicalIds = mergeable.map((m) => m.canonicalId);
  const canonicalRows = canonicalIds.length
    ? await prisma.projectLineItem.findMany({
        where: { id: { in: canonicalIds } },
        select: {
          id: true,
          project: { select: { projectNumber: true } },
          model: { select: { name: true } },
        },
      })
    : [];
  const byId = new Map(canonicalRows.map((c) => [c.id, c]));

  for (const plan of mergeable) {
    const c = byId.get(plan.canonicalId);
    console.log(
      `  ${apply ? "MERGE" : "PLAN "}  ${c?.project.projectNumber ?? "?"}  ${c?.model?.name ?? "?"}  canonical=${plan.canonicalId}  merging ${plan.moves.length}`,
    );
    for (const m of plan.moves) {
      console.log(
        `         ← ${m.siblingId} ${m.assetId ? `asset=${m.assetId}` : `bulk=${m.bulkAssetId}`} qty=${m.quantity}`,
      );
    }
  }

  console.log();
  console.log("Summary");
  console.log("─".repeat(60));
  console.log(`  Mergeable groups:        ${stats.groupsMergeable}`);
  console.log(`  Flagged groups:          ${stats.groupsFlagged}`);
  console.log(`  Sibling rows ${apply ? "merged" : "would merge"}:  ${stats.rowsMergedAway}`);
  if (apply) {
    console.log(`  Units moved:             ${stats.unitsMoved}`);
    console.log(`  CheckRecords repointed:  ${stats.checkRecordsRepointed}`);
    console.log(`  DamageEvents repointed:  ${stats.damageEventsRepointed}`);
    console.log(`  Services repointed:      ${stats.servicesRepointed}`);
  } else {
    console.log();
    console.log("Re-run with --apply to execute.");
  }
}

main()
  .catch((err) => {
    console.error("ERROR:", err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
