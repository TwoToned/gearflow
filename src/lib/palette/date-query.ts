/**
 * Date words the ⌘K palette understands (UX Phase 11, §6d.3): typing a date
 * lists that day's jobs. Pure: the reference year comes from the caller's
 * stable `now`, never a fresh clock read.
 *
 *   ISO        2026-11-14
 *   numeric    14/11/26 · 14-11-2026 · 14.11.26 · 14/11 (this year)
 *   words      14 nov · 14 November · nov 14 (this year)
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

function parseNumeric(s: string, refYear: number): Date | null {
  const iso = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/);
  if (iso) return day(+iso[1], +iso[2] - 1, +iso[3]);
  const dmy = s.match(/^(\d{1,2})[-/.](\d{1,2})(?:[-/.](\d{2}|\d{4}))?$/);
  if (dmy) return day(fullYear(dmy[3], refYear), +dmy[2] - 1, +dmy[1]);
  return null;
}

function parseWords(s: string, refYear: number): Date | null {
  const dm = s.match(/^(\d{1,2})\s+([a-z]+)(?:\s+(\d{4}))?$/i);
  if (dm && monthIndex(dm[2]) >= 0) return day(fullYear(dm[3], refYear), monthIndex(dm[2]), +dm[1]);
  const md = s.match(/^([a-z]+)\s+(\d{1,2})(?:\s+(\d{4}))?$/i);
  if (md && monthIndex(md[1]) >= 0) return day(fullYear(md[3], refYear), monthIndex(md[1]), +md[2]);
  return null;
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

/** The whole input as a date, or null. `now` only supplies the year for `14/11` / `14 nov`. */
export function parsePaletteDate(input: string, now: number): PaletteDate | null {
  const s = input.trim();
  if (!s) return null;
  const refYear = new Date(now).getFullYear();
  const d = parseNumeric(s, refYear) ?? parseWords(s, refYear);
  return d ? describe(d) : null;
}

/**
 * A date at the START of the input, then optional search words
 * (`14 nov drum shield`, `26/01/2026 aura`). The longest date wins, so
 * `14 nov` beats `14`.
 */
export function splitDateQuery(input: string, now: number): { date: PaletteDate; rest: string } | null {
  const words = input.trim().split(/\s+/).filter(Boolean);
  for (let n = Math.min(3, words.length); n >= 1; n--) {
    const date = parsePaletteDate(words.slice(0, n).join(" "), now);
    if (date) return { date, rest: words.slice(n).join(" ") };
  }
  return null;
}
