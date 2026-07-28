import type { MutationCtx, QueryCtx } from "../_generated/server";
import { resolveQuoteValidityDays } from "./quoteDates";

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

/** The org's document settings that quote sending depends on, resolved IN-mutation
 *  so a browser caller can't spoof them (#986). `settings` is the JSON string of
 *  the `OrgSettings` TS shape (src/lib/org-settings-types.ts); an unparseable
 *  blob degrades to the documented defaults rather than failing the send. */
export async function resolveOrgQuoteConfig(
  ctx: MutationCtx | QueryCtx,
  orgId: string,
): Promise<{ quoteValidityDays: number; timezone: string | undefined }> {
  const row = await ctx.db
    .query("orgSettings")
    .withIndex("by_organizationId", (q) => q.eq("organizationId", orgId))
    .first();
  let parsed: { timezone?: unknown; documents?: { quoteValidityDays?: unknown } } = {};
  if (row?.settings) {
    try {
      parsed = JSON.parse(row.settings) as typeof parsed;
    } catch {
      parsed = {};
    }
  }
  const configured = parsed.documents?.quoteValidityDays;
  return {
    quoteValidityDays: resolveQuoteValidityDays(typeof configured === "number" ? configured : null),
    timezone: typeof parsed.timezone === "string" && parsed.timezone ? parsed.timezone : undefined,
  };
}
