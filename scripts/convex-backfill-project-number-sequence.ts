/**
 * One-time backfill: copy ProjectNumberSequence counter rows from Prisma into Convex.
 *
 * Phase C project keystone write-inversion. `projectNumberSequence` was pure-Prisma
 * (Convex shadow table empty). The inverted `createProject` reserves the next number
 * via the Convex counter — if it starts at 1 for an org that already has projects,
 * every new number would collide with an existing one and burn the clash-retry loop.
 * So this MUST run in prod BEFORE the write-inversion deploys, carrying the current
 * counter `value` per (organizationId, scopeKey). Idempotent (createIfMissing by cuid).
 *
 *   npx tsx scripts/convex-backfill-project-number-sequence.ts
 *
 * Re-runnable safely. See FEATUREDOCS/54 and docs/designs/convex-domain-only-decommission.md.
 */
import { type FunctionArgs } from "convex/server";
import { prisma } from "@/lib/prisma";
import { getConvexClient, toConvexDoc } from "@/lib/convex-client";
import { api } from "../convex/_generated/api";

type CreateArgs = FunctionArgs<typeof api.projectNumberSequences.create>;

async function main() {
  const convex = await getConvexClient();
  const rows = await prisma.projectNumberSequence.findMany({ orderBy: { updatedAt: "asc" } });
  console.log(`Found ${rows.length} project_number_sequence row(s) in Prisma.`);

  let created = 0;
  let skipped = 0;
  for (const r of rows) {
    const res = await convex.mutation(
      api.projectNumberSequences.createIfMissing,
      toConvexDoc(r) as CreateArgs,
    );
    if (res.created) created++;
    else skipped++;
    console.log(`  + org ${r.organizationId} scope ${r.scopeKey} = ${r.value}`);
  }

  console.log(`\nBackfill complete: ${created} created, ${skipped} already present.`);
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
