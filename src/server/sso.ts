"use server";

import { prisma } from "@/lib/prisma";
import { getConvexClient } from "@/lib/convex-client";
import { api } from "../../convex/_generated/api";
import { getOrgContext, requirePermission } from "@/lib/org-context";
import { serialize } from "@/lib/serialize";
import { sendEmail } from "@/lib/email";
import { getPlatformName } from "@/lib/platform";
import { logActivity } from "@/lib/activity-log";
import { upsertMemberMirrorByOrgUser } from "@/lib/member-mirror";
import { DEFAULT_SSO_SETTINGS, type OrgSSOSettings, type SSOGroupMapping } from "@/lib/sso-types";
import { env } from "@/env";
import type { OrgSettings } from "./settings";

// ─── Read helpers ────────────────────────────────────────────────────────────

function parseOrgSettings(metadata: string | null): OrgSettings {
  if (!metadata) return {};
  try {
    return JSON.parse(metadata);
  } catch {
    return {};
  }
}

function getSSOFromSettings(settings: OrgSettings): OrgSSOSettings {
  return { ...DEFAULT_SSO_SETTINGS, ...settings.sso };
}

// ─── SSO Settings ────────────────────────────────────────────────────────────

export async function getSSOSettings() {
  const { organizationId } = await getOrgContext();

  const org = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: { metadata: true, slug: true, name: true, logo: true },
  });
  if (!org) throw new Error("Organization not found");

  const settings = parseOrgSettings(org.metadata);
  const sso = getSSOFromSettings(settings);

  return serialize({ sso, orgSlug: org.slug, orgName: org.name, orgLogo: org.logo });
}

export async function updateSSOSettings(data: Partial<OrgSSOSettings>) {
  const { organizationId, userId, userName } = await requirePermission("orgSettings", "update");

  const org = await prisma.organization.findUnique({
    where: { id: organizationId },
  });
  if (!org) throw new Error("Organization not found");

  const settings = parseOrgSettings(org.metadata);
  const currentSSO = getSSOFromSettings(settings);

  // Enforce: can't enable enforceSSO without successful test
  if (data.enforceSSO && !currentSSO.ssoTestedSuccessfully && !data.ssoTestedSuccessfully) {
    throw new Error("You must complete a successful SSO test login before enabling enforcement.");
  }

  const updatedSSO = { ...currentSSO, ...data };
  settings.sso = updatedSSO;

  await prisma.organization.update({
    where: { id: organizationId },
    data: { metadata: JSON.stringify(settings) },
  });

  await logActivity({
    organizationId,
    userId,
    userName,
    action: "UPDATE",
    entityType: "sso_settings",
    entityId: organizationId,
    entityName: "SSO Settings",
    summary: "Updated SSO settings",
  });

  return serialize(updatedSSO);
}

// ─── SSO Providers (read via Prisma, CRUD via Better Auth API) ───────────────

export async function getSSOProviders() {
  const { organizationId } = await getOrgContext();

  const providers = await prisma.ssoProvider.findMany({
    where: { organizationId },
    select: {
      id: true,
      providerId: true,
      issuer: true,
      domain: true,
      oidcConfig: true,
      samlConfig: true,
      createdAt: true,
    },
    orderBy: { createdAt: "asc" },
  });

  // Strip secrets from oidcConfig for display
  return serialize(
    providers.map((p) => ({
      ...p,
      type: p.samlConfig ? ("saml" as const) : ("oidc" as const),
      // Don't expose full config with secrets to the client
      oidcConfig: p.oidcConfig ? sanitizeOidcConfig(p.oidcConfig) : null,
      samlConfig: p.samlConfig ? sanitizeSamlConfig(p.samlConfig) : null,
    })),
  );
}

function sanitizeOidcConfig(config: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(config);
    return {
      clientId: parsed.clientId,
      issuer: parsed.issuer,
      scopes: parsed.scopes,
      mapping: parsed.mapping || undefined,
      // Omit clientSecret
    };
  } catch {
    return null;
  }
}

