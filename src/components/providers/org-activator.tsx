"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { authClient, organization } from "@/lib/auth-client";
import { getMyOrganizations } from "@/server/public-org";

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
 *
 * Must not guess (#1071, A1): 1 membership → activate it; 2+ → route to the
 * picker rather than pick one; 0 → nothing to activate here (the (app) layout's
 * own guard routes a 0-membership session to /onboarding).
 */
export function OrgActivator() {
  const router = useRouter();
  const { data: session, isPending: sessionPending } =
    authClient.useSession();
  const { data: activeOrg, isPending: orgPending } =
    authClient.useActiveOrganization();
  const activatingRef = useRef(false);

  useEffect(() => {
    if (sessionPending || orgPending) return;
    if (!session || activeOrg || activatingRef.current) return;

    activatingRef.current = true;
    getMyOrganizations()
      .then((orgs) => {
        if (orgs.length === 1) {
          return organization.setActive({ organizationId: orgs[0].id });
        }
        if (orgs.length >= 2) {
          router.push("/select-organization");
        }
      })
      .catch(() => {})
      .finally(() => {
        activatingRef.current = false;
      });
  }, [session, activeOrg, sessionPending, orgPending, router]);

  return null;
}
