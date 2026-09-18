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

// ─── Crew-time planner settings (work-layer Phase 4, #1246) ────────────────
// Mirrors `src/lib/crew-time-settings.ts`'s bounds/default (this module can't
// import from src/lib — Convex bundles separately, same posture as
// quoteDates.ts/quote-validity.ts). Read server-side so a browser caller can
// never spoof the Triage threshold or the reminder opt-in.

const DEFAULT_UNANSWERED_OFFER_HOURS = 48;
const UNANSWERED_OFFER_HOURS_BOUNDS = { min: 1, max: 24 * 14 } as const;

/** Hours an OFFERED crew assignment can sit unanswered before it becomes a
 *  Triage "unanswered offer" signal for the project's PM (design doc §8.5/§9).
 *  A hand-edited/out-of-range blob degrades to the documented default. */
export async function resolveCrewOfferStaleHours(ctx: MutationCtx | QueryCtx, orgId: string): Promise<number> {
  const blob = (await loadOrgSettingsBlob(ctx, orgId)) as { crewTime?: { unansweredOfferHours?: unknown } };
  const configured = blob.crewTime?.unansweredOfferHours;
  if (typeof configured !== "number" || !Number.isFinite(configured)) return DEFAULT_UNANSWERED_OFFER_HOURS;
  if (configured < UNANSWERED_OFFER_HOURS_BOUNDS.min || configured > UNANSWERED_OFFER_HOURS_BOUNDS.max) {
    return DEFAULT_UNANSWERED_OFFER_HOURS;
  }
  return configured;
}

/** Whether the day-before call-time reminder email is enabled for this org.
 *  Off by default — absent (every pre-#1246 org) or `false` = disabled, since
 *  this emails crew on the org's behalf and is a deliberate opt-in, unlike
 *  the status-automation switches above which default ON. */
export async function resolveCrewCallReminderEnabled(ctx: MutationCtx | QueryCtx, orgId: string): Promise<boolean> {
  const blob = (await loadOrgSettingsBlob(ctx, orgId)) as { crewTime?: { callReminderEnabled?: unknown } };
  return blob.crewTime?.callReminderEnabled === true;
}
