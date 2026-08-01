"use server";

import { prisma } from "@/lib/prisma";
import { serialize } from "@/lib/serialize";
import { getSession } from "@/lib/auth-server";
import { upsertMemberMirrorByOrgUser } from "@/lib/member-mirror";

/**
 * The calling user's LIVE (non-archived) org memberships. Safe to call
 * without an active org set (session-only). This is the multi-tenant
 * replacement for the single-org `getTheOrgId()` —
 * login/register/invite/onboarding/OrgActivator (#1071, A1) all resolve
 * "which org(s) does this user belong to" through here instead of assuming
 * there's exactly one.
 *
 * Membership-derived, never a list of all orgs filtered client-side (R-9.3).
 * Archived orgs (#1075, A5) never appear here — the switcher/onboarding-gate
 * treat a membership in one as no membership at all. Use
 * `hasOnlyArchivedMemberships()` to tell that apart from having none ever.
 */
export async function getMyOrganizations(): Promise<
  { id: string; name: string; slug: string; role: string }[]
> {
  const session = await getSession();
  if (!session) return [];

  const memberships = await prisma.member.findMany({
    where: { userId: session.user.id, organization: { archivedAt: null } },
    include: { organization: { select: { id: true, name: true, slug: true } } },
    orderBy: { createdAt: "asc" },
  });

  return serialize(
    memberships.map((m) => ({
      id: m.organization.id,
      name: m.organization.name,
      slug: m.organization.slug,
      role: m.role,
    })),
  );
}

/**
 * True when the caller has at least one membership, but every one of them is
 * in an archived org. Distinguishes "never had an org" (→ /onboarding) from
 * "org(s) archived" (→ an explanatory screen, not the create-org form) for
 * the `(app)` layout gate and `OrgActivator` — a user in this state gets
 * neither a crash nor a silent empty dashboard (#1075, A5).
 */
export async function hasOnlyArchivedMemberships(): Promise<boolean> {
  const session = await getSession();
  if (!session) return false;

  const [anyMembership, liveMembership] = await Promise.all([
    prisma.member.findFirst({ where: { userId: session.user.id }, select: { id: true } }),
    prisma.member.findFirst({
      where: { userId: session.user.id, organization: { archivedAt: null } },
      select: { id: true },
    }),
  ]);

  return !!anyMembership && !liveMembership;
}

/**
 * Best-effort org branding for the pre-auth login page. Returns a name only
 * when exactly one organization exists system-wide — with multiple orgs, an
 * anonymous visitor's org isn't knowable pre-auth, so no branding is shown.
 * Preserves today's "Sign in to {orgName}" UX for the current single-org
 * deployment without assuming it stays single-org.
 */
export async function getSoloOrgBranding(): Promise<{ name: string } | null> {
  const orgs = await prisma.organization.findMany({ select: { name: true }, take: 2 });
  if (orgs.length !== 1) return null;
  return serialize({ name: orgs[0].name });
}

/**
 * Mirror the CALLING session's own membership in `organizationId` into Convex.
 * Called by the onboarding page right after `organization.create()` +
 * `setActive()` succeed.
 *
 * The self-serve `organization.create()` client call (Better Auth's own
 * organization plugin) creates the Postgres Organization + Member rows
 * directly — unlike `adminCreateOrganization` (src/server/site-admin.ts), it
 * has no way to also call `upsertMemberMirrorByOrgUser`, since that mirror
 * write lives in this app's code, not the plugin's. Without this, the
 * bootstrap owner has a real Postgres membership but no Convex-side one, and
 * every Convex-authorized action (creating a model, a project, ...) fails
 * with "not a member of this organization" — the app is otherwise unusable
 * immediately after onboarding.
 *
 * Safe for any caller: `upsertMemberMirrorByOrgUser` reads the Postgres
 * Member row for (org, user) first and no-ops if it doesn't exist, so this
 * can only mirror a membership that's already real — never fabricate one.
 */
export async function mirrorMyMembership(organizationId: string): Promise<void> {
  const session = await getSession();
  if (!session) return;
  await upsertMemberMirrorByOrgUser(organizationId, session.user.id);
}
