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

// ─── WS8 (#947) — status-keyed assignment severity + shared per-member signal ──
//
// The severity model ABOVE (an assignment-vs-assignment conflict is always
// `soft`) stays the org-wide Overbookings board's rule (`overbookingBoard.ts`'s
// `computeCrewDoubleBookings`, untouched by this file's new exports). The
// crew-picker (`crewAssignments.membersForAssignment` / `conflictsForProject`)
// and the assignment edit dialog (`crewAvailability.conflicts`) intentionally
// upgrade that rule instead: an overlapping assignment's OWN status tells you
// how real the hold is — CONFIRMED/ACCEPTED/COMPLETED actually holds the
// member's time ("Booked"), PENDING/OFFERED is still speculative
// ("Pencilled") — mirroring the two-layer pencil rule's hard/pencilled split
// (`isConfirmedOrLater` in availabilityCore.ts) but keyed off the
// ASSIGNMENT's status, not the project's.

/** Assignment statuses whose hold on the crew member's time is "real" (hard). */
export const HARD_ASSIGNMENT_STATUSES: ReadonlySet<string> = new Set(["CONFIRMED", "ACCEPTED", "COMPLETED"]);

/** Severity + "Booked:"/"Pencilled:" label for an overlapping assignment, by its own status. */
export function classifyAssignmentConflict(
  status: string | null | undefined,
  project: { projectNumber: string; name: string } | null,
): { severity: ConflictSeverity; label: string } {
  const severity: ConflictSeverity = HARD_ASSIGNMENT_STATUSES.has(status ?? "") ? "hard" : "soft";
  const verb = severity === "hard" ? "Booked" : "Pencilled";
  const projectLabel = project ? `${project.projectNumber} - ${project.name}` : "another project";
  return { severity, label: `${verb}: ${projectLabel}` };
}

export interface MemberConflictAssignment {
  id: string;
  projectId: string;
  serviceId?: string | null;
  status?: string | null;
  startDate?: number | null;
  endDate?: number | null;
}

export interface MemberConflictBlock {
  type?: string | null;
  reason?: string | null;
  startDate: number;
  endDate: number;
}

export interface MemberConflictEntry {
  crewMemberId?: string;
  projectId: string;
  project: { projectNumber: string; name: string } | null;
  startDate: string | null;
  endDate: string | null;
  severity: ConflictSeverity;
  label: string;
  status: string | null;
}

export interface MemberConflictSignal {
  conflicts: MemberConflictEntry[];
  isUnavailable: boolean;
  /** Ported precedence from the deleted `src/lib/crew-scheduling-read.ts`
   *  `computeAvailabilityStatus` (WS8 #947): UNAVAILABLE wins outright, else
   *  TENTATIVE (only if still "available"), else "busy" (an overlapping
   *  non-excluded assignment, only if still "available"), default "available".
   *  PREFERRED never appears here (the dead function didn't handle it either)
   *  — see `hasPreferredBlock` for that positive-hint signal instead. */
  availability: "available" | "tentative" | "unavailable" | "busy";
  /** A PREFERRED availability block overlaps the range — render as a positive
   *  hint (green), never a conflict. Additive: independent of `availability`. */
  hasPreferredBlock: boolean;
}

/**
 * ONE pure per-crew-member conflict signal — shared by `crewAssignments.ts`'s
 * `membersForAssignment` (picker) and `conflictsForProject` (crew table), so
 * the severity/availability rules live in exactly one place (POLICY.md
 * R-3.1/R-8.2.4). `otherAssignments` should already exclude the assignment
 * being evaluated itself (by id) when the caller has one in hand; excluded
 * ASSIGNMENT statuses (CANCELLED/DECLINED) and `excludeServiceId`'s own rows
 * are filtered here.
 */
export function computeMemberConflictSignal(opts: {
  crewMemberId?: string;
  blocks: MemberConflictBlock[];
  otherAssignments: MemberConflictAssignment[];
  excludeServiceId?: string | null;
  rangeStart: number;
  rangeEnd: number;
  projectsById: Map<string, { projectNumber: string; name: string }>;
}): MemberConflictSignal {
  const { crewMemberId, blocks, otherAssignments, excludeServiceId, rangeStart, rangeEnd, projectsById } = opts;

  const overlappingBlocks = blocks.filter((b) => overlaps(b.startDate, b.endDate, rangeStart, rangeEnd));
  const hasPreferredBlock = overlappingBlocks.some((b) => b.type === "PREFERRED");

  let availability: MemberConflictSignal["availability"] = "available";
  for (const b of overlappingBlocks) {
    const t = b.type ?? "UNAVAILABLE";
    if (t === "UNAVAILABLE") {
      availability = "unavailable";
    } else if (t === "TENTATIVE" && availability === "available") {
      availability = "tentative";
    }
  }
  const isUnavailable = availability === "unavailable";

  const conflictingAssignments = otherAssignments.filter(
    (a) =>
      !EXCLUDED_ASSIGNMENT_STATUSES.has(a.status ?? "") &&
      a.startDate != null &&
      a.endDate != null &&
      overlaps(a.startDate, a.endDate, rangeStart, rangeEnd) &&
      !(excludeServiceId != null && a.serviceId === excludeServiceId),
  );
  if (availability === "available" && conflictingAssignments.length > 0) availability = "busy";

  const conflicts: MemberConflictEntry[] = conflictingAssignments.map((a) => {
    const p = projectsById.get(a.projectId) ?? null;
    const { severity, label } = classifyAssignmentConflict(a.status, p);
    return {
      crewMemberId,
      projectId: a.projectId,
      project: p,
      startDate: iso(a.startDate ?? null),
      endDate: iso(a.endDate ?? null),
      severity,
      label,
      status: a.status ?? null,
    };
  });

  return { conflicts, isUnavailable, availability, hasPreferredBlock };
}

/**
 * Collapse a `MemberConflictSignal` down to the ONE hard/soft severity a
 * server-side consumer keys a row on (e.g. `conflictsForProject`'s per-
 * assignment map) — same precedence as the client's `pickConflictBadge`
 * (services-panel.tsx), minus the client's extra "preferred" positive-hint
 * tier (this returns `null` there, matching "no conflict"). Extracted so
 * callers don't re-derive the if/else chain (keeps handler complexity low —
 * R-3.6).
 */
export function pickConflictSeverity(signal: MemberConflictSignal): { severity: ConflictSeverity; label: string } | null {
  if (signal.isUnavailable) return { severity: "hard", label: "Unavailable" };
  const hardConflict = signal.conflicts.find((c) => c.severity === "hard");
  if (hardConflict) return { severity: "hard", label: hardConflict.label };
  if (signal.availability === "tentative") return { severity: "soft", label: "Tentative" };
  const softConflict = signal.conflicts.find((c) => c.severity === "soft");
  if (softConflict) return { severity: "soft", label: softConflict.label };
  return null;
}
