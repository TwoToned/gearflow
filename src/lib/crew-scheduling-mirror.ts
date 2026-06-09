import { type FunctionReference } from "convex/server";
import { getConvexClient, toConvexDoc } from "@/lib/convex-client";
import { prisma } from "@/lib/prisma";
import { api } from "../../convex/_generated/api";

/**
 * Crew scheduling / timesheet sub-tables — `crew_assignment`, `crew_shift`,
 * `crew_availability`, `crew_certification`, `crew_time_entry` — are DUAL-WRITTEN
 * **infra-only**: there is NO Phase 4. They are the project-coupled, cascade-child
 * layer of the crew domain (the roster trio role/member/skill was migrated earlier
 * in `crew-mirror.ts`), composed only inside project-joining and member-detail
 * views that stay on Prisma reads. The mirror keeps the Convex graph complete for
 * the eventual decommission. With this, the entire dual-write surface is finished.
 * See FEATUREDOCS/54.
 *
 * Dual-write (not hard cutover): live inbound + outbound FKs cross the boundary —
 * crew_assignment → project / crew_member / crew_role / project_service / user;
 * crew_shift / crew_time_entry are required+Cascade children of crew_assignment;
 * crew_certification / crew_availability are required+Cascade children of
 * crew_member. A net-new row against any of these would FK-fail a Convex-only
 * cutover.
 *
 * Cascade handling: Convex has no real FK cascade, so the delete paths capture the
 * descendant ids from Prisma BEFORE the cascading `delete`/`deleteMany`, then
 * remove them from Convex AFTER commit (see the `snapshot*` collectors +
 * `removeCrewAssignmentCascadeFromConvex` / `removeCrewMemberCascadeFromConvex`).
 *
 * Create/update paths use the explicit mirror helpers for single-row writes and
 * the `sync*` heal helpers (re-read from Prisma + upsert) for multi-row writes and
 * the shift-regeneration flow. The upsert sweeps never delete, so orphan rows left
 * by a regeneration (`generateShifts` re-creates with fresh ids — the old rows are
 * explicitly removed) or by clear-to-null are tolerable and heal on a backfill run.
 *
 * Clear-to-null caveat applies (toConvexDoc drops null→absent): nulling a nullable
 * FK (crewRoleId / serviceId / confirmedById / assignmentId / approvedById) is a
 * no-op in Convex; tolerable for this consumer-less mirror.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyRef = FunctionReference<"mutation", "public", any, any>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyQueryRef = FunctionReference<"query", "public", any, any>;

// Relation keys a crew read may include — stripped before mirroring so the
// scalar-only Convex create/update validators don't reject extra fields.
const RELATION_KEYS = new Set([
  "organization", "project", "crewMember", "crewRole", "service", "confirmedBy",
  "approvedBy", "assignment", "shifts", "timeEntries", "availability",
  "certifications",
]);
function strip(row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) if (!RELATION_KEYS.has(k)) out[k] = v;
  return out;
}

async function create(fn: AnyRef, row: Record<string, unknown>) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (await getConvexClient()).mutation(fn, toConvexDoc(strip(row)) as any);
}

async function patch(fn: AnyRef, id: string, row: Record<string, unknown>) {
  const { id: _id, ...rest } = toConvexDoc(strip(row));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (await getConvexClient()).mutation(fn, { id, patch: rest } as any);
}

/** Remove tolerant of a missing Convex row — a cascade may touch rows created
 *  before dual-write was wired (the Convex `remove` throws "... not found"). */
async function removeSafe(fn: AnyRef, id: string) {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (await getConvexClient()).mutation(fn, { id } as any);
  } catch (e) {
    if (!(e instanceof Error && /not found/i.test(e.message))) throw e;
  }
}

async function upsert(getRef: AnyQueryRef, createRef: AnyRef, updateRef: AnyRef, row: Record<string, unknown>) {
  const id = row.id as string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const existing = await (await getConvexClient()).query(getRef, { id } as any);
  if (existing) await patch(updateRef, id, row);
  else await create(createRef, row);
}

