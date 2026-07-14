/**
 * Public shapes for the reservation-conflict surface (Phase 3 browser-direct
 * re-homing). Relocated out of the deleted server action's import chain so the
 * banner can import them from a plain module. The conflict-detection logic now
 * lives in `convex/reservationConflicts.ts` (+ `convex/lib/reservationConflicts.ts`);
 * these are the shapes those queries return. Dates are epoch-ms (the banner does not
 * render them; kept for completeness).
 */

export interface ReservationConflict {
  lineItemId: string;
  assetId: string;
  assetTag: string;
  modelId: string;
  modelName: string;
  /** The other project this asset is also booked on. */
  conflictingProject: {
    id: string;
    projectNumber: string;
    name: string;
    status: string;
    rentalStartDate: number | null;
    rentalEndDate: number | null;
  };
  conflictingLineItemId: string;
}

export interface SwapCandidate {
  assetId: string;
  assetTag: string;
  serialNumber: string | null;
  customName: string | null;
  status: string;
}
