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
 * The project crew panel keeps its composite read; this subscription is the
 * cross-tab change signal that triggers a re-fetch. See FEATUREDOCS/54. (The
 * crew planner reads `crewAvailability.plannerData` as a live subscription
 * itself, UX Phase 15, so it needs no signal.)
 */
export type CrewAssignmentDoc = Doc<"crewAssignments">;

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
