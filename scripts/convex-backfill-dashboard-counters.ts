/**
 * One-time backfill / reconcile: populate the Convex `dashboardCounters` row for
 * every org (the native dashboard's O(1) stat source — Phase 3).
 *
 * Idempotent: `reconcile` recomputes all six counters from source and upserts, so
 * re-running converges any drift. Run AFTER the Phase 3 counter functions are
 * deployed, and any time you suspect drift:
 *
 *   pnpm tsx --env-file=.env --env-file=.env.local scripts/convex-backfill-dashboard-counters.ts
 *
 * (or `pnpm convex:backfill:dashboard-counters`). The native dashboard also
 * self-heals via `reconcileIfStale` on view, so this is mainly for the initial
 * populate. See docs/designs/convex-native-read-layer.md §3.6.
 */
import { prisma } from "@/lib/prisma";
import { getConvexClient } from "@/lib/convex-client";
import { api } from "../convex/_generated/api";

async function main() {
  const convex = await getConvexClient();
  const now = Date.now();

  const orgs = await prisma.organization.findMany({ select: { id: true, name: true } });
  console.log(`Found ${orgs.length} organizations.`);

  let n = 0;
  for (const org of orgs) {
    const values = await convex.mutation(api.dashboardCounters.reconcile, { orgId: org.id, now });
    console.log(
      `  ${org.name} (${org.id}): assets=${values.activeAssets} checkedOut=${values.checkedOutAssets} ` +
        `bulkQty=${values.bulkQuantity} activeProjects=${values.activeProjects} crew=${values.activeCrew} offers=${values.pendingCrewOffers}`,
    );
    n++;
  }

  console.log(`\nBackfill complete: reconciled ${n} orgs' dashboard counters.`);
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
