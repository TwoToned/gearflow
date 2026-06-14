/**
 * One-time (re-runnable) backfill: copy projectManager / projectService /
 * projectTask rows from Prisma into Convex. These power the PM avatars, services
 * panel, and tasks panel — all now reactive. Idempotent (skip-if-present by cuid).
 * See src/lib/project-subtable-mirror.ts and FEATUREDOCS/54.
 *
 *   npx tsx --env-file=.env --env-file=.env.local scripts/convex-backfill-project-subtables.ts
 */
import { type FunctionArgs } from "convex/server";
import { prisma } from "@/lib/prisma";
import { getConvexClient, toConvexDoc } from "@/lib/convex-client";
import { api } from "../convex/_generated/api";

const RELATION_KEYS = new Set([
  "project", "organization", "crewRole", "crewAssignments", "lineItem",
  "user", "assignee", "assigneeUser", "assigneeCrew", "createdBy", "_count",
]);
function strip(row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) if (!RELATION_KEYS.has(k)) out[k] = v;
  return out;
}

async function main() {
  const convex = await getConvexClient();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async function run(label: string, rows: any[], createIfMissing: any) {
    let created = 0;
    let skipped = 0;
    for (const r of rows) {
      // Atomic insert-if-missing (security review P0-2) — no query-then-create race.
      const res = await convex.mutation(createIfMissing, toConvexDoc(strip(r)) as FunctionArgs<typeof createIfMissing>);
      if (res.created) created++; else skipped++;
    }
    console.log(`  ${label}: ${created} created, ${skipped} present (${rows.length}).`);
  }

  await run("projectManagers", await prisma.projectManager.findMany(), api.projectManagers.createIfMissing);
  await run("projectServices", await prisma.projectService.findMany(), api.projectServices.createIfMissing);
  await run("projectTasks", await prisma.projectTask.findMany(), api.projectTasks.createIfMissing);

  console.log("Project sub-table backfill complete.");
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