function sanitizeSamlConfig(config: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(config);
    return {
      entryPoint: parsed.entryPoint,
      issuer: parsed.issuer,
      // Omit cert for brevity but it's not really secret
      hasCert: !!parsed.cert,
    };
  } catch {
    return null;
  }
}

export async function deleteSSOProvider(providerId: string) {
  const { organizationId, userId, userName } = await requirePermission("orgSettings", "update");

  const provider = await prisma.ssoProvider.findFirst({
    where: { providerId, organizationId },
  });
  if (!provider) throw new Error("SSO provider not found");

  await prisma.ssoProvider.delete({ where: { id: provider.id } });

  await logActivity({
    organizationId,
    userId,
    userName,
    action: "DELETE",
    entityType: "sso_provider",
    entityId: provider.id,
    entityName: provider.issuer,
    summary: `Deleted SSO provider ${provider.issuer} (${provider.domain})`,
  });

  return { success: true };
}

// ─── Provider OIDC Config Patch (for fields Better Auth update can't clear) ──

/**
 * Directly patch the sso_provider oidcConfig JSON.
 * Used for toggling userInfoEndpoint (to force ID token usage)
 * since Better Auth's mergeOIDCConfig uses ?? and can't null-out fields.
 */
export async function patchProviderOidcConfig(
  providerId: string,
  patch: { useIdTokenOnly?: boolean },
) {
  const { organizationId } = await requirePermission("orgSettings", "update");

  const provider = await prisma.ssoProvider.findFirst({
    where: { providerId, organizationId },
  });
  if (!provider || !provider.oidcConfig) throw new Error("OIDC provider not found");

  const config = JSON.parse(provider.oidcConfig);

  if (patch.useIdTokenOnly) {
    // If required endpoints are missing (e.g. from a previous toggle), re-discover them
    if (!config.tokenEndpoint || !config.jwksEndpoint || !config.authorizationEndpoint) {
      try {
        const issuer = config.issuer || provider.issuer;
        const discoveryUrl = `${issuer}/.well-known/openid-configuration`;
        const res = await fetch(discoveryUrl);
        const disc = await res.json();
        config.authorizationEndpoint = disc.authorization_endpoint;
        config.tokenEndpoint = disc.token_endpoint;
        config.jwksEndpoint = disc.jwks_uri;
      } catch {
        // Discovery failed — endpoints stay as-is, login will trigger discovery at runtime
      }
    }
    // Remove userInfoEndpoint so Better Auth falls back to ID token
    delete config.userInfoEndpoint;
    config.overrideUserInfo = true;
  }

  await prisma.ssoProvider.update({
    where: { id: provider.id },
    data: { oidcConfig: JSON.stringify(config) },
  });

  return { success: true };
}

// ─── Provider Meta (display name, icon — stored in org metadata) ─────────────

export async function updateSSOProviderMeta(
  providerId: string,
  meta: { displayName?: string; icon?: string },
) {
  const { organizationId } = await requirePermission("orgSettings", "update");

  const org = await prisma.organization.findUnique({
    where: { id: organizationId },
  });
  if (!org) throw new Error("Organization not found");

  const settings = parseOrgSettings(org.metadata);
  const sso = getSSOFromSettings(settings);

  if (!sso.providerMeta) sso.providerMeta = {};
  sso.providerMeta[providerId] = {
    displayName: meta.displayName || providerId,
    icon: meta.icon || "key",
  };
  settings.sso = sso;

  await prisma.organization.update({
    where: { id: organizationId },
    data: { metadata: JSON.stringify(settings) },
  });

  return { success: true };
}

// ─── Group Mappings ──────────────────────────────────────────────────────────

