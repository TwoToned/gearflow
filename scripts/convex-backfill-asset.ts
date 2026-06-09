/**
 * One-time (re-runnable) backfill: copy the asset cluster — asset (serialized) +
 * bulk_asset — from Prisma into Convex.
 *
 * Asset central-graph step 2 (Phase 3), dual-write. Idempotent — skips rows
 * already present in Convex (matched by cuid `id`). Maps Date -> Unix ms, Decimal
 * -> number, null -> absent. Also the heal path for the dual-write.
 *
 * asset.parentAssetId (accessories self-reference) is a plain v.string() in
 * Convex, so no insertion ordering is required. asset_media / asset_bulk_child /
 * the various scan/check/T&T tables stay Prisma-only and compose on the mirror.
 * See src/lib/asset-mirror.ts and FEATUREDOCS/54.
 *
 *   pnpm tsx --env-file=.env --env-file=.env.local scripts/convex-backfill-asset.ts
 */
import { type FunctionArgs } from "convex/server";
import { prisma } from "@/lib/prisma";
import { getConvexClient, toConvexDoc } from "@/lib/convex-client";
import { api } from "../convex/_generated/api";

async function main() {
  const convex = (await getConvexClient());
  let created = 0;
  let skipped = 0;

  const assets = await prisma.asset.findMany();
  for (const a of assets) {
    if (await convex.query(api.assets.getById, { id: a.id })) { skipped++; continue; }
    await convex.mutation(api.assets.create, toConvexDoc(a) as FunctionArgs<typeof api.assets.create>);
    created++;
  }

  const bulkAssets = await prisma.bulkAsset.findMany();
  for (const b of bulkAssets) {
    if (await convex.query(api.bulkAssets.getById, { id: b.id })) { skipped++; continue; }
    await convex.mutation(api.bulkAssets.create, toConvexDoc(b) as FunctionArgs<typeof api.bulkAssets.create>);
    created++;
  }

  console.log(
    `Asset backfill complete: ${created} created, ${skipped} already present ` +
    `(${assets.length} assets, ${bulkAssets.length} bulk assets).`,
  );
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
