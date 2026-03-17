import { prisma } from "./prisma";

interface CachedOrg {
  id: string;
  name: string;
  slug: string;
}

let cachedOrg: CachedOrg | null = null;
let fetchedAt = 0;
const TTL = 5 * 60 * 1000; // 5 minutes

/**
 * Returns the single Organization row. This app enforces exactly one org.
 * Result is cached in-process for 5 minutes to avoid repeated DB hits.
 * Returns null only during bootstrap (no org created yet).
 */
export async function getTheOrg(): Promise<CachedOrg | null> {
  const now = Date.now();
  if (cachedOrg && now - fetchedAt < TTL) {
    return cachedOrg;
  }

  const org = await prisma.organization.findFirst({
    select: { id: true, name: true, slug: true },
    orderBy: { createdAt: "asc" },
  });

  if (org) {
    cachedOrg = org;
    fetchedAt = now;
  } else {
    cachedOrg = null;
    fetchedAt = 0;
  }

  return cachedOrg;
}

/**
 * Invalidate the cached org. Call after org import or org creation.
 */
export function invalidateOrgCache(): void {
  cachedOrg = null;
  fetchedAt = 0;
}
