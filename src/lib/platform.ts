import { env } from "@/env";

/**
 * Platform display name (server-side: metadata titles, emails, page <title>).
 *
 * OVERRIDE: returns env.PLATFORM_NAME (default "RVLT Flow") and intentionally
 * ignores the DB `SiteSettings.platformName` row — the product brand is RVLT
 * Flow, set via env, not per-row DB data. Mirrors /api/platform-name.
 */
export async function getPlatformName(): Promise<string> {
  return env.PLATFORM_NAME;
}

/** No-op retained for existing callers — the brand name is env-driven now. */
export function invalidatePlatformNameCache() {}
