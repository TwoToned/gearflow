import type { MutationCtx, QueryCtx } from "../_generated/server";
import { resolveQuoteValidityDays } from "./quoteDates";
import { resolvePaymentTermsDays } from "./invoiceDates";
import { resolveRottingDays, DEFAULT_ROTTING_AMBER_DAYS, DEFAULT_ROTTING_ERROR_DAYS } from "./rottingDates";

/** Org default tax rate from the Convex orgSettings mirror (source of truth; the
 *  Postgres column is deprecated). null when unset. Resolved IN-mutation so browser
 *  callers can't spoof a money-affecting tax rate. */
export async function resolveOrgDefaultTaxRate(ctx: MutationCtx | QueryCtx, orgId: string): Promise<number | null> {
  const row = await ctx.db
    .query("orgSettings")
    .withIndex("by_organizationId", (q) => q.eq("organizationId", orgId))
    .first();
  return row?.defaultTaxRate ?? null;
}

interface ParsedOrgDocumentConfig {
  timezone: string | undefined;
  quoteValidityDays: unknown;
  paymentTermsDays: unknown;
}

/** The org's settings JSON blob, parsed. The ONE row-fetch + `JSON.parse` behind
 *  every consumer in this file (R-3.1 — one parse, not one per caller).
 *  `settings` is the JSON string of the `OrgSettings` TS shape
 *  (src/lib/org-settings-types.ts); an unparseable blob degrades to `{}` — i.e.
 *  to the documented defaults — rather than failing the write that read it. */
async function loadOrgSettingsBlob(
  ctx: MutationCtx | QueryCtx,
  orgId: string,
): Promise<Record<string, unknown>> {
  const row = await ctx.db
    .query("orgSettings")
    .withIndex("by_organizationId", (q) => q.eq("organizationId", orgId))
    .first();
  if (!row?.settings) return {};
  try {
    const parsed: unknown = JSON.parse(row.settings);
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/** Mirrors `src/lib/project-status-automation.ts`'s `AutoStatusKey` — the
 *  convex/src boundary has no shared module, so parity is proven by a test
 *  instead (`convex/projectAutoStatus.test.ts`). */
export type AutoStatusSettingKey =
  | "quoteSent"
  | "quoteAccepted"
  | "invoiceIssued"
  | "paymentSettled"
  | "prepStarted"
  | "allCheckedOut"
  | "allReturned";

/**
 * Is a given status-automation trigger enabled for this org (#1160)? Absent —
 * both the whole object and any individual key — means ENABLED, so every
 * pre-#1160 org gets the automation with no backfill and the stored setting only
 * ever records an explicit opt-OUT. Mirrors `isAutoStatusEnabled`
 * (`src/lib/project-status-automation.ts`), which the settings UI reads.
 */
export async function resolveAutoStatusEnabled(
  ctx: MutationCtx | QueryCtx,
  orgId: string,
  key: AutoStatusSettingKey,
): Promise<boolean> {
  const blob = await loadOrgSettingsBlob(ctx, orgId);
  const automation = blob.projectStatusAutomation;
  if (!automation || typeof automation !== "object") return true;
  return (automation as Record<string, unknown>)[key] !== false;
}

/** Shared document-settings slice behind `resolveOrgQuoteConfig`/`resolveOrgInvoiceConfig`. */
async function loadOrgDocumentConfig(ctx: MutationCtx | QueryCtx, orgId: string): Promise<ParsedOrgDocumentConfig> {
  const parsed = (await loadOrgSettingsBlob(ctx, orgId)) as {
    timezone?: unknown;
    documents?: { quoteValidityDays?: unknown; paymentTermsDays?: unknown };
  };
  return {
    timezone: typeof parsed.timezone === "string" && parsed.timezone ? parsed.timezone : undefined,
    quoteValidityDays: parsed.documents?.quoteValidityDays,
    paymentTermsDays: parsed.documents?.paymentTermsDays,
  };
}

/** The org's document settings that quote sending depends on, resolved IN-mutation
 *  so a browser caller can't spoof them (#986). */
export async function resolveOrgQuoteConfig(
  ctx: MutationCtx | QueryCtx,
  orgId: string,
): Promise<{ quoteValidityDays: number; timezone: string | undefined }> {
  const config = await loadOrgDocumentConfig(ctx, orgId);
  return {
    quoteValidityDays: resolveQuoteValidityDays(typeof config.quoteValidityDays === "number" ? config.quoteValidityDays : null),
    timezone: config.timezone,
  };
}

/** The org's document settings that invoice issuing depends on, resolved
 *  IN-mutation so a browser caller can't spoof the due-date default (#989). */
export async function resolveOrgInvoiceConfig(
  ctx: MutationCtx | QueryCtx,
  orgId: string,
): Promise<{ paymentTermsDays: number; timezone: string | undefined }> {
  const config = await loadOrgDocumentConfig(ctx, orgId);
  return {
    paymentTermsDays: resolvePaymentTermsDays(typeof config.paymentTermsDays === "number" ? config.paymentTermsDays : null),
    timezone: config.timezone,
  };
}

/** The org's timezone + client-pipeline rotting thresholds (#1245, design
 *  §8.4) — resolved server-side so shading is computed in the ORG's
 *  timezone, never the browser's (R-9.3). `src/lib/org-settings-types.ts`'s
 *  `OrgWorkSettings` is the stored shape; absent keys fall back to the
 *  design doc's 7/14-day defaults. */
export async function resolveOrgWorkConfig(
  ctx: MutationCtx | QueryCtx,
  orgId: string,
): Promise<{ timezone: string | undefined; rottingAmberDays: number; rottingErrorDays: number }> {
  const blob = (await loadOrgSettingsBlob(ctx, orgId)) as {
    timezone?: unknown;
    work?: { rottingAmberDays?: unknown; rottingErrorDays?: unknown };
  };
  const timezone = typeof blob.timezone === "string" && blob.timezone ? blob.timezone : undefined;
  const amber = resolveRottingDays(
    typeof blob.work?.rottingAmberDays === "number" ? blob.work.rottingAmberDays : null,
    DEFAULT_ROTTING_AMBER_DAYS,
  );
  const error = resolveRottingDays(
    typeof blob.work?.rottingErrorDays === "number" ? blob.work.rottingErrorDays : null,
    DEFAULT_ROTTING_ERROR_DAYS,
  );
  // An amber threshold at or past the error threshold would shade every
  // rotting card straight to "error" with no amber step ever showing —
  // silently swallow the amber tier instead of erroring on a bad settings
  // blob. Widening the error threshold by 1 day is the smallest fix that
  // keeps both tiers meaningful.
  return { timezone, rottingAmberDays: amber, rottingErrorDays: Math.max(error, amber + 1) };
}
