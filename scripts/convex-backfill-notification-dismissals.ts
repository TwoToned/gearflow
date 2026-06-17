/**
 * One-time (re-runnable) backfill: copy NotificationDismissal rows from Prisma
 * into Convex. Bucket-2 notif/woo cluster (Phase B write inversion). Idempotent —
 * skips rows already present (matched by cuid `id`). Maps Date -> Unix ms, null ->
 * absent. See docs/designs/convex-decommission-RUNBOOK.md and FEATUREDOCS/54.
 *
 *   npx tsx --env-file=.env --env-file=.env.local scripts/convex-backfill-notification-dismissals.ts
 */
import { type FunctionArgs } from "convex/server";
import { prisma } from "@/lib/prisma";
import { getConvexClient, toConvexDoc } from "@/lib/convex-client";
import { api } from "../convex/_generated/api";

async function main() {
  const convex = await getConvexClient();
  let created = 0;
  let skipped = 0;

  const rows = await prisma.notificationDismissal.findMany();
  for (const r of rows) {
    const __res = await convex.mutation(
      api.notificationDismissals.createIfMissing,
      toConvexDoc(r) as FunctionArgs<typeof api.notificationDismissals.createIfMissing>,
    );
    if (__res.created) created++; else skipped++;
  }

  console.log(
    `Notification-dismissals backfill complete: ${created} created, ${skipped} already present (${rows.length} rows).`,
  );
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
