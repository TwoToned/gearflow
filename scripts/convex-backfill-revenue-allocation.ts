/**
 * One-time backfill: populate `allocatedRevenue` / `allocationBasis` on every
 * historical project's line items, and build the `projectModelRevenues` rollup.
 *
 * From here on, allocation is maintained automatically — it runs inside
 * recalcProjectTotals, which every line-item / group / service / sub-hire write
 * already funnels through. This script exists only because projects that were last
 * edited before the feature shipped will never be recalculated on their own, and
 * would otherwise report $0 revenue for every model forever.
 *
 *   pnpm tsx --env-file=.env --env-file=.env.local scripts/convex-backfill-revenue-allocation.ts
 *   pnpm convex:backfill:revenue-allocation
 *
 * Idempotent: recomputes from the line items and diffs the writes, so re-running
 * converges any drift and costs nothing where nothing changed. Safe to run against
 * production while the app is serving — the allocation pass is the same code path
 * a normal write takes.
 *
 * See docs/revenue-allocation-design.md.
 */
import { prisma } from "@/lib/prisma";
import { getConvexClient } from "@/lib/convex-client";
import { api } from "../convex/_generated/api";

/** Log a heartbeat every N projects so a long run doesn't look hung. */
const PROGRESS_EVERY = 25;

interface ProjectIdPage {
  ids: string[];
  isDone: boolean;
  continueCursor: string;
}

async function projectIdsFor(orgId: string): Promise<string[]> {
  const ids: string[] = [];
  let cursor: string | null = null;

  for (;;) {
    // Fresh client per call: the service token is short-lived (5 min) and does not
    // refresh mid-run, so a long backfill that reuses one client dies partway.
    const convex = await getConvexClient();
    // Annotated because `cursor` is both an input and derived from the result,
    // which TS can't infer through without a cycle.
    const page: ProjectIdPage = await convex.query(api.revenueAllocation.listProjectIdsPage, {
      orgId,
      cursor,
    });
    ids.push(...page.ids);
    if (page.isDone) return ids;
    cursor = page.continueCursor;
  }
}

async function main() {
  const orgs = await prisma.organization.findMany({ select: { id: true, name: true } });
  console.log(`Found ${orgs.length} organizations.`);

  let totalProjects = 0;
  let totalLines = 0;
  const failures: { projectId: string; error: string }[] = [];

  for (const org of orgs) {
    const ids = await projectIdsFor(org.id);
    console.log(`\n${org.name} (${org.id}): ${ids.length} projects`);

    for (const [i, projectId] of ids.entries()) {
      try {
        const convex = await getConvexClient();
        const res = await convex.mutation(api.revenueAllocation.recomputeForProject, {
          projectId,
          orgId: org.id,
          now: Date.now(),
        });
        totalProjects++;
        totalLines += res.lines;
      } catch (err) {
        // Keep going. One bad project (a dangling group ref, say) shouldn't strand
        // the rest of the fleet at $0 — collect and report at the end.
        failures.push({ projectId, error: err instanceof Error ? err.message : String(err) });
      }
      if ((i + 1) % PROGRESS_EVERY === 0) {
        console.log(`  …${i + 1}/${ids.length}`);
      }
    }
  }

  console.log(
    `\nBackfill complete: ${totalProjects} projects, ${totalLines} line items allocated.`,
  );

  if (failures.length > 0) {
    console.error(`\n${failures.length} project(s) FAILED:`);
    for (const f of failures) console.error(`  ${f.projectId}: ${f.error}`);
  }

  await prisma.$disconnect();
  // Non-zero exit on partial success: a backfill that half-worked must not be
  // mistaken for one that worked.
  if (failures.length > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
