"use client";

import { useActiveOrganization } from "@/lib/auth-client";
import { useAuthedQuery } from "@/hooks/use-authed-query";
import { api } from "../../convex/_generated/api";
import type { ProjectOperationalCosts } from "@/lib/project-costs";

/**
 * Browser-direct operational P&L for a project (Phase 3 — replaces the
 * `getProjectOperationalCosts` server action). Subscribes to
 * `api.projectCosts.operationalCosts`, which computes the same margins project-scoped.
 */
export function useProjectOperationalCosts(projectId: string): {
  data: ProjectOperationalCosts | undefined;
  isLoading: boolean;
} {
  const { data: activeOrg } = useActiveOrganization();
  const orgId = activeOrg?.id;
  const data = useAuthedQuery(
    api.projectCosts.operationalCosts,
    orgId && projectId ? { projectId, orgId } : "skip",
  );
  return { data, isLoading: data === undefined };
}
