/**
 * One-time (re-runnable) backfill: copy test_tag_asset from Prisma into Convex
 * (table "testTagAssets").
 *
 * Test & Tag dual-write groundwork (Phase 6 decommission). Idempotent — skips
 * rows already present in Convex (matched by cuid `id`). Maps Date -> ms,
 * Decimal -> number, null -> absent. Also the heal path. See
 * src/lib/test-tag-mirror.ts and FEATUREDOCS/54.
 *
 *   pnpm tsx --env-file=.env --env-file=.env.local scripts/convex-backfill-test-tag-assets.ts
 */
import { type FunctionArgs } from "convex/server";
import { prisma } from "@/lib/prisma";
import { getConvexClient, toConvexDoc } from "@/lib/convex-client";
import { api } from "../convex/_generated/api";

async function main() {
  const convex = await getConvexClient();
  let created = 0;
  let skipped = 0;

  const assets = await prisma.testTagAsset.findMany();
  for (const a of assets) {
    const __res = await convex.mutation(
      api.testTagAssets.createIfMissing,
      toConvexDoc(a) as FunctionArgs<typeof api.testTagAssets.createIfMissing>,
    );
    if (__res.created) created++;
    else skipped++;
  }

  console.log(
    `Test-tag asset backfill complete: ${created} created, ${skipped} already present ` +
      `(${assets.length} total).`,
  );
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
