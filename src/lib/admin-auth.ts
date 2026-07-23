import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/auth-server";

/**
 * Single source of truth for the site-admin authorization check
 * (POLICY.md R-8.4.2 / R-8.4.4). Every site-admin gate — server actions, API
 * routes, and page layouts — must go through one of the three functions below
 * instead of re-querying `user.role` directly.
 */

/** Verify the current user is a site admin. Throws if not. Returns the session. */
export async function requireSiteAdmin() {
  const session = await requireSession();
  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { id: true, role: true },
  });
  if (!user || user.role !== "admin") {
    throw new Error("Access denied. Site admin required.");
  }
  return session;
}

/** Verify the current user is a site admin. For use in API routes. */
export async function requireSiteAdminApi(): Promise<{ userId: string }> {
  const session = await requireSiteAdmin();
  return { userId: session.user.id };
}

/** Check if the current user is a site admin. Never throws. */
export async function isSiteAdmin(): Promise<boolean> {
  try {
    await requireSiteAdmin();
    return true;
  } catch {
    return false;
  }
}
