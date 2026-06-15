"use client";

import { useEffect, useRef } from "react";
import { authClient, organization } from "@/lib/auth-client";
import { getTheOrgId } from "@/server/public-org";

/**
 * Auto-sets the active organization for users who arrive without one set.
 *
 * SSO login redirects straight to /dashboard via callbackURL, bypassing the
 * handlePostLogin() call on the login page that calls organization.setActive().
 * Without an activeOrganizationId in the session, useActiveOrganization() returns
 * null, orgId is undefined, useCurrentRoleResource skips its fetch, useCanDo()
 * returns false, and RequirePermission shows "Access Denied" on every page.
 *
 * This component detects the gap and heals it once per session on the client.
 */
export function OrgActivator() {
  const { data: session, isPending: sessionPending } =
    authClient.useSession();
  const { data: activeOrg, isPending: orgPending } =
    authClient.useActiveOrganization();
  const activatingRef = useRef(false);

  useEffect(() => {
    if (sessionPending || orgPending) return;
    if (!session || activeOrg || activatingRef.current) return;

    activatingRef.current = true;
    getTheOrgId()
      .then((orgData) => {
        if (orgData) {
          return organization.setActive({ organizationId: orgData.id });
        }
      })
      .catch(() => {})
      .finally(() => {
        activatingRef.current = false;
      });
  }, [session, activeOrg, sessionPending, orgPending]);

  return null;
}
