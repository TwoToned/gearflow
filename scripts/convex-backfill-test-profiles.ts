/**
 * One-time (re-runnable) backfill: copy the TestProfile table from Prisma into Convex.
 *
 * Test-profiles domain (Phase 3). Idempotent — skips profiles already present in
 * Convex (matched by cuid `id`). Maps Date -> Unix ms, null -> absent, and passes
 * the Json `visualChecks`/`electricalTests`/`thresholds` through unchanged (Convex
 * `v.any()`). Also the heal path for the dual-write. Run after the Convex stack is
 * up + schema deployed:
 *
 *   pnpm tsx --env-file=.env --env-file=.env.local scripts/convex-backfill-test-profiles.ts
 *
 * See FEATUREDOCS/54 and docs/designs/convex-hybrid-migration.md.
 */
import { type FunctionArgs } from "convex/server";
import { prisma } from "@/lib/prisma";
import { getConvexClient, toConvexDoc } from "@/lib/convex-client";
import { api } from "../convex/_generated/api";

type TestProfileCreateArgs = FunctionArgs<typeof api.testProfiles.create>;

async function main() {
  const convex = (await getConvexClient());
  const profiles = await prisma.testProfile.findMany({ orderBy: { createdAt: "asc" } });
  console.log(`Found ${profiles.length} test profiles in Prisma.`);

  let created = 0;
  let skipped = 0;
  for (const p of profiles) {
    const existing = await convex.query(api.testProfiles.getById, { id: p.id });
    if (existing) {
      skipped++;
      continue;
    }
    await convex.mutation(api.testProfiles.create, toConvexDoc(p) as TestProfileCreateArgs);
    created++;
    console.log(`  + ${p.name} (${p.id})`);
  }

  console.log(`\nBackfill complete: ${created} created, ${skipped} already present.`);
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
