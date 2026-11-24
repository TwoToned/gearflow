/**
 * Date words the ⌘K palette understands (UX Phase 11, §6d.3): typing a date
 * lists that day's jobs. Pure: the reference year comes from the caller's
 * stable `now`, never a fresh clock read.
 *
 *   ISO        2026-11-14
 *   numeric    14/11/26 · 14-11-2026 · 14.11.26 · 14/11 (this year, whole input only)
 *   words      14 nov 2026 · 14 nov · nov 14 (this year, whole input only)
 *
 * Decimals and fractions are gear (`2.4`, `1.5 m XLR`, `1/4 inch jack`): a
 * yearless date must be the whole input and `d/m` with a slash, and the plain
 * search still runs alongside any date (`use-palette-state.ts`).
 */

import { formatDateDayMonth, formatDateLong } from "@/lib/formatters";

const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];

export interface PaletteDate {
  /** Local midnight of the day. */
  date: Date;
  /** Local `YYYY-MM-DD` (never `toISOString`, which is UTC). */
  iso: string;
  /** `14 Nov` */
  label: string;
  /** `Saturday, 14 November 2026` */
  long: string;
  /** The day as a window for the Jobs list query (local midnight to 23:59:59.999). */
  dayStart: number;
  dayEnd: number;
}

/** A real calendar day, or null (31/02 is not a date). */
function day(year: number, month: number, dayOfMonth: number): Date | null {
  const d = new Date(year, month, dayOfMonth);
  return d.getFullYear() === year && d.getMonth() === month && d.getDate() === dayOfMonth ? d : null;
}

/** `nov`, `novem`, `november` (3+ letters of one month, nothing extra), else -1. `sept` reads as September. */
function monthIndex(word: string): number {
  const w = word.toLowerCase();
  return w.length >= 3 ? MONTHS.findIndex((m) => m.startsWith(w)) : -1;
}

function fullYear(y: string | undefined, refYear: number): number {
  if (!y) return refYear;
  const n = +y;
  return n < 100 ? 2000 + n : n;
}

/**
 * Numbers with separators. A YEAR makes any separator a date (`14.11.26`,
 * `14-11-2026`, ISO); WITHOUT one only `d/m` is, and only when `yearless` is
 * allowed (the whole input) — `2.4`, `1.5 m XLR` and `1/4 inch jack` are
 * everyday gear searches, not dates.
 */
function parseNumeric(s: string, refYear: number, yearless: boolean): Date | null {
  const iso = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/);
  if (iso) return day(+iso[1], +iso[2] - 1, +iso[3]);
  const dmy = s.match(/^(\d{1,2})([-/.])(\d{1,2})\2(\d{2}|\d{4})$/);
  if (dmy) return day(fullYear(dmy[4], refYear), +dmy[3] - 1, +dmy[1]);
  const dm = yearless ? s.match(/^(\d{1,2})\/(\d{1,2})$/) : null;
  return dm ? day(refYear, +dm[2] - 1, +dm[1]) : null;
}

/** `14 nov`, `nov 14` (yearless: whole input only) or with a year anywhere. */
function parseWords(s: string, refYear: number, yearless: boolean): Date | null {
  const dm = s.match(/^(\d{1,2})\s+([a-z]+)(?:\s+(\d{4}))?$/i);
  const md = s.match(/^([a-z]+)\s+(\d{1,2})(?:\s+(\d{4}))?$/i);
  const parts = dm ? { d: dm[1], m: dm[2], y: dm[3] } : md ? { d: md[2], m: md[1], y: md[3] } : null;
  if (!parts || monthIndex(parts.m) < 0 || (!parts.y && !yearless)) return null;
  return day(fullYear(parts.y, refYear), monthIndex(parts.m), +parts.d);
}

function describe(d: Date): PaletteDate {
  const pad = (n: number) => String(n).padStart(2, "0");
  const dayEnd = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1).getTime() - 1;
  return {
    date: d,
    iso: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
    label: formatDateDayMonth(d),
    long: formatDateLong(d),
    dayStart: d.getTime(),
    dayEnd,
  };
}

function parse(s: string, now: number, yearless: boolean): PaletteDate | null {
  const refYear = new Date(now).getFullYear();
  const d = parseNumeric(s, refYear, yearless) ?? parseWords(s, refYear, yearless);
  return d ? describe(d) : null;
}

/**
 * The WHOLE input as a date, or null. Yearless dates (`14/11`, `14 nov`) only
 * count here, as the entire input; `now` only supplies their year.
 */
export function parsePaletteDate(input: string, now: number): PaletteDate | null {
  const s = input.trim();
  return s ? parse(s, now, true) : null;
}

/**
 * The whole input as a date, or a date WITH A YEAR at the start followed by
 * search words (`26/01/2026 aura`, `14 nov 2026 drum`). A yearless date never
 * takes words after it, so `1/4 inch jack` stays a search.
 */
export function splitDateQuery(input: string, now: number): { date: PaletteDate; rest: string } | null {
  const whole = parsePaletteDate(input, now);
  if (whole) return { date: whole, rest: "" };
  const words = input.trim().split(/\s+/).filter(Boolean);
  for (let n = Math.min(3, words.length - 1); n >= 1; n--) {
    const date = parse(words.slice(0, n).join(" "), now, false);
    if (date) return { date, rest: words.slice(n).join(" ") };
  }
  return null;
}
