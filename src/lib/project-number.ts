/**
 * Configurable auto-incrementing project numbers.
 *
 * Operators define a template with %-prefixed tokens; the engine renders it from
 * a date + a per-period sequence counter. Example: "%YY%MM%INC" with monthly
 * reset → the first June 2026 project is "260601", the 8th July project "260708".
 *
 * Pure functions only (no I/O) so they're trivially unit-testable. The server
 * supplies the date parts (computed in the org timezone) and the sequence value
 * pulled atomically from ProjectNumberSequence.
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

export interface ProjectNumberConfig {
  /** Template string, e.g. "%YY%MM%INC". Empty/undefined = auto-numbering disabled. */
  format?: string;
  /** When the increment counter resets back to 1. Default MONTHLY. */
  incrementReset?: IncrementReset;
  /** Zero-pad width for the increment token. Default 2. */
  incrementPadding?: number;
}

export const DEFAULT_INCREMENT_RESET: IncrementReset = "MONTHLY";
export const DEFAULT_INCREMENT_PADDING = 2;

/** The tokens that render the sequence counter (any one of these makes numbers unique). */
const INCREMENT_TOKENS = ["%INCREMENT", "%INC", "%SEQ"] as const;

/** Documentation for the settings UI. */
export const PROJECT_NUMBER_TOKENS: { token: string; description: string }[] = [
  { token: "%YYYY", description: "4-digit year (2026)" },
  { token: "%YY", description: "2-digit year (26)" },
  { token: "%MM", description: "2-digit month (06)" },
  { token: "%M", description: "month, no padding (6)" },
  { token: "%DD", description: "2-digit day (05)" },
  { token: "%D", description: "day, no padding (5)" },
  { token: "%INCREMENT", description: "auto-incrementing counter (also %INC or %SEQ)" },
];

/** True if the template contains at least one increment token. */
export function hasIncrementToken(format: string): boolean {
  return INCREMENT_TOKENS.some((t) => format.includes(t));
}

/**
 * Validate a template. Returns an error message, or null if valid. A template
 * without an increment token would make every project in a period collide, so
 * that's rejected.
 */
export function validateProjectNumberFormat(format: string): string | null {
  const trimmed = format.trim();
  if (!trimmed) return "Format cannot be empty";
  if (!hasIncrementToken(trimmed)) {
    return "Format must include an increment token (%INCREMENT, %INC, or %SEQ)";
  }
  if (trimmed.length > 60) return "Format is too long (max 60 characters)";
  return null;
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