// ─── Crew assignments ──────────────────────────────────────────────────────────
export const mirrorCrewAssignmentCreate = (row: Record<string, unknown>) => create(api.crewAssignments.create, row);
export const patchCrewAssignmentInConvex = (id: string, row: Record<string, unknown>) => patch(api.crewAssignments.update, id, row);
export const removeCrewAssignmentFromConvex = (id: string) => removeSafe(api.crewAssignments.remove, id);

// ─── Crew shifts ─────────────────────────────────────────────────────────────
export const mirrorCrewShiftCreate = (row: Record<string, unknown>) => create(api.crewShifts.create, row);
export const patchCrewShiftInConvex = (id: string, row: Record<string, unknown>) => patch(api.crewShifts.update, id, row);
export const removeCrewShiftFromConvex = (id: string) => removeSafe(api.crewShifts.remove, id);

// ─── Crew availability ─────────────────────────────────────────────────────────
export const mirrorCrewAvailabilityCreate = (row: Record<string, unknown>) => create(api.crewAvailabilities.create, row);
export const removeCrewAvailabilityFromConvex = (id: string) => removeSafe(api.crewAvailabilities.remove, id);

// ─── Crew certifications ─────────────────────────────────────────────────────────
export const mirrorCrewCertificationCreate = (row: Record<string, unknown>) => create(api.crewCertifications.create, row);
export const removeCrewCertificationFromConvex = (id: string) => removeSafe(api.crewCertifications.remove, id);

// ─── Crew time entries ─────────────────────────────────────────────────────────
export const mirrorCrewTimeEntryCreate = (row: Record<string, unknown>) => create(api.crewTimeEntries.create, row);
export const patchCrewTimeEntryInConvex = (id: string, row: Record<string, unknown>) => patch(api.crewTimeEntries.update, id, row);
export const removeCrewTimeEntryFromConvex = (id: string) => removeSafe(api.crewTimeEntries.remove, id);

// ─── Heal / sweep helpers (re-read Prisma + upsert) ──────────────────────────────

/** Upsert a single assignment + all its shifts + time entries into Convex. The
 *  workhorse for the create/update/offer/respond paths (and shift regeneration). */
export async function syncCrewAssignmentToConvex(assignmentId: string | null | undefined) {
  if (!assignmentId) return;
  const a = await prisma.crewAssignment.findUnique({
    where: { id: assignmentId },
    include: { shifts: true, timeEntries: true },
  });
  if (!a) return;
  await upsertAssignmentWithChildren(a as unknown as Record<string, unknown>);
}

/** Upsert every assignment (+ children) of a project. For project-scoped clones. */
export async function syncCrewAssignmentsForProjectToConvex(projectId: string | null | undefined) {
  if (!projectId) return;
  const rows = await prisma.crewAssignment.findMany({
    where: { projectId },
    include: { shifts: true, timeEntries: true },
  });
  for (const a of rows) await upsertAssignmentWithChildren(a as unknown as Record<string, unknown>);
}

/** Upsert every assignment (+ children) of a project service. For the service
 *  crew-reconcile paths in project-services.ts. */
export async function syncCrewAssignmentsForServiceToConvex(serviceId: string | null | undefined) {
  if (!serviceId) return;
  const rows = await prisma.crewAssignment.findMany({
    where: { serviceId },
    include: { shifts: true, timeEntries: true },
  });
  for (const a of rows) await upsertAssignmentWithChildren(a as unknown as Record<string, unknown>);
}

/** Upsert specific time entries by id (for the submit/approve `updateMany`s). */
export async function syncCrewTimeEntriesToConvex(ids: Array<string | null | undefined>) {
  const unique = [...new Set(ids.filter((id): id is string => Boolean(id)))];
  if (unique.length === 0) return;
  const rows = await prisma.crewTimeEntry.findMany({ where: { id: { in: unique } } });
  for (const t of rows) {
    await upsert(api.crewTimeEntries.getById, api.crewTimeEntries.create, api.crewTimeEntries.update, t as unknown as Record<string, unknown>);
  }
}

