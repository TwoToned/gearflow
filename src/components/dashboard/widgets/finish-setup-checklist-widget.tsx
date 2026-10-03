"use client";

import { FinishSetupChecklist } from "@/components/dashboard/finish-setup-checklist";

export function FinishSetupChecklistWidget({ orgId }: { orgId: string | undefined }) {
  return <FinishSetupChecklist orgId={orgId} bare />;
}
