import { prisma } from "./prisma";
import { upsertMemberMirrorByOrgUser } from "./member-mirror";
import type { OrgSSOSettings, SSOGroupMapping } from "./sso-types";
import type { Organization } from "@/generated/prisma/client";

/**
 * Role hierarchy for resolving multiple group matches.
 * Lower index = higher privilege.
 */
const ROLE_HIERARCHY = ["owner", "admin", "manager", "member", "warehouse", "viewer"];

/**
 * Resolve a GearFlow role from IdP group memberships.
 * Checks both:
 * 1. Custom roles with ssoGroupClaim field matching an IdP group
 * 2. Explicit group mappings from SSO settings
 */
async function resolveRoleFromGroups(
  idpGroups: string[],
  mappings: SSOGroupMapping[],
  defaultRole: string,
  groupValueType: "name" | "id" = "name",
  organizationId?: string,
): Promise<{ role: string; customRoleId?: string }> {
  // First, check custom roles with ssoGroupClaim matching IdP groups
  if (organizationId && idpGroups.length > 0) {
    const customRoles = await prisma.customRole.findMany({
      where: {
        organizationId,
        ssoGroupClaim: { in: idpGroups },
      },
      select: { id: true },
    });

    if (customRoles.length > 0) {
      return { role: `custom:${customRoles[0].id}`, customRoleId: customRoles[0].id };
    }
  }

  // Then check explicit group mappings
  const matchedMappings: SSOGroupMapping[] = [];

  for (const mapping of mappings) {
    // Skip unmapped/empty-role entries (auto-discovered but not yet assigned)
    if (!mapping.gearflowRole || mapping.unmapped) continue;
    const matchValue = groupValueType === "id" ? mapping.idpGroupId : mapping.idpGroupName;
    if (matchValue && idpGroups.includes(matchValue)) {
      matchedMappings.push(mapping);
    }
  }

  if (matchedMappings.length === 0) {
    return { role: defaultRole };
  }

  // If any matched mapping has a custom role, use the first one
  const customMatch = matchedMappings.find((m) => m.customRoleId);
  if (customMatch) {
    return { role: `custom:${customMatch.customRoleId}`, customRoleId: customMatch.customRoleId };
  }

  // For built-in roles, use the highest-privilege match
  let bestRole = defaultRole;
  let bestIndex = ROLE_HIERARCHY.indexOf(defaultRole);
  if (bestIndex === -1) bestIndex = ROLE_HIERARCHY.length;

  for (const mapping of matchedMappings) {
    const idx = ROLE_HIERARCHY.indexOf(mapping.gearflowRole);
    if (idx !== -1 && idx < bestIndex) {
      bestIndex = idx;
      bestRole = mapping.gearflowRole;
    }
  }

  return { role: bestRole };
}

/**
 * Extract IdP groups from SSO user info based on org SSO settings.
 */
function extractIdpGroups(
  userInfo: Record<string, unknown> | undefined,
  ssoSettings: OrgSSOSettings,
  providerType: "oidc" | "saml",
): string[] {
  if (!userInfo) return [];

  const claimName = providerType === "oidc"
    ? (ssoSettings.oidcGroupsClaim || "groups")
    : (ssoSettings.samlGroupsAttribute || "groups");

  const groups = userInfo[claimName];
  if (Array.isArray(groups)) return groups.map(String);
  if (typeof groups === "string") return [groups];
  return [];
}

/**
 * Parse SSO settings from organization metadata JSON.
 */
function parseSSOSettings(metadata: string | null): OrgSSOSettings | null {
  if (!metadata) return null;
  try {
    const parsed = JSON.parse(metadata);
    return parsed.sso || null;
  } catch {
    return null;
  }
}

/**
 * Auto-discover IdP groups: persist any previously-unseen groups to
 * the org's SSO group mappings (with unmapped=true, no role assigned).
 * This lets admins see what groups exist before they map them.
 */
