/**
 * Which crew-call (assignment) statuses each planner verb acts on (UX Phase 15,
 * spec §9h.3). ONE table: the server gates (`crewAssignmentsWrites`
 * `confirmManyNative` / `cancelManyNative`, the `sendCrewOffers` action) and
 * the planner's block ⋯ / bulk bar (`src/lib/row-actions/crew-call.ts`) read
 * it, so the menu never offers a verb the write would skip. Plain module: no
 * Convex runtime import, so `src/` can use it.
 */
export type CrewCallVerb = "offer" | "confirm" | "cancel";

const FROM: Record<CrewCallVerb, ReadonlySet<string>> = {
  // A call still waiting on an offer, or a resend of one already out.
  offer: new Set(["PENDING", "OFFERED"]),
  // Only a yes the crew member gave can be confirmed.
  confirm: new Set(["ACCEPTED"]),
  // Anything still standing; declined / completed / cancelled calls stay as they are.
  cancel: new Set(["PENDING", "OFFERED", "ACCEPTED", "CONFIRMED"]),
};

/** Cancelling a call in one of these tells the crew member (the offer reached them). */
export const TOLD_ON_CANCEL: ReadonlySet<string> = new Set(["OFFERED", "ACCEPTED", "CONFIRMED"]);

/** True when `verb` would change a call at `status` (absent status = PENDING). */
export function canCrewCall(status: string | null | undefined, verb: CrewCallVerb): boolean {
  return FROM[verb].has(status ?? "PENDING");
}
