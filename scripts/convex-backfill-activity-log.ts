/**
 * One-time (re-runnable) backfill: copy the Postgres `activityLog` table into Convex
 * `activityLogs` (Phase 5c audit-read migration). Idempotent — `record` skips rows
 * already present (matched by cuid `id`), so this is both the initial load AND the heal
 * path for the dual-write deploy window. Maps Date -> Unix ms, null JSON -> absent.
 *
 * Run BEFORE flipping `NATIVE_ACTIVITY_READS` on, so the screens show the COMPLETE
 * history (not just rows written since `NATIVE_ACTIVITY_WRITES` was enabled):
 *
 *   pnpm tsx --env-file=.env --env-file=.env.local scripts/convex-backfill-activity-log.ts
 *
 * See FEATUREDOCS/54.
 */
import { prisma } from "@/lib/prisma";
import { getConvexClient } from "@/lib/convex-client";
import { api } from "../convex/_generated/api";

const BATCH = 500;
// Process each batch with bounded concurrency. Two reasons: (1) speed — thousands of
// sequential HTTP round-trips to Convex Cloud take far too long; (2) the service token
// has a 5-min TTL, and `getConvexClient()` only re-mints it WHEN CALLED, so we must
// re-fetch the client per mutation (cheap — cached until ~30s before expiry) rather
// than hold one client for the whole run (which expires mid-run).
const CONCURRENCY = 15;

async function main() {
  const total = await prisma.activityLog.count();
  console.log(`Found ${total} activityLog rows in Prisma.`);

  let created = 0;
  let skipped = 0;
  let cursor: string | undefined;

  // Cursor-paginate by id (stable) so we never load the whole table into memory.
  for (;;) {
    const rows = await prisma.activityLog.findMany({
      take: BATCH,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      orderBy: { id: "asc" },
    });
    if (rows.length === 0) break;
    cursor = rows[rows.length - 1].id;

    let idx = 0;
    async function worker() {
      while (idx < rows.length) {
        const r = rows[idx++];
        // Re-fetch per mutation so a long run keeps a fresh (auto-refreshed) token.
        const convex = await getConvexClient();
        const res = await convex.mutation(api.activityLogWrites.record, {
          id: r.id,
          organizationId: r.organizationId,
          action: r.action,
          entityType: r.entityType,
          entityId: r.entityId,
          entityName: r.entityName,
          userId: r.userId ?? undefined,
          userName: r.userName,
          summary: r.summary,
          details: r.details ?? undefined,
          metadata: r.metadata ?? undefined,
          projectId: r.projectId ?? undefined,
          assetId: r.assetId ?? undefined,
          kitId: r.kitId ?? undefined,
          createdAt: r.createdAt.getTime(),
        });
        if (res.created) created++;
        else skipped++;
      }
    }
    await Promise.all(Array.from({ length: CONCURRENCY }, worker));
    console.log(`  …processed ${created + skipped}/${total}`);
  }

  console.log(`\nBackfill complete: ${created} created, ${skipped} already present.`);
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
