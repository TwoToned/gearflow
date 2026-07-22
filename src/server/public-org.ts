"use server";

import { getTheOrg, invalidateOrgCache } from "@/lib/single-org";
import { serialize } from "@/lib/serialize";
import { getOrgLoginInfo } from "./sso";
import { getSession } from "@/lib/auth-server";
import { upsertMemberMirrorByOrgUser } from "@/lib/member-mirror";

/**
 * Returns the single org's ID. Safe to call without session context.
 * Used by login/invite pages to call organization.setActive().
 */
export async function getTheOrgId(): Promise<{ id: string } | null> {
  const org = await getTheOrg();
  if (!org) return null;
  return serialize({ id: org.id });
}

/**
 * Returns the single org's public info (name, slug). Safe to call without session context.
 * Used by the login page to show org branding.
 */
export async function getTheOrgInfo(): Promise<{ id: string; name: string; slug: string } | null> {
  const org = await getTheOrg();
  if (!org) return null;
  return serialize(org);
}

/**
 * Returns SSO login info for the single org. Safe to call without session context.
 * Used by the login page to initiate SSO directly.
 */
export async function getSingleOrgSSOInfo() {
  const org = await getTheOrg();
  if (!org) return null;
  const info = await getOrgLoginInfo(org.slug);
  return info ? serialize(info) : null;
}

/**
 * Bust the 5-minute in-process `getTheOrg()` cache. Called by the onboarding
 * page right after the bootstrap org is created — without this, `getTheOrg()`
 * (and everything that gates on it, e.g. the (app) layout's onboarding
 * redirect) can keep serving the cached "no org yet" null for up to 5 minutes
 * after a successful create.
 */
export async function invalidateTheOrgCache(): Promise<void> {
  invalidateOrgCache();
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
