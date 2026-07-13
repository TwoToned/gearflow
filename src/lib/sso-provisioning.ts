import { createId } from "@paralleldrive/cuid2";
import { prisma } from "./prisma";
import { getConvexClient } from "./convex-client";
import { api } from "../../convex/_generated/api";
import { upsertMemberMirrorByOrgUser } from "./member-mirror";
import { readOrgSettingsBlob, saveOrgSettings } from "./org-settings-read";
import type { OrgSSOSettings, SSOGroupMapping } from "./sso-types";

/**
 * Role hierarchy for resolving multiple group matches.
 * Lower index = higher privilege.
 */
const ROLE_HIERARCHY = ["owner", "admin", "manager", "member", "warehouse", "viewer"];

/**
 * Roles an SSO login may assign. Owner is EXCLUDED (ownership transfer is a separate,
 * deliberate flow — SSO must never mint an owner). Any misconfigured/unknown role
 * (e.g. a stale "custom:…", "owner", or a typo) clamps to `member` so a login can
 * neither escalate to owner nor lock the user out with a role that grants nothing.
 */
const SSO_ASSIGNABLE_ROLES = ["admin", "manager", "member", "warehouse", "viewer"];
function clampAssignableRole(role: string): string {
  return SSO_ASSIGNABLE_ROLES.includes(role) ? role : "member";
}

/**
 * Resolve a built-in GearFlow role from IdP group memberships via the org's explicit
 * group→role mappings (custom roles were removed). Never returns owner or an unknown
 * role — the result is always an assignable built-in role.
 */
function resolveRoleFromGroups(
  idpGroups: string[],
  mappings: SSOGroupMapping[],
  defaultRole: string,
  groupValueType: "name" | "id" = "name",
): { role: string } {
  // Match explicit IdP-group → built-in-role mappings (custom roles were removed).
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
    // Clamp the configured default too — it must never mint an owner or a role that
    // grants nothing (misconfigured settings would otherwise escalate or lock out).
    return { role: clampAssignableRole(defaultRole) };
  }

  // Highest-privilege matched role — but consider ONLY assignable roles as candidates,
  // filtering owner/invalid BEFORE ranking. (Clamping only after ranking would let an
  // "owner" mapping win the hierarchy and then collapse to "member", discarding a valid
  // "admin" match that should have won.) Start from the clamped default.
  let bestRole = clampAssignableRole(defaultRole);
  let bestIndex = ROLE_HIERARCHY.indexOf(bestRole);
  if (bestIndex === -1) bestIndex = ROLE_HIERARCHY.length;

  for (const mapping of matchedMappings) {
    if (!SSO_ASSIGNABLE_ROLES.includes(mapping.gearflowRole)) continue; // never owner/invalid
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
 * Auto-discover IdP groups: persist any previously-unseen groups to
 * the org's SSO group mappings (with unmapped=true, no role assigned).
 * This lets admins see what groups exist before they map them.
 */
async function discoverNewGroups(
  organizationId: string,
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

  // Merge and persist into the Convex org-settings blob (source of truth).
  const updatedMappings = [...existing, ...newGroups];
  try {
    const settings = await readOrgSettingsBlob(organizationId);
    if (!settings.sso) settings.sso = {} as OrgSSOSettings;
    settings.sso.groupMappings = updatedMappings;
    await saveOrgSettings(organizationId, settings);
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
    select: { id: true },
  });
  if (!org) return;

  // SSO config lives in the Convex org-settings blob (source of truth).
  const settings = await readOrgSettingsBlob(provider.organizationId);
  const ssoSettings = settings.sso ?? null;
  if (!ssoSettings?.enabled) return;

  const providerType = provider.samlConfig ? "saml" : "oidc";
  const idpGroups = extractIdpGroups(userInfo, ssoSettings, providerType);

  // Auto-discover new groups from IdP (non-blocking, won't break login)
  await discoverNewGroups(provider.organizationId, ssoSettings, idpGroups, ssoSettings.groupValueType || "name");

  const { role } = resolveRoleFromGroups(
    idpGroups,
    ssoSettings.groupMappings || [],
    ssoSettings.defaultRole || "member",
    ssoSettings.groupValueType,
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
    if (ssoSettings.roleSyncBehavior === "SYNC_ON_LOGIN" && existingMember.role !== "owner" && existingMember.role !== role) {
      // Atomic owner-guard: never demote an owner even if ownership transferred to
      // this member between the read above and this write (TOCTOU).
      await prisma.member.updateMany({
        where: { id: existingMember.id, role: { not: "owner" } },
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
    if (ssoSettings.roleSyncBehavior === "SYNC_ON_LOGIN" && existingMember.role !== "owner" && existingMember.role !== role) {
      // Atomic owner-guard: never demote an owner even if ownership transferred to
      // this member between the read above and this write (TOCTOU).
      await prisma.member.updateMany({
        where: { id: existingMember.id, role: { not: "owner" } },
        data: { role },
      });
      // SSO role sync — best-effort mirror (provisioning re-runs on every login,
      // so the mirror self-heals; the nightly reconcile is the backstop §3.3.4).
      await upsertMemberMirrorByOrgUser(provider.organizationId, user.id);
    }
    return;
  }

  if (mode === "REQUIRE_APPROVAL") {
    // Enqueue a PENDING approval (Convex). Idempotent on (org, userId) inside the
    // mutation — reproduces the old `@@unique` + "create only if none exists", with
    // no TOCTOU race (Convex mutations are transactional).
    await (await getConvexClient()).mutation(
      api.pendingSSOApprovals.createForProvisioning,
      {
        id: createId(),
        organizationId: provider.organizationId,
        userId: user.id,
        email: user.email,
        name: user.name ?? undefined,
        idpGroups,
        suggestedRole: role ?? undefined,
        providerId: provider.providerId,
        createdAt: Date.now(),
      },
    );

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
