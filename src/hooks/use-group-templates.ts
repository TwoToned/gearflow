"use client";

import { createSharedResource } from "./use-shared-resource";
import { getGroupTemplates } from "@/server/group-templates";

/**
 * Shared store for the org's group templates (Phase 6 — React Query removal).
 * Read by the equipment tab (apply-template menu) and the group-templates
 * settings page (list), and written by the settings page's create/update/delete
 * forms (a separate component from the list) + the equipment tab's
 * save-as-template — cross-component on the same page, so a shared store keyed by
 * orgId reproduces React Query's shared `["group-templates"]` cache. Writers call
 * `refreshGroupTemplates(orgId)`. Same shape as use-service-templates.
 */
const resource = createSharedResource(getGroupTemplates);

export const useGroupTemplates = resource.use;
export const refreshGroupTemplates = resource.refresh;
