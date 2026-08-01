import { cache } from "react";
import { headers } from "next/headers";
import { auth } from "./auth";
import { prisma } from "./prisma";

export async function getSession() {
  const session = await auth.api.getSession({
    headers: await headers(),
  });
  return session;
}

export async function requireSession() {
  const session = await getSession();
  if (!session) {
    throw new Error("Unauthorized");
  }
  return session;
}

/**
 * Resolves the session's active org, re-validated against a live Member row on
 * every resolution (#1071, A1). `activeOrganizationId` is set by the
 * client-callable `organization.setActive()` — never trust it alone (R-9.3): a
 * removed member, an archived org, or a stale/forged session value must not
 * resolve to an org the caller no longer belongs to.
 *
 * Archived orgs (#1075, A5) are enforced HERE, not per-query — Better Auth's
 * own `setActive()` has no archival concept (only checks membership), so the
 * client can still "activate" an archived org; this is the chokepoint that
 * refuses to honor it. No Convex-side mirror needed: `definePayload` (the JWT
 * mint) applies the same `organization: { archivedAt: null }` filter, so an
 * archived org's `orgId` is never minted into a claim in the first place —
 * nothing downstream needs its own check.
 *
 * Memoized per-request with React `cache()` so every caller in the same
 * request (getOrgContext, getActiveOrganizationId, requireOrganization, ...)
 * shares one session fetch + one membership query instead of repeating both.
 */
const resolveActiveOrganizationId = cache(async (): Promise<string | null> => {
  const session = await getSession();
  if (!session) return null;

  const activeOrgId = (session.session as { activeOrganizationId?: string | null })
    .activeOrganizationId;
  if (!activeOrgId) return null;

  const member = await prisma.member.findFirst({
    where: {
      organizationId: activeOrgId,
      userId: session.user.id,
      organization: { archivedAt: null },
    },
    select: { id: true },
  });
  return member ? activeOrgId : null;
});

export async function getActiveOrganizationId(): Promise<string | null> {
  return resolveActiveOrganizationId();
}

export async function requireOrganization() {
  const session = await requireSession();
  const organizationId = await resolveActiveOrganizationId();
  if (!organizationId) {
    throw new Error("No active organization. Please select an organization.");
  }
  return { session, organizationId };
}
