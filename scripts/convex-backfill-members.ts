/**
 * One-time backfill: mirror Prisma `member` + `customRole` rows into their Convex
 * mirror tables (the native read layer's RBAC source for `requireOrgPermission`).
 *
 * Idempotent — upserts by cuid `id`, so re-running is safe and converges any drift.
 * Run AFTER the Phase 1 schema + mirror functions are deployed:
 *
 *   pnpm tsx --env-file=.env --env-file=.env.local scripts/convex-backfill-members.ts
 *
 * (or `pnpm convex:backfill:members`). See docs/designs/convex-native-read-layer.md §3.3.
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

  const roles = await prisma.customRole.findMany({ orderBy: { createdAt: "asc" } });
  console.log(`Found ${roles.length} custom roles in Prisma.`);
  let r = 0;
  for (const row of roles) {
    await convex.mutation(api.customRoles.upsert, {
      id: row.id,
      organizationId: row.organizationId,
      name: row.name,
      description: row.description ?? undefined,
      color: row.color ?? undefined,
      permissions: row.permissions,
      ssoGroupClaim: row.ssoGroupClaim ?? undefined,
      createdAt: row.createdAt ? row.createdAt.getTime() : undefined,
      updatedAt: row.updatedAt ? row.updatedAt.getTime() : undefined,
    });
    r++;
  }
  console.log(`Mirrored ${r} custom roles.`);

  console.log(`\nBackfill complete: ${m} members, ${r} custom roles.`);
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
