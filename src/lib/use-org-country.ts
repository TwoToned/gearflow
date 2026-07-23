"use client";

import { useActiveOrganization } from "@/lib/auth-client";
import { useOrganization } from "@/hooks/use-organization";
import { type OrgSettings } from "@/lib/org-settings-types";

/** Returns the org's configured country code (e.g. "AU"), or undefined. */
export function useOrgCountry(): string | undefined {
  const { data: activeOrg } = useActiveOrganization();
  const orgId = activeOrg?.id;

  const { data: org } = useOrganization(orgId);

  const settings = (org as Record<string, unknown>)?.settings as OrgSettings | undefined;
  return settings?.country || undefined;
}
