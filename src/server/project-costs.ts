"use server";

/**
 * Server-action wrapper for the operational P&L panel. Resolves orgId from
 * the session and delegates to the pure helper in src/lib/project-costs.ts
 * (which is what the integration tests exercise directly).
 */

import { getOrgContext } from "@/lib/org-context";
import { serialize } from "@/lib/serialize";
import {
  computeProjectOperationalCosts,
  type ProjectOperationalCosts,
} from "@/lib/project-costs";

export async function getProjectOperationalCosts(
  projectId: string,
): Promise<ProjectOperationalCosts> {
  const { organizationId } = await getOrgContext();
  const result = await computeProjectOperationalCosts(projectId, organizationId);
  return serialize(result);
}
