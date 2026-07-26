"use client";

import { useMutation } from "convex/react";
import { createId } from "@paralleldrive/cuid2";
import { useSession, useActiveOrganization } from "@/lib/auth-client";
import type { IncidentReportFormValues } from "@/lib/validations/incident";
import { api } from "../../convex/_generated/api";

/**
 * Browser-direct "Report Issue" write (GitHub #898, FEATUREDOCS/64). Calls the
 * guarded `api.incidentWrites.reportIssueNative` mutation, which creates a REPAIR
 * MaintenanceRecord AND flips the reported asset's status immediately. The client
 * mints the record id + asset-link id; dates are epoch ms.
 */
export function useIncidentWrites() {
  const { data: session } = useSession();
  const { data: activeOrg } = useActiveOrganization();
  const orgId = activeOrg?.id;

  const reportIssueM = useMutation(api.incidentWrites.reportIssueNative);

  const actor = () => ({ userId: session?.user.id ?? "", userName: session?.user.name ?? "" });
  const requireOrg = (): string => {
    if (!orgId) throw new Error("No active organization");
    return orgId;
  };

  return {
    reportIssue: async (data: IncidentReportFormValues): Promise<{ id: string }> => {
      return reportIssueM({
        orgId: requireOrg(),
        recordId: createId(),
        linkId: createId(),
        ...(data.projectId ? { projectId: data.projectId } : {}),
        ...(data.lineItemId ? { lineItemId: data.lineItemId } : {}),
        ...(data.assetId ? { assetId: data.assetId } : {}),
        incidentType: data.incidentType,
        incidentSeverity: data.incidentSeverity,
        description: data.description,
        photos: data.photos,
        now: Date.now(),
        actor: actor(),
        auditId: createId(),
      });
    },
  };
}
