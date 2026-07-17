/**
 * Backfill/reconcile: mirror Prisma `member` rows into the Convex `members` mirror
 * (the native read layer's RBAC source for `requireOrgPermission`). Custom roles were
 * removed (built-in roles only), so only members are mirrored now.
 *
 * Idempotent — upserts by cuid `id`, so re-running is safe and converges any drift.
 * Run AFTER the Phase 1 schema + mirror functions are deployed:
 *
 *   pnpm tsx --env-file=.env --env-file=.env.local scripts/convex-backfill-members.ts
 *
 * (or `pnpm convex:backfill:members`).
 */
import { prisma } from "@/lib/prisma";
import { getConvexClient } from "@/lib/convex-client";
import { api } from "../convex/_generated/api";

async function main() {
  const convex = await getConvexClient();

  const members = await prisma.member.findMany({ orderBy: { createdAt: "asc" } });
  console.log(`Found ${members.length} members in Prisma.`);
  let m = 0;
  for (const row of members) {
    await convex.mutation(api.members.upsert, {
      id: row.id,
      organizationId: row.organizationId,
      userId: row.userId,
      role: row.role,
      createdAt: row.createdAt ? row.createdAt.getTime() : undefined,
    });
    m++;
  }
  console.log(`Mirrored ${m} members.`);

  console.log(`\nBackfill complete: ${m} members.`);
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
