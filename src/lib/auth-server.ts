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
 * removed member, an archived membership, or a stale/forged session value must
 * not resolve to an org the caller no longer belongs to.
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
    where: { organizationId: activeOrgId, userId: session.user.id },
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
