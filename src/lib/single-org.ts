import { prisma } from "./prisma";

interface CachedOrg {
  id: string;
  name: string;
  slug: string;
}

let cachedOrg: CachedOrg | null = null;
let fetchedAt = 0;
const TTL = 5 * 60 * 1000; // 5 minutes
// After a transient DB failure we serve the stale org, but back off before
// retrying so we don't re-hit a dying DB on every request and amplify the outage.
const ERROR_BACKOFF = 30 * 1000; // 30 seconds

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

  let org: CachedOrg | null;
  try {
    org = await prisma.organization.findFirst({
      select: { id: true, name: true, slug: true },
      orderBy: { createdAt: "asc" },
    });
  } catch (err) {
    // A TRANSIENT DB error (pool exhaustion, timeout, cold start) must NOT bubble
    // out of the app shell — the layout calls this and would otherwise crash the
    // page (there is no error.tsx) and bounce the user to the home page on the
    // next navigation. Serve the last-known org if we have one; only rethrow if
    // we've genuinely never loaded it. Push `fetchedAt` forward so the stale
    // value is treated as fresh for ERROR_BACKOFF — otherwise it stays expired
    // and every subsequent request re-hits the failing DB before falling back,
    // keeping pages slow and amplifying the very outage this guards against.
    if (cachedOrg) {
      fetchedAt = now - TTL + ERROR_BACKOFF;
      return cachedOrg;
    }
    throw err;
  }

  if (org) {
    cachedOrg = org;
    fetchedAt = now;
  } else {
    // No org row exists yet (genuine bootstrap state). Cache the null for the
    // full TTL — `fetchedAt = 0` re-hit the DB on every single request and
    // amplified load during incidents.
    cachedOrg = null;
    fetchedAt = now;
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
