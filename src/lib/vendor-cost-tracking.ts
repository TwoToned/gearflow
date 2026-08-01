import "server-only";
import { captureServerEvent } from "@/lib/posthog-server";
import { AnalyticsEvent } from "@/lib/analytics";

/**
 * T-P4 metered vendor cost budget (docs/budgets.md R-0.4, R-9.12/#764): every billable
 * unit against a metered vendor emits a `vendor_usage` PostHog event, so spend
 * driver volume is tracked (R-9.12 "cost per unit ... tracked for the top spend
 * drivers") and reviewable monthly on the "Vendor usage (T-P4)" PostHog insight.
 *
 * This module deliberately does NOT compute a live $ figure or auto-alert at 80%:
 * doing that correctly needs either (a) a persistent monthly counter this app can
 * read back, or (b) a PostHog query-capable API key (the app only holds the
 * public write-only ingestion key) — neither is wired today. The constants below
 * are the target reference lines for when that lands, derived from the
 * Registry-declared $15/mo ceilings using each vendor's PUBLIC list pricing as of
 * writing (Resend's free-tier volume; Google Maps Platform's Places API
 * Essentials per-request SKU pricing) — re-verify against the actual plan/invoice
 * before wiring a real alert off these, they are estimates, not confirmed spend.
 */

/** 80% of a 3,000 emails/mo free-tier allowance (Resend's lowest paid-adjacent tier). */
export const RESEND_MONTHLY_EMAIL_ALERT_LINE = 2_400;

/** Google Maps Platform Places API (New) Essentials list pricing, per request. */
export const MAPS_AUTOCOMPLETE_USD_PER_REQUEST = 0.00283;
export const MAPS_PLACE_DETAILS_USD_PER_REQUEST = 0.005;
/** 80% of the registered $15/mo Maps budget. */
export const MAPS_MONTHLY_COST_ALERT_LINE_USD = 12;

export type MeteredVendor = "resend" | "maps";

/**
 * Report one billable unit of vendor usage. Fire-and-forget and never throws —
 * cost telemetry must never affect the caller's control flow (mirrors
 * src/lib/queue-lag-timing.ts / convex-op-timing.ts).
 */
export function reportVendorUsage(
  vendor: MeteredVendor,
  operation: string,
  units = 1,
): void {
  void captureServerEvent(AnalyticsEvent.VendorUsage, {
    vendor,
    operation,
    units,
  });
}
