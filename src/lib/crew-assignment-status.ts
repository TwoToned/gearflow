/**
 * "Does this crew assignment actually count as filled?" — the single
 * predicate for "is this slot staffed" across the app.
 *
 * Bug fixed by WS3 (#942): `services-panel.tsx`'s crew-avatar-stack /
 * "N needed — none assigned" / "(x/y)" predicates used to read raw
 * `crewAssignments.length`, so a DECLINED (or CANCELLED) assignment counted
 * identically to a CONFIRMED one — 2× DECLINED against `crewCountRequired: 2`
 * silently rendered as fully staffed. `FILLED_ASSIGNMENT_STATUSES` excludes
 * exactly the two "this slot is NOT actually held" statuses, mirroring
 * `convex/crewAvailability.ts`'s own `EXCLUDED = new Set(["CANCELLED", "DECLINED"])`
 * pattern (same exclusion, different call site) — the Convex-side Overbookings
 * & Gaps board ("services missing crew" section) re-declares the same two
 * literals locally (Convex functions can't import `src/lib`), so treat the two
 * as one source of truth even though they're physically two files.
 */
export const NON_FILLED_ASSIGNMENT_STATUSES: ReadonlySet<string> = new Set([
  "DECLINED",
  "CANCELLED",
]);

/** True when an assignment with this status counts toward "crew filled". */
export function isFilledAssignmentStatus(status: string | null | undefined): boolean {
  return status == null || !NON_FILLED_ASSIGNMENT_STATUSES.has(status);
}
