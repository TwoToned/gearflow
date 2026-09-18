import { startOfDayInTimezone } from "./quoteDates";

/**
 * "Rotting" day-boundary maths — Phase 3 (#1245, design §8.4). A client's
 * pipeline card shades by how many CALENDAR DAYS have passed since its last
 * timeline touch, resolved in the ORG's timezone (never the browser's or
 * UTC — same rule `quoteDates.ts` enforces for quote validity).
 *
 * Kept as its own module rather than added to `convex/lib/quoteDates.ts`:
 * that file is a byte-for-byte mirror of `src/lib/quote-validity.ts`, pinned
 * by a cross-import equality test — adding unrelated helpers there would
 * force a matching (and pointless) edit on the src/lib side. This module
 * only ever needs to exist on the Convex side (rotting is computed
 * server-side and read by the browser as a plain number), so no mirror is
 * needed.
 */

const MS_PER_DAY = 86_400_000;

/** Whole calendar days between `pastMs` and `nowMs`, resolved in `timezone`.
 *  Floors at 0 (never negative) — a timestamp that is technically in the
 *  future relative to `nowMs` reads as "today", not as a negative rot. */
export function daysSinceInTimezone(pastMs: number, nowMs: number, timezone?: string): number {
  const pastDay = startOfDayInTimezone(pastMs, timezone);
  const nowDay = startOfDayInTimezone(nowMs, timezone);
  return Math.max(0, Math.round((nowDay - pastDay) / MS_PER_DAY));
}

/** Defaults for `OrgWorkSettings.rottingAmberDays`/`rottingErrorDays`
 *  (`src/lib/org-settings-types.ts`) — an org that hasn't configured either
 *  gets these (design §8.4: "amber after 7, error tint after 14"). */
export const DEFAULT_ROTTING_AMBER_DAYS = 7;
export const DEFAULT_ROTTING_ERROR_DAYS = 14;

export type RottingLevel = "none" | "amber" | "error";

/** Which shade a card gets for `daysSince` its client's last timeline touch. */
export function rottingLevel(daysSince: number, amberDays: number, errorDays: number): RottingLevel {
  if (daysSince >= errorDays) return "error";
  if (daysSince >= amberDays) return "amber";
  return "none";
}

/** Clamp a configured threshold to a sane range — a hand-edited settings blob
 *  (or a bad org-settings write) degrades to the default rather than
 *  producing an absurd or negative threshold. Mirrors the guard shape
 *  `resolveQuoteValidityDays` uses for quote validity. */
export function resolveRottingDays(configured: number | null | undefined, fallback: number): number {
  if (configured == null || !Number.isFinite(configured) || !Number.isInteger(configured)) return fallback;
  if (configured < 1 || configured > 365) return fallback;
  return configured;
}
