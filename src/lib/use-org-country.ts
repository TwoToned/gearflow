"use client";

import { useActiveOrganization } from "@/lib/auth-client";
import { useOrganization } from "@/hooks/use-organization";
import { type OrgSettings } from "@/lib/org-settings-types";
import { getCountry } from "@/lib/countries";

/** Returns the org's configured country code (e.g. "AU"), or undefined. */
export function useOrgCountry(): string | undefined {
  const { data: activeOrg } = useActiveOrganization();
  const orgId = activeOrg?.id;

  const { data: org } = useOrganization(orgId);

  const settings = (org as Record<string, unknown>)?.settings as OrgSettings | undefined;
  return settings?.country || undefined;
}

/** I6 (#1086) — the `date-fns` `weekStartsOn` value (0 = Sunday, 1 = Monday)
 *  for the active org's country. Defaults to Monday (1) — the same value
 *  every hardcoded `weekStartsOn: 1` this replaces already assumed — when no
 *  country is set. Only the US (of the launch markets) starts Sunday. */
export function useOrgWeekStartsOn(): 0 | 1 {
  const countryCode = useOrgCountry();
  return getCountry(countryCode)?.weekStart === "SUN" ? 0 : 1;
}