async function upsertAssignmentWithChildren(row: Record<string, unknown>) {
  const shifts = (row.shifts as Array<Record<string, unknown>>) ?? [];
  const timeEntries = (row.timeEntries as Array<Record<string, unknown>>) ?? [];
  await upsert(api.crewAssignments.getById, api.crewAssignments.create, api.crewAssignments.update, row);
  for (const s of shifts) await upsert(api.crewShifts.getById, api.crewShifts.create, api.crewShifts.update, s);
  for (const t of timeEntries) await upsert(api.crewTimeEntries.getById, api.crewTimeEntries.create, api.crewTimeEntries.update, t);
}

// ─── Cascade snapshots + removal ─────────────────────────────────────────────────

/** A captured assignment + the ids of its cascade-deleted children. */
export interface CrewAssignmentCascade {
  assignmentId: string;
  shiftIds: string[];
  timeEntryIds: string[];
}

interface AssignmentCascadeWhere {
  id?: string;
  projectId?: string;
  serviceId?: string;
  crewMemberId?: string;
}

async function readAssignmentCascade(where: AssignmentCascadeWhere): Promise<CrewAssignmentCascade[]> {
  const rows = await prisma.crewAssignment.findMany({
    where,
    select: { id: true, shifts: { select: { id: true } }, timeEntries: { select: { id: true } } },
  });
  return rows.map((a) => ({
    assignmentId: a.id,
    shiftIds: a.shifts.map((s) => s.id),
    timeEntryIds: a.timeEntries.map((t) => t.id),
  }));
}

/** Snapshot an assignment + its cascade children. Call BEFORE the deleting tx. */
export const snapshotAssignmentCascade = (assignmentId: string) =>
  readAssignmentCascade({ id: assignmentId });

/** Snapshot all crew assignments (+ children) of a project. Call BEFORE deleteProject. */
export const snapshotProjectCrew = (projectId: string) =>
  readAssignmentCascade({ projectId });

/** Snapshot all crew assignments (+ children) of a project service. Call BEFORE
 *  the service delete / crew-reconcile tx. */
export const snapshotServiceCrew = (serviceId: string) =>
  readAssignmentCascade({ serviceId });

/** Snapshot everything that cascades when a crew member is deleted. Call BEFORE
 *  deleteCrewMember (the member delete cascades assignments → shifts/time-entries,
 *  plus standalone time entries, certifications and availability). */
export async function snapshotCrewMemberCascade(crewMemberId: string) {
  const [assignments, timeEntries, certs, avail] = await Promise.all([
    readAssignmentCascade({ crewMemberId }),
    prisma.crewTimeEntry.findMany({ where: { crewMemberId }, select: { id: true } }),
    prisma.crewCertification.findMany({ where: { crewMemberId }, select: { id: true } }),
    prisma.crewAvailability.findMany({ where: { crewMemberId }, select: { id: true } }),
  ]);
  return {
    assignments,
    timeEntryIds: timeEntries.map((t) => t.id),
    certificationIds: certs.map((c) => c.id),
    availabilityIds: avail.map((a) => a.id),
  };
}

/** Remove a captured assignment cascade (children first) from Convex. Call AFTER
 *  the deleting tx commits. Tolerant of rows missing from Convex. */
export async function removeCrewAssignmentCascadeFromConvex(cascade: CrewAssignmentCascade[]) {
  for (const c of cascade) {
    for (const sid of c.shiftIds) await removeSafe(api.crewShifts.remove, sid);
    for (const tid of c.timeEntryIds) await removeSafe(api.crewTimeEntries.remove, tid);
    await removeSafe(api.crewAssignments.remove, c.assignmentId);
  }
}

/** Remove everything a crew-member delete cascades. Call AFTER the delete commits. */
export async function removeCrewMemberCascadeFromConvex(snapshot: Awaited<ReturnType<typeof snapshotCrewMemberCascade>>) {
  await removeCrewAssignmentCascadeFromConvex(snapshot.assignments);
  for (const id of snapshot.timeEntryIds) await removeSafe(api.crewTimeEntries.remove, id);
  for (const id of snapshot.certificationIds) await removeSafe(api.crewCertifications.remove, id);
  for (const id of snapshot.availabilityIds) await removeSafe(api.crewAvailabilities.remove, id);
}
