/**
 * One-time backfill: copy NotificationEmailLog rows from Prisma into Convex.
 *
 * Phase C HARD CUTOVER (notificationEmailLog was pure-Prisma — never dual-written).
 * It's an append-only dedup log pruned to ~30 days; backfilling avoids a one-time
 * burst of duplicate notification emails right after the cutover (the dedup lookup
 * would otherwise see an empty Convex table). Lower-risk than the woo integration,
 * but cheap + idempotent. Run in the Coolify app container (env injected, no .env):
 *
 *   npx tsx scripts/convex-backfill-notification-email-log.ts
 *
 * Idempotent (createIfMissing by cuid `id`). Re-runnable safely. See FEATUREDOCS/54.
 */
import { type FunctionArgs } from "convex/server";
import { prisma } from "@/lib/prisma";
import { getConvexClient, toConvexDoc } from "@/lib/convex-client";
import { api } from "../convex/_generated/api";

type CreateArgs = FunctionArgs<typeof api.notificationEmailLogs.create>;

async function main() {
  const convex = await getConvexClient();
  // Only the rows still within the prune window matter for dedup; backfill all
  // present rows (the prune job trims the rest on its next run).
  const rows = await prisma.notificationEmailLog.findMany({ orderBy: { sentAt: "asc" } });
  console.log(`Found ${rows.length} notification_email_log row(s) in Prisma.`);

  let created = 0;
  let skipped = 0;
  for (const r of rows) {
    const res = await convex.mutation(
      api.notificationEmailLogs.createIfMissing,
      toConvexDoc(r) as CreateArgs,
    );
    if (res.created) created++;
    else skipped++;
  }

  console.log(`\nBackfill complete: ${created} created, ${skipped} already present.`);
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
