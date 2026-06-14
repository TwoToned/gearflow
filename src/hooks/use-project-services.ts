"use client";

import { useEffect, useRef } from "react";
import { createSharedResource } from "./use-shared-resource";
import { useProjectServices as useConvexProjectServices } from "./use-projects";
import { refreshProjectDetail } from "./use-project-detail";
import {
  getProjectServices,
  getProjectServicesSummary,
} from "@/server/project-services";

/**
 * Shared stores for a project's services (Phase 6 — React Query removal).
 * `project-services` is read across the project detail page's panels (services
 * panel, crew panel, equipment tab) and written by the services + crew panels;
 * `project-services-summary` is read by the services panel + the page financial
 * summary. Shared stores keyed by projectId keep every panel in sync when a
 * service is added/edited/removed — the cross-component refresh React Query's
 * shared caches gave. Writers call `refreshProjectServices(projectId)` /
 * `refreshProjectServicesSummary(projectId)`. Dual-written infra; reads stay
 * server actions. SSE is dead so no cross-user liveness is lost.
 */

const services = createSharedResource((projectId: string) => getProjectServices(projectId));
export const useProjectServices = services.use;
export const refreshProjectServices = services.refresh;

const summary = createSharedResource((projectId: string) => getProjectServicesSummary(projectId));
export const useProjectServicesSummary = summary.use;
export const refreshProjectServicesSummary = summary.refresh;

/**
 * Cross-tab live sync for project services. Subscribes to the dual-written
 * Convex `projectServices` table; when another tab adds/edits/deletes a service,
 * the mirror pushes the change and we re-fetch the server-action composites
 * (the list + the crew-count summary) plus the project detail (totals). Mount
 * once in the services panel.
 */
export function useProjectServicesLiveSync(
  projectId: string | undefined,
  orgId: string | undefined,
) {
  const svcDocs = useConvexProjectServices(projectId, orgId);
  const fp =
    svcDocs === undefined
      ? undefined
      : svcDocs
          .map((s) => {
            const r = s as {
              id: string; updatedAt?: number; status?: string; lineTotal?: number;
              costTotal?: number; quantity?: number; unitPrice?: number; date?: number;
              crewRoleId?: string; crewCountRequired?: number; sortOrder?: number;
            };
            return `${r.id}:${r.updatedAt ?? 0}:${r.status ?? ""}:${r.lineTotal ?? ""}:${r.costTotal ?? ""}:${r.quantity ?? ""}:${r.unitPrice ?? ""}:${r.date ?? ""}:${r.crewRoleId ?? ""}:${r.crewCountRequired ?? ""}:${r.sortOrder ?? ""}`;
          })
          .sort()
          .join("|");

  const prev = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (!projectId) return;
    if (fp !== undefined && prev.current !== undefined && fp !== prev.current) {
      services.refresh(projectId);
      summary.refresh(projectId);
      refreshProjectDetail(projectId);
    }
    if (fp !== undefined) prev.current = fp;
  }, [projectId, fp]);
}
