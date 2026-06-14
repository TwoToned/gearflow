/**
 * One-time (re-runnable) backfill: stamp `organizationId` onto the Convex
 * `crewAvailabilities` rows. The Prisma CrewAvailability model has no
 * organizationId (it's scoped via crewMember), so the Convex row carries a
 * DENORMALIZED copy resolved here from crewMember.organizationId. This powers
 * the crew planner's org-wide reactive availability subscription.
 *
 * Idempotent — patches the existing Convex row (created by the mirror) with its
 * org; creates the row if somehow missing. See convex/crewAvailabilities.ts
 * (listByOrg) and src/server/crew-availability.ts. See FEATUREDOCS/54.
 *
 *   npx tsx --env-file=.env --env-file=.env.local scripts/convex-backfill-crew-availability-org.ts
 */
import { type FunctionArgs } from "convex/server";
import { prisma } from "@/lib/prisma";
import { getConvexClient, toConvexDoc } from "@/lib/convex-client";
import { api } from "../convex/_generated/api";

async function main() {
  const convex = await getConvexClient();
  let patched = 0;
  let created = 0;

  const rows = await prisma.crewAvailability.findMany({
    include: { crewMember: { select: { organizationId: true } } },
  });

  for (const r of rows) {
    const organizationId = r.crewMember.organizationId;
    const { crewMember: _cm, ...scalar } = r;
    // Atomic: insert-if-missing (security review P0-2), else patch the org stamp.
    const res = await convex.mutation(
      api.crewAvailabilities.createIfMissing,
      toConvexDoc({ ...scalar, organizationId }) as FunctionArgs<typeof api.crewAvailabilities.createIfMissing>,
    );
    if (res.created) {
      created++;
    } else {
      await convex.mutation(api.crewAvailabilities.update, { id: r.id, patch: { organizationId } });
      patched++;
    }
  }

  console.log(`Crew availability org backfill complete: ${patched} patched, ${created} created (${rows.length} rows).`);
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
