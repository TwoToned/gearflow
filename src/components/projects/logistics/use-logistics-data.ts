"use client";

/**
 * Everything the Logistics tab reads: the services (with their crew), the
 * project crew rows, the conflict flags, the totals summary and the project
 * itself. One hook so the tab body only wires; the sources are the same live
 * stores the old panels used (the shared services/crew stores, the batched
 * `conflictsForProject` query).
 */
import * as React from "react";
import { useAuthedQuery } from "@/hooks/use-authed-query";
import { useSuppliers } from "@/hooks/use-suppliers";
import { subHireStops, type SubHireOrderLite } from "@/lib/logistics-transport";
import { useCanDo } from "@/lib/use-permissions";
import { useProjectCrew } from "@/hooks/use-project-crew";
import { useProjectDetail } from "@/hooks/use-project-detail";
import { useProjectServices, useProjectServicesLiveSync, useProjectServicesSummary } from "@/hooks/use-project-services";
import { useServiceTemplates } from "@/hooks/use-service-templates";
import { useProjectCrewLiveSync } from "@/hooks/use-project-crew";
import { useActiveOrganization } from "@/lib/auth-client";
import type { LogisticsService } from "@/lib/logistics-model";
import { api } from "../../../../convex/_generated/api";
import type { CrewAssignmentRow } from "./people-view";
import type { ServiceTemplateLite } from "./add-service-bar";

export type Conflict = { severity: "hard" | "soft"; label: string };

const ms = (v?: string | null): number | null => (v ? new Date(v).getTime() : null);

/** The span of every dated assignment, or null when none are dated. */
export function conflictRange(crew: CrewAssignmentRow[]): { start: number; end: number } | null {
  const starts = crew.map((a) => ms(a.startDate)).filter((n): n is number => n != null);
  const ends = crew.map((a) => ms(a.endDate)).filter((n): n is number => n != null);
  if (starts.length === 0 || ends.length === 0) return null;
  return { start: Math.min(...starts), end: Math.max(...ends) };
}

export function useLogisticsData(projectId: string) {
  const { data: activeOrg } = useActiveOrganization();
  const orgId = activeOrg?.id;
  useProjectServicesLiveSync(projectId, orgId);
  useProjectCrewLiveSync(projectId, orgId);

  const { data: project } = useProjectDetail(projectId);
  const { data: rawServices, isLoading: servicesLoading } = useProjectServices(projectId);
  const { data: summary } = useProjectServicesSummary(projectId);
  const { data: rawCrew, isLoading: crewLoading } = useProjectCrew(projectId, orgId);
  const { data: templates } = useServiceTemplates(orgId);

  // Sub-hire transport stops: derived from the job's linked orders. Both reads are org-checked
  // server-side (`subHires.listByProject` filters the global by_projectId index to the caller's org);
  // gated on the caller's read rights so a role without them skips instead of erroring the tab.
  const canSubHires = useCanDo("subHire", "read") && useCanDo("supplier", "read");
  const orders = useAuthedQuery(api.subHires.listByProject, orgId && canSubHires ? { projectId, orgId } : "skip") as
    | SubHireOrderLite[]
    | undefined;
  const suppliers = useSuppliers(canSubHires ? orgId : undefined);
  const stops = React.useMemo(() => {
    const names = new Map((suppliers ?? []).map((s) => [s.id, s.name]));
    return subHireStops(orders ?? [], (id) => names.get(id) ?? "");
  }, [orders, suppliers]);

  const services = (rawServices ?? []) as unknown as LogisticsService[];
  const crew = (rawCrew ?? []) as unknown as CrewAssignmentRow[];

  // One batched query covers every dated assignment (WS8 #947); a stable range, no per-render timestamp.
  const range = conflictRange(crew);
  const conflicts = useAuthedQuery(
    api.crewAssignments.conflictsForProject,
    orgId && range ? { projectId, orgId, rangeStartMs: range.start, rangeEndMs: range.end } : "skip",
  ) as Record<string, Conflict> | undefined;

  return {
    orgId,
    project: (project ?? null) as Record<string, unknown> | null,
    services,
    stops,
    crew,
    conflicts: conflicts ?? {},
    summary: summary as { serviceCount: number; onDocumentsTotal: number; internalTotal: number } | undefined,
    templates: ((templates ?? []) as unknown as (ServiceTemplateLite & Record<string, unknown>)[]),
    isLoading: servicesLoading || crewLoading,
  };
}
