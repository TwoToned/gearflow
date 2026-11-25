import { addDays, differenceInCalendarDays, format, isValid, parseISO } from "date-fns";
import { getProjectWindowDates } from "@/lib/project-window";

/**
 * The job form's date helpers, shared by the wizard and the edit sheet (R-3.1:
 * one copy). Form dates are `yyyy-MM-dd` strings; stored dates are epoch-ms.
 */

export const toDateStr = (d?: Date): string => (d ? format(d, "yyyy-MM-dd") : "");

export function fromDateStr(s?: unknown): Date | undefined {
  if (!s) return undefined;
  const d = typeof s === "string" ? parseISO(s) : new Date(String(s));
  return isValid(d) ? d : undefined;
}

/** A stored date (ISO string, Date, epoch-ms or null) as the form's string, `undefined` when absent. */
export function normalizeDate(value?: unknown): string | undefined {
  const d = fromDateStr(value);
  return d ? toDateStr(d) : undefined;
}

/** A project-shaped record's gear window (`projectStart ?? rentalStart`, the
 *  same `getProjectWindow` rule) as epoch-ms, for #1227's date-move gate. */
export function resolveWindowMs(values: {
  projectStartDate?: unknown;
  projectEndDate?: unknown;
  rentalStartDate?: unknown;
  rentalEndDate?: unknown;
}): { start: number | null; end: number | null } {
  const { start, end } = getProjectWindowDates({
    projectStartDate: fromDateStr(values.projectStartDate) ?? null,
    projectEndDate: fromDateStr(values.projectEndDate) ?? null,
    rentalStartDate: fromDateStr(values.rentalStartDate) ?? null,
    rentalEndDate: fromDateStr(values.rentalEndDate) ?? null,
  });
  return { start: start ? start.getTime() : null, end: end ? end.getTime() : null };
}

interface RentalWindowStrings {
  rentalStartDate?: string;
  rentalEndDate?: string;
  projectStartDate?: string;
  projectEndDate?: string;
}

/**
 * D25: moving the rental dates carries a SET project window by the same offset.
 * Each side moves by the calendar-day delta of its own rental side, so a whole
 * move keeps the load-in / load-out padding and a one-sided change keeps the
 * window containing the rental. A blank window side stays blank (it means
 * "same as rental", R-3.1), and a side whose rental old or new value is blank
 * is left alone. Calendar days, so DST never shifts a date. Times are not here:
 * they are separate fields and keep their value.
 */
export function shiftWindowWithRental(
  before: RentalWindowStrings,
  after: RentalWindowStrings,
): { projectStartDate?: string; projectEndDate?: string } {
  const shift = (windowSide: string | undefined, from: string | undefined, to: string | undefined) => {
    const w = fromDateStr(windowSide);
    const a = fromDateStr(from);
    const b = fromDateStr(to);
    if (!w || !a || !b) return windowSide;
    const delta = differenceInCalendarDays(b, a);
    return delta === 0 ? windowSide : toDateStr(addDays(w, delta));
  };
  return {
    projectStartDate: shift(after.projectStartDate, before.rentalStartDate, after.rentalStartDate),
    projectEndDate: shift(after.projectEndDate, before.rentalEndDate, after.rentalEndDate),
  };
}