export async function updateGroupMappings(mappings: SSOGroupMapping[]) {
  const { organizationId, userId, userName } = await requirePermission("orgSettings", "update");

  const org = await prisma.organization.findUnique({
    where: { id: organizationId },
  });
  if (!org) throw new Error("Organization not found");

  // Group mappings target built-in roles only (custom roles were removed).
  const settings = parseOrgSettings(org.metadata);
  const sso = getSSOFromSettings(settings);
  sso.groupMappings = mappings;
  settings.sso = sso;

  await prisma.organization.update({
    where: { id: organizationId },
    data: { metadata: JSON.stringify(settings) },
  });

  await logActivity({
    organizationId,
    userId,
    userName,
    action: "UPDATE",
    entityType: "sso_group_mappings",
    entityId: organizationId,
    entityName: "Group Mappings",
    summary: `Updated SSO group mappings (${mappings.length} mappings)`,
  });

  return { success: true };
}

// ─── Pending Approvals ───────────────────────────────────────────────────────

export async function getPendingApprovals() {
  const { organizationId } = await getOrgContext();

  // PendingSSOApproval is a Convex domain now. The consumer uses the approval's own
  // denormalized fields (name/email/suggestedRole/idpGroups/createdAt) — the old
  // `include: { user }` join was unused, so it's dropped. Coerce optional Convex
  // fields back to the old non-null shape (idpGroups default [], createdAt → Date).
  const rows = await (await getConvexClient()).query(api.pendingSSOApprovals.list, {
    orgId: organizationId,
  });
  const approvals = rows.map((a) => ({
    ...a,
    idpGroups: a.idpGroups ?? [],
    createdAt: a.createdAt != null ? new Date(a.createdAt) : new Date(0),
  }));

  return serialize(approvals);
}

export async function approveSSOUser(approvalId: string, role?: string) {
  const { organizationId, userId, userName } = await requirePermission("orgMembers", "create");

  const convex = await getConvexClient();

  // CLAIM the approval (PENDING→APPROVED) atomically FIRST. `review` is the single
  // mutual-exclusion gate: a concurrent reject or a double-approve loses here (throws),
  // so the member is created at most once and NEVER after a rejection. (Member has no
  // (org,user) unique constraint, so this — not the DB — is what prevents a double
  // grant.) On a member.create failure we roll the approval back to PENDING so it never
  // ends up "approved but with no membership".
  let claimed: { userId: string; email: string; suggestedRole: string | null };
  try {
    claimed = await convex.mutation(api.pendingSSOApprovals.review, {
      id: approvalId,
      orgId: organizationId,
      status: "APPROVED",
      reviewedById: userId,
      reviewedAt: Date.now(),
    });
  } catch {
    throw new Error("Pending approval not found");
  }

  // Only assignable built-in roles (custom roles were removed). Reject owner + any
  // unknown/garbage role — approval must neither escalate to owner nor lock the new
  // member out with a role that grants nothing.
  const SSO_APPROVAL_ROLES = ["admin", "manager", "member", "warehouse", "viewer"];
  const requestedRole = role || claimed.suggestedRole || "member";
  const assignRole = SSO_APPROVAL_ROLES.includes(requestedRole) ? requestedRole : "member";

  // Idempotent member creation: `member` has no (org,user) unique constraint, so guard
  // against a duplicate across a compensation/retry (or an ambiguous create that
  // actually committed). Combined with the atomic review gate, this is at-most-once.
  try {
    const existingMember = await prisma.member.findFirst({
      where: { organizationId, userId: claimed.userId },
      select: { id: true },
    });
    if (!existingMember) {
      await prisma.member.create({
        data: { organizationId, userId: claimed.userId, role: assignRole },
      });
    }
  } catch (e) {
    await convex
      .mutation(api.pendingSSOApprovals.revertToPending, { id: approvalId, orgId: organizationId })
      .catch(() => {});
    throw e;
  }

  await logActivity({
    organizationId,
    userId,
    userName,
    action: "CREATE",
    entityType: "member",
    entityId: claimed.userId,
    entityName: claimed.email,
    summary: `Approved SSO user ${claimed.email} with role ${assignRole}`,
  });

  // Additive (membership granted): mirror best-effort after the Prisma commit.
  await upsertMemberMirrorByOrgUser(organizationId, claimed.userId);

  // Send email notification
  const pName = await getPlatformName();
  const org = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: { name: true },
  });
  sendEmail({
    to: claimed.email,
    subject: `Your access to ${org?.name || "the organization"} has been approved`,
    html: `
      <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
        <h2>Access Approved</h2>
        <p>Your request to join <strong>${org?.name}</strong> on ${pName} has been approved.</p>
        <p>You've been assigned the role of <strong>${assignRole}</strong>.</p>
        <p>
          <a href="${env.NEXT_PUBLIC_APP_URL}/dashboard" style="display: inline-block; padding: 12px 24px; background-color: #0d9488; color: white; text-decoration: none; border-radius: 6px; font-weight: 600;">
            Go to Dashboard
          </a>
        </p>
      </div>
    `,
  }).catch(console.error);

  return { success: true };
}

