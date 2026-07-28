import type { MutationCtx, QueryCtx } from "../_generated/server";
import { resolveQuoteValidityDays } from "./quoteDates";
import { resolvePaymentTermsDays } from "./invoiceDates";

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

/** Shared row-fetch + JSON parse behind `resolveOrgQuoteConfig`/`resolveOrgInvoiceConfig`
 *  (R-3.1 — one parse, not one per caller). `settings` is the JSON string of the
 *  `OrgSettings` TS shape (src/lib/org-settings-types.ts); an unparseable blob
 *  degrades to the documented defaults rather than failing the write. */
async function loadOrgDocumentConfig(ctx: MutationCtx | QueryCtx, orgId: string): Promise<ParsedOrgDocumentConfig> {
  const row = await ctx.db
    .query("orgSettings")
    .withIndex("by_organizationId", (q) => q.eq("organizationId", orgId))
    .first();
  let parsed: { timezone?: unknown; documents?: { quoteValidityDays?: unknown; paymentTermsDays?: unknown } } = {};
  if (row?.settings) {
    try {
      parsed = JSON.parse(row.settings) as typeof parsed;
    } catch {
      parsed = {};
    }
  }
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
