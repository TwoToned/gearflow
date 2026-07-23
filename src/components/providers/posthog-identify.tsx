"use client";

import { useEffect, useRef } from "react";
import { authClient, useActiveOrganization } from "@/lib/auth-client";
import { useCurrentRoleResource } from "@/hooks/use-current-role";
import { ensureInit } from "@/components/providers/posthog-provider";
import { identify, resetAnalyticsIdentity } from "@/lib/analytics";

/**
 * Identifies the PostHog person once a session + org membership resolve
 * (POLICY.md R-8.9.4 — errors/sessions must carry an opaque internal user ID).
 *
 * Uses the org-membership cuid (`RoleData.memberId`, `/api/current-role`), never
 * the raw Better Auth user id or any name/email — see the PII rule in
 * `analytics.ts`. Resets the identity on sign-out so a shared/kiosk device
 * (e.g. the warehouse floor PWA) doesn't carry the previous member's identity
 * into the next session.
 *
 * Mounted once in the authenticated app shell (`(app)/layout.tsx`), alongside
 * `OrgActivator` — both need a resolved session + active org.
 */
export function PostHogIdentify() {
  const { data: session, isPending: sessionPending } = authClient.useSession();
  const { data: activeOrg } = useActiveOrganization();
  const { data: roleData } = useCurrentRoleResource(activeOrg?.id);
  const identifiedMemberId = useRef<string | null>(null);

  useEffect(() => {
    if (sessionPending) return;

    if (!session) {
      if (identifiedMemberId.current) {
        resetAnalyticsIdentity();
        identifiedMemberId.current = null;
      }
      return;
    }

    const memberId = roleData?.memberId;
    if (!memberId || identifiedMemberId.current === memberId) return;

    void ensureInit().then((ready) => {
      if (!ready) return;
      identify(memberId);
      identifiedMemberId.current = memberId;
    });
  }, [session, sessionPending, roleData?.memberId]);

  return null;
}
