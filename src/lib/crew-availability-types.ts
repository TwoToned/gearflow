/** Public shapes for the crew-availability surface (Phase 3 — relocated out of the
 *  deleted server action so consumers import from a plain module). */
export interface CrewConflict {
  type: "availability" | "assignment";
  severity: "hard" | "soft"; // hard = unavailable, soft = tentative or double-booked
  label: string;
  startDate: string;
  endDate: string;
}
