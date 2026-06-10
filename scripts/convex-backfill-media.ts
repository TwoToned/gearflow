/**
 * One-time (re-runnable) backfill: copy the seven `*_media` join tables —
 * model_media, asset_media, kit_media, project_media, client_media,
 * location_media, sub_hire_media — from Prisma into Convex.
 *
 * These tables have Phase-2 Convex CRUD but were not dual-written until this
 * session, so their Convex copies start empty/stale. Unlike the 0-row check-item
 * tables, the `*_media` tables hold REAL rows (uploaded media), so this exercises
 * the non-zero path. Idempotent — skips rows already present in Convex (matched by
 * cuid `id`). Maps Date -> Unix ms, null -> absent (via toConvexDoc + mediaDoc).
 * Also the heal path for the dual-write. Run after the Convex stack is up +
 * schema deployed:
 *
 *   pnpm tsx --env-file=.env --env-file=.env.local scripts/convex-backfill-media.ts
 *
 * See FEATUREDOCS/54 and docs/designs/convex-hybrid-migration.md.
 */
import { prisma } from "@/lib/prisma";
import { getConvexClient } from "@/lib/convex-client";
import { mediaDoc, MEDIA_SPECS, type MediaKind } from "@/lib/media-mirror";
import { toConvexDoc } from "@/lib/convex-client";

type Row = Record<string, unknown>;

const FIND_ALL: Record<MediaKind, () => Promise<Row[]>> = {
  model: () => prisma.modelMedia.findMany({ orderBy: { createdAt: "asc" } }) as unknown as Promise<Row[]>,
  asset: () => prisma.assetMedia.findMany({ orderBy: { createdAt: "asc" } }) as unknown as Promise<Row[]>,
  kit: () => prisma.kitMedia.findMany({ orderBy: { createdAt: "asc" } }) as unknown as Promise<Row[]>,
  project: () => prisma.projectMedia.findMany({ orderBy: { createdAt: "asc" } }) as unknown as Promise<Row[]>,
  client: () => prisma.clientMedia.findMany({ orderBy: { createdAt: "asc" } }) as unknown as Promise<Row[]>,
  location: () => prisma.locationMedia.findMany({ orderBy: { createdAt: "asc" } }) as unknown as Promise<Row[]>,
  subHire: () => prisma.subHireMedia.findMany({ orderBy: { createdAt: "asc" } }) as unknown as Promise<Row[]>,
};

async function main() {
  const convex = await getConvexClient();
  const kinds = Object.keys(MEDIA_SPECS) as MediaKind[];

  console.log("Backfilling *_media tables Prisma -> Convex...\n");
  for (const kind of kinds) {
    const spec = MEDIA_SPECS[kind];
    const rows = await FIND_ALL[kind]();
    let created = 0;
    let skipped = 0;
    for (const r of rows) {
      const existing = await convex.query(spec.convex.getById, { id: r.id as string });
      if (existing) {
        skipped++;
        continue;
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await convex.mutation(spec.convex.create, toConvexDoc(mediaDoc(kind, r)) as any);
      created++;
    }
    console.log(`  ${kind}Media: ${rows.length} in Prisma — ${created} created, ${skipped} already present.`);
  }

  console.log("\nBackfill complete.");
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
