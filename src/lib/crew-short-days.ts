import { formatWeekday } from "@/lib/formatters";

/**
 * Words for a run's short days (UX Phase 15, B1): the server's per-day
 * shortfall (`convex/lib/crewShortfall.ts`) names each short day as a UTC
 * midnight; this prints them where a surface has room — `Tue, Wed short`.
 *
 * Only a multi-day run gets words: a one-day service short of people is short
 * on its one day, which its date already says.
 */
const DAY_MS = 86_400_000;
const MAX_NAMED = 3;

/** A UTC-midnight day as a local-noon Date, so the weekday never slips a day. */
function weekdayOf(dayMs: number): string {
  const d = new Date(dayMs);
  return formatWeekday(new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 12));
}

export interface ShortDaysRun {
  date?: number | null;
  endDate?: number | null;
  shortDays?: readonly { day: number }[];
}

const isRun = (r: ShortDaysRun) => r.date != null && r.endDate != null && Math.floor(r.endDate / DAY_MS) > Math.floor(r.date / DAY_MS);

/** `Tue, Wed short` / `Mon, Tue, Wed +2 short`, or "" for a one-day service (or none short). */
export function shortDaysText(r: ShortDaysRun): string {
  if (!isRun(r) || !r.shortDays?.length) return "";
  const named = r.shortDays.slice(0, MAX_NAMED).map((d) => weekdayOf(d.day));
  const more = r.shortDays.length - named.length;
  return `${named.join(", ")}${more > 0 ? ` +${more}` : ""} short`;
}
