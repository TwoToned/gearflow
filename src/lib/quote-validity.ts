import { datePartsInTimezone, type ProjectNumberDateParts } from "@/lib/project-number";

/**
 * Quote validity + expiry maths (#986) — the SINGLE definition of "how long is a
 * quote valid" and "has it expired", shared by the send mutation
 * (`convex/quotesWrites.ts`), the Finance tab and the PDF. Before #986 the
 * default `30` was hand-copied into `document-settings.tsx` and
 * `build-document-data.ts`, and validity was computed from `now` **at render
 * time** — so re-opening a quote silently extended how long it was valid
 * (`build-document-data.ts` L672-673). `validUntil` is now stamped once, at
 * send, and only ever read back.
 *
 * Every day-boundary calculation resolves in the ORG's timezone, never the
 * browser's or the server's — a quote must not expire a day early for a PM in
 * another state (`docs/designs/finance-workflow-ux.md` §3.5). All of it is pure:
 * `convex/lib/quoteDates.ts` is a byte-for-byte mirror (the Convex bundler can't
 * resolve `@/`), pinned by `convex/quoteDates.test.ts`.
 */

/** Days a quote stays valid from its quote date when the org hasn't set one. */
export const DEFAULT_QUOTE_VALIDITY_DAYS = 30;

/** Bounds on `OrgDocumentSettings.quoteValidityDays` and the send dialog's
 *  "valid for" input. Mirrored server-side via `assertNumRange` (R-8.6.2) and by
 *  `orgDocumentSettingsSchema` — one definition, both ends. */
export const QUOTE_VALIDITY_BOUNDS = { min: 1, max: 365 } as const;

/** A sent quote inside this many days of `validUntil` reads as "expiring soon"
 *  (warning intent). Authoritative for BOTH the per-project Finance tab and the
 *  org-level Finance section's "Expiring" bucket — R-3.1. */
export const QUOTE_EXPIRING_SOON_DAYS = 7;

const MS_PER_DAY = 86_400_000;

/**
 * The UTC-instant offset of `timezone` at a given instant, in ms
 * (`local - UTC`; e.g. +10h for Australia/Sydney in winter). Returns 0 for an
 * unresolvable timezone, matching `datePartsInTimezone`'s fallback posture —
 * a bad timezone string degrades to UTC rather than throwing inside a mutation.
 */
function timezoneOffsetMs(instantMs: number, timezone?: string): number {
  if (!timezone) return 0;
  try {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      hour12: false,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    }).formatToParts(new Date(instantMs));
    const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
    const year = get("year");
    const month = get("month");
    const day = get("day");
    // Some ICU versions emit hour "24" for midnight under hour12:false.
    const hour = get("hour") % 24;
    const minute = get("minute");
    const second = get("second");
    if (![year, month, day, hour, minute, second].every((n) => Number.isFinite(n))) return 0;
    const asUtc = Date.UTC(year, month - 1, day, hour, minute, second);
    // instantMs may carry sub-second precision the formatter dropped — floor to
    // the second on both sides so the offset lands on a whole minute.
    return asUtc - Math.floor(instantMs / 1000) * 1000;
  } catch {
    return 0;
  }
}

/**
 * The UTC instant for a wall-clock time on a calendar date IN `timezone`.
 * Two-pass: the first pass guesses with the offset in force at the naive UTC
 * instant, the second re-resolves the offset at that guess — which is what makes
 * it correct across a DST boundary (the offset that applies is the one at the
 * *result*, not at the naive input).
 */
function zonedWallClockToUtc(
  parts: ProjectNumberDateParts,
  time: { hour: number; minute: number; second: number; ms: number },
  timezone?: string,
): number {
  const naive = Date.UTC(parts.year, parts.month - 1, parts.day, time.hour, time.minute, time.second, time.ms);
  const firstPass = naive - timezoneOffsetMs(naive, timezone);
  return naive - timezoneOffsetMs(firstPass, timezone);
}

/** Add `days` calendar days to a Y/M/D triple. Pure UTC arithmetic — UTC has no
 *  DST, so "add a day" can't land on a phantom or doubled local hour here; the
 *  timezone only re-enters when the result is converted back to an instant. */
export function addCalendarDays(parts: ProjectNumberDateParts, days: number): ProjectNumberDateParts {
  const shifted = new Date(Date.UTC(parts.year, parts.month - 1, parts.day) + days * MS_PER_DAY);
  return { year: shifted.getUTCFullYear(), month: shifted.getUTCMonth() + 1, day: shifted.getUTCDate() };
}

/** First instant (00:00:00.000 local) of the calendar day `instantMs` falls on
 *  in `timezone`. Used to normalise a user-picked `quoteDate` so the date printed
 *  on the PDF doesn't shift with the submitting browser's clock. */
export function startOfDayInTimezone(instantMs: number, timezone?: string): number {
  const parts = datePartsInTimezone(new Date(instantMs), timezone);
  return zonedWallClockToUtc(parts, { hour: 0, minute: 0, second: 0, ms: 0 }, timezone);
}

/** Last instant (23:59:59.999 local) of the calendar day `instantMs` falls on
 *  in `timezone` — a quote stays valid through the whole of its final day. */
export function endOfDayInTimezone(instantMs: number, timezone?: string): number {
  const parts = datePartsInTimezone(new Date(instantMs), timezone);
  return zonedWallClockToUtc(parts, { hour: 23, minute: 59, second: 59, ms: 999 }, timezone);
}

/**
 * `validUntil` for a quote: the END of the calendar day `validityDays` after the
 * quote date, in the org's timezone. A quote dated 26 Jul valid for 30 days runs
 * through the end of 25 Aug.
 */
export function computeValidUntil(quoteDateMs: number, validityDays: number, timezone?: string): number {
  const start = datePartsInTimezone(new Date(quoteDateMs), timezone);
  const end = addCalendarDays(start, validityDays);
  return zonedWallClockToUtc(end, { hour: 23, minute: 59, second: 59, ms: 999 }, timezone);
}

/** Whether a stamped `validUntil` has passed. Timezone-free by construction —
 *  `validUntil` is already an absolute instant resolved in the org's timezone. */
export function isPastValidUntil(validUntil: number | null | undefined, nowMs: number): boolean {
  return validUntil != null && validUntil < nowMs;
}

/** Whole days remaining until `validUntil` (negative once past, 0 on the final
 *  day). Drives the `≤7 days` warning copy in the Finance tab. */
export function daysUntilValidUntil(validUntil: number | null | undefined, nowMs: number): number | null {
  if (validUntil == null) return null;
  return Math.floor((validUntil - nowMs) / MS_PER_DAY);
}

/** Resolve the org's configured quote validity, clamped to the supported bounds.
 *  A stored value outside them (hand-edited settings blob) falls back to the
 *  default rather than minting an absurd `validUntil`. */
export function resolveQuoteValidityDays(configured: number | null | undefined): number {
  if (configured == null || !Number.isInteger(configured)) return DEFAULT_QUOTE_VALIDITY_DAYS;
  if (configured < QUOTE_VALIDITY_BOUNDS.min || configured > QUOTE_VALIDITY_BOUNDS.max) {
    return DEFAULT_QUOTE_VALIDITY_DAYS;
  }
  return configured;
}
