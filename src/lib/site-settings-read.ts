import { getConvexClient, withConvexReadRetry } from "@/lib/convex-client";
import { api } from "../../convex/_generated/api";
import type { Doc } from "../../convex/_generated/dataModel";

/**
 * Server-side read helper for the SiteSettings singleton (Phase C cutover).
 *
 * site_settings is now Convex-only (source of truth). The five former
 * `prisma.siteSettings.findFirst` reads — platform name cache, the public
 * platform-name / registration-policy routes, the Better Auth registration hook,
 * and the admin settings page — read through here. There is at most one row;
 * `getSingleton` returns it (or null → defaults) without the caller knowing its
 * cuid. See FEATUREDOCS/54.
 */
export interface SiteSettingsRow {
  id: string | null;
  platformName: string;
  platformIcon: string | null;
  platformLogo: string | null;
  registrationPolicy: string;
  twoFactorGlobalPolicy: string;
  defaultCurrency: string;
  defaultTaxRate: number;
  allowOrgCreation: boolean;
  createdAt: Date | null;
  updatedAt: Date | null;
}

/** Mirrors the Prisma `SiteSettings @default(...)` values for the not-yet-created case. */
export const DEFAULT_SITE_SETTINGS: SiteSettingsRow = {
  id: null,
  platformName: "RVLT Flow",
  platformIcon: null,
  platformLogo: null,
  registrationPolicy: "OPEN",
  twoFactorGlobalPolicy: "OFF",
  defaultCurrency: "AUD",
  defaultTaxRate: 10,
  allowOrgCreation: true,
  createdAt: null,
  updatedAt: null,
};

function mapDoc(doc: Doc<"siteSettings">): SiteSettingsRow {
  return {
    id: doc.id,
    platformName: doc.platformName ?? DEFAULT_SITE_SETTINGS.platformName,
    platformIcon: doc.platformIcon ?? null,
    platformLogo: doc.platformLogo ?? null,
    registrationPolicy: doc.registrationPolicy ?? DEFAULT_SITE_SETTINGS.registrationPolicy,
    twoFactorGlobalPolicy:
      doc.twoFactorGlobalPolicy ?? DEFAULT_SITE_SETTINGS.twoFactorGlobalPolicy,
    defaultCurrency: doc.defaultCurrency ?? DEFAULT_SITE_SETTINGS.defaultCurrency,
    defaultTaxRate: doc.defaultTaxRate ?? DEFAULT_SITE_SETTINGS.defaultTaxRate,
    allowOrgCreation: doc.allowOrgCreation ?? DEFAULT_SITE_SETTINGS.allowOrgCreation,
    createdAt: doc.createdAt != null ? new Date(doc.createdAt) : null,
    updatedAt: doc.updatedAt != null ? new Date(doc.updatedAt) : null,
  };
}

/**
 * The platform-global singleton settings from Convex, or {@link DEFAULT_SITE_SETTINGS}
 * if no row exists yet (a row is created on the first admin save).
 */
export async function getSiteSettingsFromConvex(): Promise<SiteSettingsRow> {
  const doc = await withConvexReadRetry(async () =>
    (await getConvexClient()).query(api.siteSettings.getSingleton, {}),
  );
  return doc ? mapDoc(doc) : DEFAULT_SITE_SETTINGS;
}
