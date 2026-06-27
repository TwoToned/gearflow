/**
 * One-time backfill: copy the Better-Auth `user` table from Prisma into the Convex
 * `users` mirror. Idempotent (upsert by cuid `id`) — safe to re-run; re-running is
 * the heal path for the deploy-window gap (users created/edited between enabling
 * the mirror writes in app code and finishing this backfill).
 *
 *   pnpm tsx --env-file=.env --env-file=.env.local scripts/convex-backfill-users.ts
 *
 * The Convex `users` table is a READ MIRROR — Better Auth (Prisma) stays the source
 * of truth. See docs/designs/perf-waterfall-spike-T1.md (the user-mirror unlock).
 */
import { prisma } from "@/lib/prisma";
import { getConvexClient } from "@/lib/convex-client";
import { api } from "../convex/_generated/api";

async function main() {
  const convex = await getConvexClient();
  const users = await prisma.user.findMany({ orderBy: { createdAt: "asc" } });
  console.log(`Found ${users.length} users in Prisma.`);

  let n = 0;
  for (const u of users) {
    await convex.mutation(api.users.upsert, {
      id: u.id,
      name: u.name,
      email: u.email,
      emailVerified: u.emailVerified ?? undefined,
      image: u.image ?? undefined,
      role: u.role ?? undefined,
      createdAt: u.createdAt ? u.createdAt.getTime() : undefined,
      updatedAt: u.updatedAt ? u.updatedAt.getTime() : undefined,
    });
    n++;
    console.log(`  ~ ${u.email} (${u.id})`);
  }

  console.log(`\nUser-mirror backfill complete: ${n} upserted.`);
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
