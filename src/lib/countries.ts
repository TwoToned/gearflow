/**
 * The country table (I1, #1079) — single source of truth (POLICY.md R-3.1) for
 * every country-derived property: currency, date format, decimal separator,
 * week start, paper size, unit system, tax label/default rate, and the
 * business-number label. Feeds the setup wizard's country step (Phase C),
 * `formatters.ts` (I2), the document composer (I4/I5), and calendar/unit
 * settings (I6).
 *
 * Adding a country is a data row, not code — that's the test of whether this
 * module is doing its job. Don't redeclare any of this shape elsewhere
 * (a second country→label map is a defect even in sync, per CLAUDE.md).
 *
 * See docs/designs/multi-tenant-and-international.md §1a for the country
 * table this mirrors, and decisions M1/M6/M7.
 */

/**
 * These aren't exported individually — nothing outside this file needs to
 * name them yet, and an exported-but-unimported type is dead code (R-4.2,
 * the knip ratchet). A consumer that needs one can pull it off
 * `CountryDefinition["dateOrder"]` etc., or a real consumer can export it
 * from here when it lands.
 */
/** Launch markets (M1) + the two EU markets documented but disabled (M7). */
type CountryCode = "AU" | "NZ" | "GB" | "US" | "IE" | "NL" | "DE";

type DateOrder = "DMY" | "MDY";
type DateSeparator = "/" | ".";
type DecimalSeparator = "." | ",";
type WeekStart = "MON" | "SUN";
type PaperSize = "A4" | "LETTER";
type UnitSystem = "METRIC" | "IMPERIAL";

export interface CountryDefinition {
  code: CountryCode;
  name: string;
  /** ISO 4217 currency code. */
  currency: string;
  /** BCP-47 locale tag — the country's OWN locale, i.e. how an org based
   *  there formats its own documents (not the viewer's browser locale).
   *  Drives `Intl`-backed formatting in `formatters.ts` (I2): passing a
   *  country's own locale + currency to `Intl.NumberFormat`/`toLocaleDateString`
   *  reproduces dateOrder/decimalSeparator for free — they're kept as
   *  explicit fields too because non-Intl consumers (PDF layout math) need
   *  them without invoking `Intl`. */
  locale: string;
  dateOrder: DateOrder;
  dateSeparator: DateSeparator;
  /** Keyed off locale, not currency — IE and NL both use EUR, only NL writes
   *  `1.234,56`. Don't derive this from `currency`. */
  decimalSeparator: DecimalSeparator;
  weekStart: WeekStart;
  paperSize: PaperSize;
  units: UnitSystem;
  taxLabel: string;
  /** Genuinely absent (not 0) for the US — there is no national sales-tax
   *  rate. The wizard/settings UI must show this as unset, never invent a
   *  default (see #1088, the recalc.ts fallback this exact shape guards
   *  against repeating). */
  defaultTaxRate: number | null;
  businessNumberLabel: string;
  /** M7 — ships in this table but excluded from any country-selecting UI
   *  (wizard, settings) until decimal-comma input parsing (#1087) lands.
   *  Misreading a typed price by 100x is the worst failure available in a
   *  quoting tool, so NL/DE stay documented-but-off rather than half-done. */
  enabled: boolean;
}

export const COUNTRIES: readonly CountryDefinition[] = [
  {
    code: "AU",
    name: "Australia",
    currency: "AUD",
    locale: "en-AU",
    dateOrder: "DMY",
    dateSeparator: "/",
    decimalSeparator: ".",
    weekStart: "MON",
    paperSize: "A4",
    units: "METRIC",
    taxLabel: "GST",
    defaultTaxRate: 10,
    businessNumberLabel: "ABN",
    enabled: true,
  },
  {
    code: "NZ",
    name: "New Zealand",
    currency: "NZD",
    locale: "en-NZ",
    dateOrder: "DMY",
    dateSeparator: "/",
    decimalSeparator: ".",
    weekStart: "MON",
    paperSize: "A4",
    units: "METRIC",
    taxLabel: "GST",
    defaultTaxRate: 15,
    businessNumberLabel: "NZBN",
    enabled: true,
  },
  {
    code: "GB",
    name: "United Kingdom",
    currency: "GBP",
    locale: "en-GB",
    dateOrder: "DMY",
    dateSeparator: "/",
    decimalSeparator: ".",
    weekStart: "MON",
    paperSize: "A4",
    units: "METRIC",
    taxLabel: "VAT",
    defaultTaxRate: 20,
    businessNumberLabel: "VAT number",
    enabled: true,
  },
  {
    code: "US",
    name: "United States",
    currency: "USD",
    locale: "en-US",
    dateOrder: "MDY",
    dateSeparator: "/",
    decimalSeparator: ".",
    weekStart: "SUN",
    paperSize: "LETTER",
    units: "IMPERIAL",
    taxLabel: "Sales tax",
    defaultTaxRate: null,
    businessNumberLabel: "EIN",
    enabled: true,
  },
  {
    code: "IE",
    name: "Ireland",
    currency: "EUR",
    locale: "en-IE",
    dateOrder: "DMY",
    dateSeparator: "/",
    decimalSeparator: ".",
    weekStart: "MON",
    paperSize: "A4",
    units: "METRIC",
    taxLabel: "VAT",
    defaultTaxRate: 23,
    businessNumberLabel: "VAT number",
    enabled: true,
  },
  {
    code: "NL",
    name: "Netherlands",
    currency: "EUR",
    locale: "nl-NL",
    dateOrder: "DMY",
    dateSeparator: "/",
    decimalSeparator: ",",
    weekStart: "MON",
    paperSize: "A4",
    units: "METRIC",
    taxLabel: "BTW",
    defaultTaxRate: 21,
    businessNumberLabel: "BTW-nummer",
    enabled: false,
  },
  {
    code: "DE",
    name: "Germany",
    currency: "EUR",
    locale: "de-DE",
    dateOrder: "DMY",
    dateSeparator: ".",
    decimalSeparator: ",",
    weekStart: "MON",
    paperSize: "A4",
    units: "METRIC",
    taxLabel: "MwSt",
    defaultTaxRate: 19,
    businessNumberLabel: "USt-IdNr",
    enabled: false,
  },
] as const;

const COUNTRIES_BY_CODE: ReadonlyMap<CountryCode, CountryDefinition> = new Map(
  COUNTRIES.map((c) => [c.code, c]),
);

/** Look up a country by code. Returns `undefined` for an unknown/unset code —
 *  callers must decide their own fallback, this never guesses one. */
export function getCountry(code: string | null | undefined): CountryDefinition | undefined {
  return code ? COUNTRIES_BY_CODE.get(code as CountryCode) : undefined;
}

/** Countries selectable in a country-picking UI (wizard, settings) — excludes
 *  the M7-disabled rows (NL/DE) without deleting their data from the table. */
export function listEnabledCountries(): readonly CountryDefinition[] {
  return COUNTRIES.filter((c) => c.enabled);
}

export function isCountryEnabled(code: string | null | undefined): boolean {
  return getCountry(code)?.enabled ?? false;
}