async function discoverNewGroups(
  org: Organization,
  ssoSettings: OrgSSOSettings,
  idpGroups: string[],
  groupValueType: "name" | "id",
) {
  if (idpGroups.length === 0) return;

  const existing = ssoSettings.groupMappings || [];
  const existingKeys = new Set(
    existing.map((m) => (groupValueType === "id" ? m.idpGroupId : m.idpGroupName)),
  );

  const newGroups: SSOGroupMapping[] = [];
  for (const group of idpGroups) {
    if (!existingKeys.has(group)) {
      newGroups.push(
        groupValueType === "id"
          ? { idpGroupName: group, idpGroupId: group, gearflowRole: "", unmapped: true }
          : { idpGroupName: group, gearflowRole: "", unmapped: true },
      );
    }
  }

  if (newGroups.length === 0) return;

  // Merge and persist
  const updatedMappings = [...existing, ...newGroups];
  try {
    const metadata = org.metadata ? JSON.parse(org.metadata as string) : {};
    if (!metadata.sso) metadata.sso = {};
    metadata.sso.groupMappings = updatedMappings;

    await prisma.organization.update({
      where: { id: org.id },
      data: { metadata: JSON.stringify(metadata) },
    });
  } catch {
    // Non-critical — don't break login if discovery fails
  }
}

/**
 * Better Auth SSO provisionUser hook.
 * Called after IdP authentication, before the user gets access.
 * Handles: AUTO_CREATE, REQUIRE_APPROVAL, and EXISTING_ONLY modes.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
export async function handleSSOProvisioning(data: {
  user: { id: string; email: string; name: string } & Record<string, any>;
  userInfo: Record<string, unknown>;
  token?: any;
  provider: { organizationId?: string; providerId: string; samlConfig?: any; oidcConfig?: any; issuer: string; domain: string };
}) {
  const { user, userInfo, provider } = data;
  if (!provider.organizationId) {
    return;
  }

  const org = await prisma.organization.findUnique({
    where: { id: provider.organizationId },
  });
  if (!org) return;

  const ssoSettings = parseSSOSettings(org.metadata);
  if (!ssoSettings?.enabled) return;

  const providerType = provider.samlConfig ? "saml" : "oidc";
  const idpGroups = extractIdpGroups(userInfo, ssoSettings, providerType);

  // Auto-discover new groups from IdP (non-blocking, won't break login)
  await discoverNewGroups(org, ssoSettings, idpGroups, ssoSettings.groupValueType || "name");

  const { role } = await resolveRoleFromGroups(
    idpGroups,
    ssoSettings.groupMappings || [],
    ssoSettings.defaultRole || "member",
    ssoSettings.groupValueType,
    provider.organizationId,
  );

  // Check if already a member
  const existingMember = await prisma.member.findFirst({
    where: { organizationId: provider.organizationId, userId: user.id },
  });

  const mode = ssoSettings.provisioningMode || "AUTO_CREATE";

  if (mode === "EXISTING_ONLY") {
    if (!existingMember) {
      throw new Error("Your account is not authorized for this organization. Contact your administrator.");
    }
    // Optionally sync role on login
    if (ssoSettings.roleSyncBehavior === "SYNC_ON_LOGIN" && existingMember.role !== role) {
      await prisma.member.update({
        where: { id: existingMember.id },
        data: { role },
      });
      // SSO role sync — best-effort mirror (provisioning re-runs on every login,
      // so the mirror self-heals; the nightly reconcile is the backstop §3.3.4).
      await upsertMemberMirrorByOrgUser(provider.organizationId, user.id);
    }
    return;
  }

  if (existingMember) {
    // User is already a member — just sync role if configured
    if (ssoSettings.roleSyncBehavior === "SYNC_ON_LOGIN" && existingMember.role !== role) {
      await prisma.member.update({
        where: { id: existingMember.id },
        data: { role },
      });
      // SSO role sync — best-effort mirror (provisioning re-runs on every login,
      // so the mirror self-heals; the nightly reconcile is the backstop §3.3.4).
      await upsertMemberMirrorByOrgUser(provider.organizationId, user.id);
    }
    return;
  }

  if (mode === "REQUIRE_APPROVAL") {
    // Check if there's already a pending approval
    const existing = await prisma.pendingSSOApproval.findUnique({
      where: {
        organizationId_userId: {
          organizationId: provider.organizationId,
          userId: user.id,
        },
      },
    });

    if (!existing) {
      await prisma.pendingSSOApproval.create({
        data: {
          organizationId: provider.organizationId,
          userId: user.id,
          email: user.email,
          name: user.name,
          idpGroups,
          suggestedRole: role,
          providerId: provider.providerId,
          status: "PENDING",
        },
      });
    }

    // Don't throw — user account exists, they just can't access the org yet.
    // The login flow will detect "no membership" and redirect to /pending-approval.
    return;
  }

  // AUTO_CREATE: Create member immediately
  await prisma.member.create({
    data: {
      organizationId: provider.organizationId,
      userId: user.id,
      role,
    },
  });

  // Additive: mirror best-effort after the Prisma commit.
  await upsertMemberMirrorByOrgUser(provider.organizationId, user.id);

  return;
}
