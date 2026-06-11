"use client";

import { createSharedResource } from "./use-shared-resource";
import { getServiceTemplates } from "@/server/project-services";

/**
 * Shared store for the org's service templates (Phase 6 — React Query removal).
 * Read by the services settings page (list) AND the project services panel
 * (template dropdown), and written by the settings page's create/update/delete
 * forms — which live in a SEPARATE component from the list on the same page, so a
 * per-component `useServerQuery` would not propagate a create → list refresh. A
 * shared store keyed by orgId reproduces React Query's shared `["service-templates"]`
 * cache. Writers call `refreshServiceTemplates(orgId)`. Stays in Prisma /
 * dual-written; the read is a server action.
 */
const resource = createSharedResource(getServiceTemplates);

export const useServiceTemplates = resource.use;
export const refreshServiceTemplates = resource.refresh;
