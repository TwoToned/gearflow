"use client";

import { useAuthedQuery } from "@/hooks/use-authed-query";
import { api } from "../../convex/_generated/api";
import type { Doc } from "../../convex/_generated/dataModel";

/**
 * Reactive crew-scheduling hooks (Phase 4 of the Convex migration).
 *
 * Thin wrappers over Convex's useQuery — the browser subscribes to the
 * dual-written `crewAssignments` / `crewTimeEntries` tables over a websocket, so
 * assigning/removing crew, confirming an offer, or submitting/approving a
 * timesheet (via the crew server actions) pushes a live update to every tab.
 *
 * The crew panel / planner / timesheets pages keep their server-action composite
 * reads (Prisma owns the crewMember/role/service/user joins); these subscriptions
 * are the cross-tab change signal that triggers a re-fetch. See FEATUREDOCS/54.
 *
 * NOTE: crewAvailabilities has no organizationId field/index, so availability-block
 * edits are NOT part of the org-wide signal — they refresh on navigation. The
 * assignment signal covers the core collaboration case (who's booked on what).
 */
export type CrewAssignmentDoc = Doc<"crewAssignments">;
export type CrewTimeEntryDoc = Doc<"crewTimeEntries">;
export type CrewAvailabilityDoc = Doc<"crewAvailabilities">;

/** All crew assignments for a project (the project crew panel signal). */
export function useProjectCrewAssignments(
  projectId: string | undefined,
  orgId: string | undefined,
): CrewAssignmentDoc[] | undefined {
  return useAuthedQuery(
    api.crewAssignments.listByProject,
    projectId && orgId ? { projectId, orgId } : "skip",
  );
}

/** All crew assignments for an org (the planner signal). */
export function useOrgCrewAssignments(orgId: string | undefined): CrewAssignmentDoc[] | undefined {
  return useAuthedQuery(api.crewAssignments.list, orgId ? { orgId } : "skip");
}

/** All time entries for an org (the timesheets signal). */
export function useOrgTimeEntries(orgId: string | undefined): CrewTimeEntryDoc[] | undefined {
  return useAuthedQuery(api.crewTimeEntries.list, orgId ? { orgId } : "skip");
}

/** All availability blocks for an org (the planner availability signal).
 *  crewAvailabilities is org-scoped in Convex via a denormalized organizationId
 *  (the Prisma model scopes via crewMember), so the standard org `list` works. */
export function useOrgAvailabilities(orgId: string | undefined): CrewAvailabilityDoc[] | undefined {
  return useAuthedQuery(api.crewAvailabilities.list, orgId ? { orgId } : "skip");
}

/**
 * Fingerprint of crew assignments — changes on create/delete or any
 * panel/planner-relevant scalar mutation (status, dates, crew/role/service
 * reassignment, confirmation, cost). The assignment row's updatedAt bumps on
 * shift regeneration too (syncCrewAssignmentToConvex re-patches the row).
 */
export function fingerprintCrewAssignments(
  rows: CrewAssignmentDoc[] | undefined,
): string | undefined {
  if (!rows) return undefined;
  return rows
    .map((a) =>
      `${a.id}:${a.updatedAt ?? 0}:${a.status ?? ""}:${a.crewMemberId ?? ""}:${a.crewRoleId ?? ""}:${a.serviceId ?? ""}:${a.startDate ?? ""}:${a.endDate ?? ""}:${a.confirmedById ?? ""}:${a.estimatedCost ?? ""}`,
    )
    .sort()
    .join("|");
}

/**
 * Fingerprint of time entries — changes on create/delete or status/hours/approval
 * mutations (the timesheet collaboration surface).
 */
export function fingerprintTimeEntries(
  rows: CrewTimeEntryDoc[] | undefined,
): string | undefined {
  if (!rows) return undefined;
  return rows
    .map((t) =>
      `${t.id}:${t.updatedAt ?? 0}:${t.status ?? ""}:${t.crewMemberId ?? ""}:${t.assignmentId ?? ""}:${t.date ?? ""}:${t.totalHours ?? ""}:${t.approvedById ?? ""}`,
    )
    .sort()
    .join("|");
}

/**
 * Fingerprint of availability blocks — changes on add/remove or any
 * date/type/reason edit (someone marking themselves off, etc.).
 */
export function fingerprintAvailabilities(
  rows: CrewAvailabilityDoc[] | undefined,
): string | undefined {
  if (!rows) return undefined;
  return rows
    .map((a) =>
      `${a.id}:${a.updatedAt ?? 0}:${a.crewMemberId ?? ""}:${a.type ?? ""}:${a.startDate ?? ""}:${a.endDate ?? ""}:${a.isAllDay ?? ""}:${a.startTime ?? ""}:${a.endTime ?? ""}`,
    )
    .sort()
    .join("|");
}
