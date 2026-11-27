/**
 * Which jobs may have their dates MOVED from the Schedule (UX Phase 18, §9o.5).
 * ONE rule, shared by the server's own write (`projectWrites.updateNative` with
 * `lockDates`) and the Schedule's menus (which only hide what the server would
 * refuse): a job whose gear is OUT (`CHECKED_OUT`, `ON_SITE`) has its dates
 * locked, and a finished or cancelled job keeps its dates. Plain module: Convex
 * and `src/` import it.
 *
 * It is an opt-in refusal (`lockDates: true` on the write), not a change to every
 * date edit: extending a hire from the job's own Logistics tab or edit sheet is a
 * separate surface and unchanged.
 */
import { ConvexError } from "convex/values";

/** The write fields that make an edit a date move. */
export const DATE_FIELDS = ["rentalStartDate", "rentalEndDate", "projectStartDate", "projectEndDate", "projectStartTime", "projectEndTime"] as const;

const OUT = new Set(["CHECKED_OUT", "ON_SITE"]);
const FINISHED = new Set(["RETURNED", "COMPLETED", "INVOICED", "CANCELLED"]);

/** Why this status's dates may not be moved from the Schedule, or null when they may. */
export function datesLockedReason(status: string | null | undefined): string | null {
  if (status && OUT.has(status)) return "Dates are locked while the gear is out.";
  if (status && FINISHED.has(status)) return "A finished job keeps its dates.";
  return null;
}

/** Throws `DATES_LOCKED` when `touched` includes a date field and the status locks them. */
export function assertDatesMovable(status: string | null | undefined, touched: readonly string[]): void {
  const reason = datesLockedReason(status);
  if (reason && touched.some((f) => (DATE_FIELDS as readonly string[]).includes(f))) {
    throw new ConvexError({ code: "DATES_LOCKED", message: reason });
  }
}
