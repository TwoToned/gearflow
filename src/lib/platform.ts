import { prisma } from "./prisma";

let cachedName: string | null = null;
let cacheTime = 0;
const CACHE_TTL = 60_000; // 1 minute

/** Get the platform name from SiteSettings (server-side, cached). */
export async function getPlatformName(): Promise<string> {
  const now = Date.now();
  if (cachedName && now - cacheTime < CACHE_TTL) {
    return cachedName;
  }

  try {
    const settings = await prisma.siteSettings.findFirst({
      select: { platformName: true },
    });

    cachedName = settings?.platformName || "GearFlow";
    cacheTime = now;
    return cachedName;
  } catch {
    // DB unavailable at build time — fall back to default
    return "GearFlow";
  }
}

/** Invalidate the cached platform name (call after settings update). */
export function invalidatePlatformNameCache() {
  cachedName = null;
  cacheTime = 0;
}
