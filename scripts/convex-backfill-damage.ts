/**
 * One-time (re-runnable) backfill: copy damageEvent rows from Prisma into Convex.
 *
 * Phase 4 reactive dual-write for the damage list/detail pages. Idempotent —
 * skips rows already present (matched by cuid `id`). Maps Date -> ms, Decimal ->
 * number, null -> absent. Also the heal path. See src/lib/damage-mirror.ts and
 * FEATUREDOCS/54.
 *
 *   npx tsx --env-file=.env --env-file=.env.local scripts/convex-backfill-damage.ts
 */
import { type FunctionArgs } from "convex/server";
import { prisma } from "@/lib/prisma";
import { getConvexClient, toConvexDoc } from "@/lib/convex-client";
import { api } from "../convex/_generated/api";

async function main() {
  const convex = await getConvexClient();
  let created = 0;
  let skipped = 0;

  const rows = await prisma.damageEvent.findMany();
  for (const r of rows) {
    const __res = await convex.mutation(api.damageEvents.createIfMissing, toConvexDoc(r) as FunctionArgs<typeof api.damageEvents.createIfMissing>);
    if (__res.created) created++; else skipped++;
  }

  console.log(`Damage backfill complete: ${created} created, ${skipped} already present (${rows.length} events).`);
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
