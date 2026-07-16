/**
 * Configurable auto-incrementing project numbers — PURE renderers, copied
 * byte-for-byte from src/lib/project-number.ts.
 *
 * The Convex bundler can't resolve the `@/` alias, so the pure functions the
 * native createNative auto-number loop needs (`renderProjectNumber`,
 * `scopeKeyFor`, `datePartsInTimezone`, `hasIncrementToken`) are duplicated here.
 * PINNED to the src/lib originals by a cross-import equality test in
 * `convex/projectNumber.test.ts` (same pattern as `convex/lib/availabilityCore`
 * and `convex/lib/blockingCommentsGate`). Do NOT diverge from the src/lib copy.
 */

export type IncrementReset = "NONE" | "YEARLY" | "MONTHLY" | "DAILY";

export interface ProjectNumberDateParts {
  /** Full year, e.g. 2026. */
  year: number;
  /** 1-12. */
  month: number;
  /** 1-31. */
  day: number;
}

export const DEFAULT_INCREMENT_PADDING = 2;

/** The tokens that render the sequence counter (any one of these makes numbers unique). */
const INCREMENT_TOKENS = ["%INCREMENT", "%INC", "%SEQ"] as const;

/** True if the template contains at least one increment token. */
export function hasIncrementToken(format: string): boolean {
  return INCREMENT_TOKENS.some((t) => format.includes(t));
}

/** The counter-bucket key for a given reset period + date. */
export function scopeKeyFor(reset: IncrementReset, parts: ProjectNumberDateParts): string {
  const yyyy = String(parts.year).padStart(4, "0");
  const mm = String(parts.month).padStart(2, "0");
  const dd = String(parts.day).padStart(2, "0");
  switch (reset) {
    case "YEARLY":
      return yyyy;
    case "MONTHLY":
      return `${yyyy}-${mm}`;
    case "DAILY":
      return `${yyyy}-${mm}-${dd}`;
    case "NONE":
    default:
      return "GLOBAL";
  }
}

/**
 * Render the template. Longer tokens are substituted before their prefixes
 * (%YYYY before %YY, %MM before %M, %INCREMENT before %INC) so they don't clash.
 */
export function renderProjectNumber(
  format: string,
  opts: { parts: ProjectNumberDateParts; sequence: number; padding?: number },
): string {
  const { parts, sequence } = opts;
  const padding = opts.padding ?? DEFAULT_INCREMENT_PADDING;
  const yyyy = String(parts.year).padStart(4, "0");
  const yy = yyyy.slice(-2);
  const mm = String(parts.month).padStart(2, "0");
  const dd = String(parts.day).padStart(2, "0");
  const seq = String(sequence).padStart(Math.max(1, padding), "0");

  return format
    .replace(/%YYYY/g, yyyy)
    .replace(/%YY/g, yy)
    .replace(/%MM/g, mm)
    .replace(/%M/g, String(parts.month))
    .replace(/%DD/g, dd)
    .replace(/%D/g, String(parts.day))
    .replace(/%INCREMENT/g, seq)
    .replace(/%INC/g, seq)
    .replace(/%SEQ/g, seq);
}

/**
 * Compute date parts for a Date in a given IANA timezone (no external deps).
 * Defaults to the system zone if tz is omitted/invalid.
 */
export function datePartsInTimezone(date: Date, timezone?: string): ProjectNumberDateParts {
  try {
    const fmt = new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone || undefined,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
    const parts = fmt.formatToParts(date);
    const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
    const year = get("year");
    const month = get("month");
    const day = get("day");
    if (!year || !month || !day) throw new Error("bad parts");
    return { year, month, day };
  } catch {
    return { year: date.getFullYear(), month: date.getMonth() + 1, day: date.getDate() };
  }
}
