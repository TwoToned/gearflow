"use client";

import { createSharedResource } from "./use-shared-resource";
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