export async function rejectSSOUser(approvalId: string, note?: string) {
  const { organizationId, userId, userName } = await requirePermission("orgMembers", "create");

  // `review` atomically transitions PENDING→REJECTED (the mutual-exclusion gate) and
  // returns the approval's identity fields — a concurrent approve that already claimed
  // it loses here (throws). No separate read needed.
  let approval: { userId: string; email: string; suggestedRole: string | null };
  try {
    approval = await (await getConvexClient()).mutation(api.pendingSSOApprovals.review, {
      id: approvalId,
      orgId: organizationId,
      status: "REJECTED",
      reviewedById: userId,
      reviewedAt: Date.now(),
      reviewNote: note,
    });
  } catch {
    throw new Error("Pending approval not found");
  }

  await logActivity({
    organizationId,
    userId,
    userName,
    action: "DELETE",
    entityType: "pending_sso_approval",
    entityId: approvalId,
    entityName: approval.email,
    summary: `Rejected SSO user ${approval.email}${note ? `: ${note}` : ""}`,
  });

  // Send rejection email
  const pName = await getPlatformName();
  const org = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: { name: true },
  });
  sendEmail({
    to: approval.email,
    subject: `Your access request to ${org?.name || "the organization"} was not approved`,
    html: `
      <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
        <h2>Access Request Not Approved</h2>
        <p>Your request to join <strong>${org?.name}</strong> on ${pName} was not approved.</p>
        ${note ? `<p>Reason: ${note}</p>` : ""}
        <p>If you believe this is a mistake, please contact your organization administrator.</p>
      </div>
    `,
  }).catch(console.error);

  return { success: true };
}

// ─── Public Actions (no auth required) ───────────────────────────────────────

/**
 * Get org info for the org-specific login page.
 * This is public — called from the login page before authentication.
 */
export async function getOrgLoginInfo(orgSlug: string) {
  const org = await prisma.organization.findUnique({
    where: { slug: orgSlug },
    select: { id: true, name: true, slug: true, logo: true, metadata: true },
  });

  if (!org) return null;

  const settings = parseOrgSettings(org.metadata);
  const sso = settings.sso;

  // Get SSO providers for this org
  const providers = await prisma.ssoProvider.findMany({
    where: { organizationId: org.id },
    select: { providerId: true, issuer: true, domain: true, samlConfig: true },
  });

  const providerMeta = sso?.providerMeta || {};

  return {
    orgId: org.id,
    orgName: org.name,
    orgSlug: org.slug,
    orgLogo: org.logo,
    hasSSO: providers.length > 0,
    ssoEnabled: sso?.enabled ?? false,
    enforceSSO: sso?.enforceSSO ?? false,
    allowPasswordLogin: sso?.allowPasswordLogin ?? true,
    providers: providers.map((p) => ({
      providerId: p.providerId,
      issuer: p.issuer,
      domain: p.domain,
      type: p.samlConfig ? ("saml" as const) : ("oidc" as const),
      displayName: providerMeta[p.providerId]?.displayName || p.issuer,
      icon: providerMeta[p.providerId]?.icon || "key",
    })),
  };
}
