/**
 * Shared formatting utilities. Use these instead of defining inline formatters.
 *
 * `formatCurrency`/`formatDate` take an OPTIONAL `FormatConfig` (I2, #1081) \u2014
 * omit it and you get the exact pre-#1081 AU behaviour (the "un-themed
 * fallback" every one of the 241 pre-existing call sites keeps getting for
 * free, byte-for-byte, until it's migrated). Pass one \u2014 via `useFormatters()`
 * client-side (`format-provider.tsx`) or `formatConfigFromOrgSettings()`
 * server/PDF-side \u2014 to render in the org's own country/currency instead.
 * Never add a second currency-formatting helper anywhere else (R-3.1) \u2014
 * extend this module's config surface instead.
 */
import { getCountry } from "./countries";
import type { OrgSettings } from "./org-settings-types";

export interface FormatConfig {
  /** BCP-47 locale tag \u2014 drives date order, decimal separator and number
   *  grouping via `Intl`. */
  locale: string;
  /** ISO 4217 currency code \u2014 drives the printed symbol. */
  currency: string;
}

/** The pre-#1081 hardcoded behaviour, kept as the explicit default so an
 *  org with no country configured yet (or a caller that hasn't threaded a
 *  config through) renders exactly as it always has. */
export const DEFAULT_FORMAT_CONFIG: FormatConfig = { locale: "en-AU", currency: "AUD" };

/** Currency symbols for the launch markets + the two M7-deferred EU rows
 *  (`countries.ts`). An unrecognised code (a currency the country table
 *  doesn't cover yet) falls back to the ISO code itself rather than
 *  guessing a symbol. */
const CURRENCY_SYMBOLS: Record<string, string> = {
  AUD: "$",
  NZD: "$",
  GBP: "\u00a3",
  USD: "$",
  EUR: "\u20ac",
};

function currencySymbol(currency: string): string {
  return CURRENCY_SYMBOLS[currency] ?? `${currency} `;
}

/** Derive a `FormatConfig` from an org's settings \u2014 `settings.country` (via
 *  the I1 country table) supplies the default locale/currency;
 *  `settings.currency` (an existing, previously-unread field) overrides just
 *  the currency when an operator has explicitly set one. No country on the
 *  org yet (not onboarded through the wizard) \u2192 `DEFAULT_FORMAT_CONFIG`, the
 *  same AU behaviour every screen already renders today. */
export function formatConfigFromOrgSettings(settings: OrgSettings | null | undefined): FormatConfig {
  const country = getCountry(settings?.country);
  return {
    locale: country?.locale ?? DEFAULT_FORMAT_CONFIG.locale,
    currency: settings?.currency || country?.currency || DEFAULT_FORMAT_CONFIG.currency,
  };
}

export function formatCurrency(
  value: number | null | undefined,
  config: FormatConfig = DEFAULT_FORMAT_CONFIG,
): string {
  if (value == null) return "\u2014";
  const symbol = currencySymbol(config.currency);
  return `${symbol}${Number(value).toLocaleString(config.locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function formatDate(
  date: string | Date | null | undefined,
  config: FormatConfig = DEFAULT_FORMAT_CONFIG,
): string {
  if (!date) return "\u2014";
  const d = typeof date === "string" ? new Date(date) : date;
  return d.toLocaleDateString(config.locale, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export function formatLabel(value: string): string {
  return value
    .replace(/_/g, " ")
    .toLowerCase()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

export function roundCurrency(value: number): number {
  return Math.round(value * 100) / 100;
}
