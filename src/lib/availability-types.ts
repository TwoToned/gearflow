/**
 * Public availability/booking shapes — relocated out of the deleted
 * `src/server/availability.ts` (a `"use server"` module can't be the home of types
 * the browser imports). The native `convex/availability.ts` queries return exactly
 * these shapes.
 */

export interface BookingEntry {
  id: string;
  projectId: string;
  projectNumber: string;
  projectName: string;
  clientName: string | null;
  projectStatus: string;
  /** ISO string (epoch-ms → toISOString); "" when unset. */
  rentalStartDate: string;
  rentalEndDate: string;
  quantity: number;
}

export interface CalendarProject {
  id: string;
  projectNumber: string;
  name: string;
  clientName: string | null;
  status: string;
  rentalStartDate: string;
  rentalEndDate: string;
  lineItemCount: number;
}
