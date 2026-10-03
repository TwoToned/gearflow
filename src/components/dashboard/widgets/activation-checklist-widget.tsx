"use client";

import { ActivationChecklist } from "@/components/dashboard/activation-checklist";

export function ActivationChecklistWidget({ orgId }: { orgId: string | undefined }) {
  return <ActivationChecklist orgId={orgId} bare />;
}
