/**
 * Pure filter / sort / overlap predicates backing `getCrewMembersForAssignment`
 * (src/server/crew-assignments.ts) after its Phase A read-rewire to Convex.
 *
 * The server action fetches FLAT Convex rows (all org crew members, all org
 * assignments, availability blocks per member) and composes these pure helpers to
 * reproduce the old Prisma `where` / `orderBy` / `take` and the cross-project
 * conflict + availability-block logic. Kept side-effect-free so they're unit
 * tested directly. See FEATUREDOCS/54.
 */

/** Minimal crew-member shape this module reads (structural — Convex Doc satisfies it). */
export interface AssignableMemberLike {
  isActive?: boolean;
  status?: string;
  firstName: string;
  lastName: string;
  email?: string | null;
  department?: string | null;
}

/** Minimal assignment shape for cross-project conflict detection. */
export interface ConflictAssignmentLike {
  crewMemberId: string;
  projectId: string;
  status: string;
  startDate: Date | null;
  endDate: Date | null;
}

/** Minimal availability-block shape. */
export interface AvailabilityBlockLike {
  crewMemberId: string;
  type: string;
  startDate: Date;
  endDate: Date;
}

const CONFLICT_EXCLUDED_STATUSES = ["CANCELLED", "DECLINED"];

/**
 * Replicates the Prisma `where` for the member roster:
 *   { isActive: true, status: "ACTIVE", ...(search ? OR contains over
 *     firstName/lastName/email/department insensitive) }
 * `isActive` defaults to true when absent (Convex optional column).
 */
export function isAssignableMember(m: AssignableMemberLike, search?: string): boolean {
  if ((m.isActive ?? true) !== true) return false;
  if (m.status !== "ACTIVE") return false;
  if (!search) return true;
  const needle = search.toLowerCase();
  const haystacks = [m.firstName, m.lastName, m.email ?? "", m.department ?? ""];
  return haystacks.some((h) => h.toLowerCase().includes(needle));
}

/** orderBy { lastName: "asc" } using locale-aware comparison. */
export function compareByLastName(a: { lastName: string }, b: { lastName: string }): number {
  return a.lastName.localeCompare(b.lastName);
}

/**
 * Does an assignment count as a cross-project conflict for [rangeStart, rangeEnd]?
 * Mirrors Prisma: projectId != currentProjectId, status NOT IN
 * (CANCELLED, DECLINED), startDate <= rangeEnd, endDate >= rangeStart. Rows with a
 * null start/end never overlap (Prisma's lte/gte over NULL is false).
 */
export function isConflictingAssignment(
  a: ConflictAssignmentLike,
  currentProjectId: string,
  rangeStart: Date,
  rangeEnd: Date,
): boolean {
  if (a.projectId === currentProjectId) return false;
  if (CONFLICT_EXCLUDED_STATUSES.includes(a.status)) return false;
  if (a.startDate === null || a.endDate === null) return false;
  return a.startDate.getTime() <= rangeEnd.getTime() && a.endDate.getTime() >= rangeStart.getTime();
}

/** Does an UNAVAILABLE block overlap [rangeStart, rangeEnd]? Non-UNAVAILABLE types ignored. */
export function isUnavailableBlock(b: AvailabilityBlockLike, rangeStart: Date, rangeEnd: Date): boolean {
  if (b.type !== "UNAVAILABLE") return false;
  return b.startDate.getTime() <= rangeEnd.getTime() && b.endDate.getTime() >= rangeStart.getTime();
}
