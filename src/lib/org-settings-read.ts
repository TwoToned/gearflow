import { getConvexClient, withConvexReadRetry } from "@/lib/convex-client";
import { api } from "../../convex/_generated/api";
import type { OrgSettings } from "@/lib/org-settings-types";

/**
 * Server-side read/write helpers for per-org BUSINESS settings (Phase 1
 * inversion). `org_settings` is Convex-only source of truth — this replaces the
 * old `prisma.organization` reads of the `metadata` JSON blob + `defaultTaxRate`
 * + `apiKillSwitchAt` columns. RBAC/validation/audit stay in the calling server
 * actions; these helpers only move bytes. See FEATUREDOCS/54.
 */

export interface OrgSettingsRow {
  settings: OrgSettings;
  defaultTaxRate: number | null;
  apiKillSwitchAt: Date | null;
}

// Fresh object per call — callers mutate `.settings` in place (ical/SSO flows),
// so a shared instance would leak settings across organizations.
function emptyRow(): OrgSettingsRow {
  return { settings: {}, defaultTaxRate: null, apiKillSwitchAt: null };
}

function parseBlob(s: string | undefined | null): OrgSettings {
  if (!s) return {};
  try {
    return JSON.parse(s) as OrgSettings;
  } catch {
    return {};
  }
}

/** Full settings row for an org (blob + denormalised tax/kill-switch columns). */
export async function readOrgSettings(organizationId: string): Promise<OrgSettingsRow> {
  const convex = await getConvexClient();
  const doc = await withConvexReadRetry(() =>
    convex.query(api.orgSettings.getByOrg, { organizationId }),
  );
  if (!doc) return emptyRow();
  return {
    settings: parseBlob(doc.settings),
    defaultTaxRate: doc.defaultTaxRate ?? null,
    apiKillSwitchAt: doc.apiKillSwitchAt != null ? new Date(doc.apiKillSwitchAt) : null,
  };
}

/** Just the parsed settings blob (convenience). */
export async function readOrgSettingsBlob(organizationId: string): Promise<OrgSettings> {
  return (await readOrgSettings(organizationId)).settings;
}

/** The org's default tax rate (or null). Standalone read for line-item tax. */
export async function readOrgDefaultTaxRate(organizationId: string): Promise<number | null> {
  return (await readOrgSettings(organizationId)).defaultTaxRate;
}

/**
 * Persist the full settings blob (+ optional defaultTaxRate). The denormalised
 * `icalToken` lookup key is derived here: set only while the feed is enabled.
 */
export async function saveOrgSettings(
  organizationId: string,
  settings: OrgSettings,
  defaultTaxRate?: number | null,
): Promise<void> {
  const convex = await getConvexClient();
  const icalToken = settings.icalEnabled && settings.icalToken ? settings.icalToken : null;
  await convex.mutation(api.orgSettings.upsertSettings, {
    organizationId,
    settings: JSON.stringify(settings),
    defaultTaxRate: defaultTaxRate === undefined ? undefined : defaultTaxRate,
    icalToken,
    now: Date.now(),
  });
}

/** Atomically reserve N asset tags (increments the counter). */
export async function reserveAssetTagsConvex(organizationId: string, count: number): Promise<string[]> {
  const convex = await getConvexClient();
  const { tags } = await convex.mutation(api.orgSettings.reserveAssetTags, {
    organizationId,
    count,
    now: Date.now(),
  });
  return tags;
}

/** Atomically reserve N test-tag IDs (increments the counter). */
export async function reserveTestTagIdsConvex(organizationId: string, count: number): Promise<string[]> {
  const convex = await getConvexClient();
  const { ids } = await convex.mutation(api.orgSettings.reserveTestTagIds, {
    organizationId,
    count,
    now: Date.now(),
  });
  return ids;
}

/** Atomically reserve the next sub-hire order number (SH-NNNN). */
export async function reserveSubHireOrderNumberConvex(organizationId: string): Promise<string> {
  const convex = await getConvexClient();
  const { orderNumber } = await convex.mutation(api.orgSettings.reserveSubHireOrderNumber, {
    organizationId,
    now: Date.now(),
  });
  return orderNumber;
}

/** Toggle the API kill-switch; returns the new timestamp (or null). */
export async function setApiKillSwitchConvex(organizationId: string, enabled: boolean): Promise<Date | null> {
  const convex = await getConvexClient();
  const { apiKillSwitchAt } = await convex.mutation(api.orgSettings.setApiKillSwitch, {
    organizationId,
    enabled,
    now: Date.now(),
  });
  return apiKillSwitchAt != null ? new Date(apiKillSwitchAt) : null;
}

/** Resolve an org id from a live iCal feed token (enabled feeds only). */
export async function orgIdForIcalToken(token: string): Promise<string | null> {
  const convex = await getConvexClient();
  const doc = await withConvexReadRetry(() =>
    convex.query(api.orgSettings.getByIcalToken, { token }),
  );
  if (!doc) return null;
  const blob = parseBlob(doc.settings);
  return blob.icalEnabled && blob.icalToken === token ? doc.organizationId : null;
}
