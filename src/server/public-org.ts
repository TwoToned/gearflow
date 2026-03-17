"use server";

import { getTheOrg } from "@/lib/single-org";
import { serialize } from "@/lib/serialize";
import { getOrgLoginInfo } from "./sso";

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
