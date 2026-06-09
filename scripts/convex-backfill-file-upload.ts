/**
 * One-time (re-runnable) backfill: copy the FileUpload table from Prisma into Convex.
 *
 * file_upload domain (Phase 3). Idempotent — skips rows already present in Convex
 * (matched by cuid `id`). Maps Date -> Unix ms, null -> absent. Also the heal path
 * for the dual-write (file_upload is DUAL-WRITTEN: all 7 `*_media` tables carry a
 * REQUIRED + Cascade fileId FK and stay in Prisma, so the Prisma row is the durable
 * FK anchor and Convex mirrors it). Run after the Convex stack is up + schema
 * deployed:
 *
 *   pnpm tsx --env-file=.env --env-file=.env.local scripts/convex-backfill-file-upload.ts
 *
 * See FEATUREDOCS/54 and docs/designs/convex-hybrid-migration.md.
 */
import { type FunctionArgs } from "convex/server";
import { prisma } from "@/lib/prisma";
import { getConvexClient, toConvexDoc } from "@/lib/convex-client";
import { api } from "../convex/_generated/api";

type FileUploadCreateArgs = FunctionArgs<typeof api.fileUploads.create>;

async function main() {
  const convex = (await getConvexClient());
  const files = await prisma.fileUpload.findMany({ orderBy: { createdAt: "asc" } });
  console.log(`Found ${files.length} file uploads in Prisma.`);

  let created = 0;
  let skipped = 0;
  for (const f of files) {
    const existing = await convex.query(api.fileUploads.getById, { id: f.id });
    if (existing) {
      skipped++;
      continue;
    }
    await convex.mutation(api.fileUploads.create, toConvexDoc(f) as FileUploadCreateArgs);
    created++;
    console.log(`  + ${f.fileName} (${f.id})`);
  }

  console.log(`\nBackfill complete: ${created} created, ${skipped} already present.`);
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
