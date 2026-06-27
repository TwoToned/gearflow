import { prisma } from "@/lib/prisma";
import { getConvexClient } from "@/lib/convex-client";
import { api } from "../../convex/_generated/api";

/**
 * Best-effort mirror of a Better-Auth `user` row (Prisma, source of truth) into the
 * Convex `users` mirror. Call after every user create/update (signup hook, profile
 * edit, avatar change, admin role change).
 *
 * CONTRACT: this MUST NEVER throw into the calling flow — auth/profile writes are
 * the source of truth and must succeed regardless of the mirror. A failed mirror
 * just leaves the Convex row stale until the next write or a backfill. (Nothing
 * reads the Convex users yet; staleness is harmless until composites are rewired.)
 */
export async function mirrorUserToConvex(userId: string): Promise<void> {
  try {
    const u = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        name: true,
        email: true,
        emailVerified: true,
        image: true,
        role: true,
        createdAt: true,
        updatedAt: true,
      },
    });
    if (!u) return;
    const convex = await getConvexClient();
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
  } catch (err) {
    // Swallow — never block the auth/profile flow on a mirror failure.
    console.error(`[user-mirror] failed to mirror user ${userId}:`, err);
  }
}

/**
 * Best-effort removal from the Convex `users` mirror after a Prisma user delete.
 * Same contract: never throws into the calling flow.
 */
export async function removeUserFromConvex(userId: string): Promise<void> {
  try {
    const convex = await getConvexClient();
    await convex.mutation(api.users.remove, { id: userId });
  } catch (err) {
    console.error(`[user-mirror] failed to remove user ${userId} from mirror:`, err);
  }
}
