/**
 * Shared crew-conflict primitives — extracted from `crewAvailability.ts`'s
 * `conflicts` query (WS3 #942) so the new org-wide Overbookings & Gaps board
 * ("crew double-bookings" section, `overbookingBoard.ts`) reuses the EXACT same
 * severity model instead of re-deriving it. Both live in `convex/`, so (unlike
 * the `src/lib` duplication elsewhere) a normal import is fine — no bundler
 * alias problem, no byte-for-byte pin needed.
 *
 * Severity model: an `UNAVAILABLE` availability block is `hard` (the member
 * told you they're out); `TENTATIVE`/`PREFERRED` blocks and every overlapping,
 * non-excluded assignment are `soft` — an assignment conflict is never `hard`
 * today (a crew member CAN legitimately be pencilled onto two quoted jobs; it's
 * a scheduling risk, not a hard block).
 */

/** Assignment statuses that don't actually hold the crew member's time. */
export const EXCLUDED_ASSIGNMENT_STATUSES: ReadonlySet<string> = new Set(["CANCELLED", "DECLINED"]);

export function overlaps(aStart: number, aEnd: number, rStart: number, rEnd: number): boolean {
  return aStart <= rEnd && aEnd >= rStart;
}

export function iso(ms: number | null | undefined): string | null {
  return ms == null ? null : new Date(ms).toISOString();
}

export type ConflictSeverity = "hard" | "soft";

/** Severity + label for an availability block, keyed off its `type`. */
export function classifyAvailabilityBlock(type: string | null | undefined, reason: string | null | undefined): { severity: ConflictSeverity; label: string } {
  const t = type ?? "UNAVAILABLE";
  if (t === "UNAVAILABLE") return { severity: "hard", label: `Unavailable${reason ? `: ${reason}` : ""}` };
  if (t === "TENTATIVE") return { severity: "soft", label: `Tentative${reason ? `: ${reason}` : ""}` };
  return { severity: "soft", label: `Preferred${reason ? `: ${reason}` : ""}` };
}
