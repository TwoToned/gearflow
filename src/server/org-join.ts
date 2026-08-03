"use server";

import { createId } from "@paralleldrive/cuid2";
import { prisma } from "@/lib/prisma";
import { getConvexClient } from "@/lib/convex-client";
import { api } from "../../convex/_generated/api";
import { getOrgContext, requirePermission } from "@/lib/org-context";
import { requireSession } from "@/lib/auth-server";
import { serialize } from "@/lib/serialize";
import { sendEmail } from "@/lib/email";
import { logger } from "@/lib/logger";
import {
  joinRequestReceivedEmail,
  ssoAccessApprovedEmail,
  ssoAccessRejectedEmail,
} from "@/lib/email-templates";
import { getPlatformName } from "@/lib/platform";
import { logActivity } from "@/lib/activity-log";
import { upsertMemberMirrorByOrgUser } from "@/lib/member-mirror";
import { readOrgSettingsBlob, saveOrgSettings } from "@/lib/org-settings-read";
import { env } from "@/env";
import {
  isOrgJoinPolicy,
  toOrgJoinPolicy,
  type OrgJoinPolicy,
} from "@/lib/org-join-policy";

/**
 * B2 (#1094) — "join an existing org", the second branch of `/welcome`'s
 * create-vs-join fork (B1, #1092). Two self-serve paths:
 *
 *  - Invite code: reuses the existing `Invitation` → `/invite/[id]` →
 *    `acceptInvitation` flow unchanged; `checkInviteCode` below just
 *    validates a pasted code/link before navigating there.
 *  - Verified-domain request: the functions below. Gated on the requesting
 *    user's `emailVerified` (never on the client alone — every mutating
 *    action re-checks server-side, R-9.3) and on the target org's
 *    `joinPolicy` being DOMAIN_REQUEST (#1073's deferred half).
 */

// ─── Invite code ─────────────────────────────────────────────────────────────

/** Extract a bare invitation id from a pasted invite link or raw id, and
 *  confirm it's still a live pending invite — so `/welcome`'s code field can
 *  show an inline error instead of a blind navigation to a dead invite. */
export async function checkInviteCode(rawInput: string): Promise<{ id: string } | null> {
  const trimmed = rawInput.trim();
  if (!trimmed) return null;
  const marker = "/invite/";
  const afterMarker = trimmed.includes(marker) ? trimmed.slice(trimmed.lastIndexOf(marker) + marker.length) : trimmed;
  const id = afterMarker.split(/[/?#]/)[0]?.trim();
  if (!id) return null;

  const invitation = await prisma.invitation.findUnique({
    where: { id },
    select: { status: true, expiresAt: true },
  });
  if (!invitation || invitation.status !== "pending" || invitation.expiresAt < new Date()) {
    return null;
  }
  return { id };
}

// ─── Join policy (Settings → Team) ──────────────────────────────────────────

export async function getJoinPolicy(): Promise<OrgJoinPolicy> {
  const { organizationId } = await getOrgContext();
  const settings = await readOrgSettingsBlob(organizationId);
  return toOrgJoinPolicy(settings.joinPolicy);
}

export async function setJoinPolicy(policy: OrgJoinPolicy) {
  const { organizationId, userId, userName } = await requirePermission("orgSettings", "update");
  if (!isOrgJoinPolicy(policy)) throw new Error("Invalid join policy");

  const settings = await readOrgSettingsBlob(organizationId);
  settings.joinPolicy = policy;
  await saveOrgSettings(organizationId, settings);

  await logActivity({
    organizationId,
    userId,
    userName,
    action: "UPDATE",
    entityType: "org_join_policy",
    entityId: organizationId,
    entityName: "Join Policy",
    summary: `Set join policy to ${policy}`,
  });

  return { success: true };
}

// ─── Verified-domain request — discovery + create (public-to-a-session) ────

export interface JoinableOrg {
  organizationId: string;
  organizationName: string;
  memberCount: number;
  alreadyRequested: boolean;
}

/**
 * Orgs a signed-in, zero-org user can ask to join by domain match. Requires a
 * session but deliberately NOT an org context — this runs for a user who by
 * definition doesn't have one yet (`/welcome`).
 */
export async function getJoinableOrgs(): Promise<{ requiresVerification: boolean; orgs: JoinableOrg[] }> {
  const session = await requireSession();
  if (!session.user.emailVerified) {
    return { requiresVerification: true, orgs: [] };
  }

  const email = session.user.email?.toLowerCase();
  const domain = email?.split("@")[1];
  if (!domain) return { requiresVerification: false, orgs: [] };

  const convex = await getConvexClient();
  const [matches, pending] = await Promise.all([
    convex.query(api.pendingOrgJoinRequests.findJoinableOrgsForDomain, {
      domain,
      excludeUserId: session.user.id,
    }),
    convex.query(api.pendingOrgJoinRequests.listPendingByUser, { userId: session.user.id }),
  ]);
  const pendingOrgIds = new Set(pending.map((p) => p.organizationId));

  return {
    requiresVerification: false,
    orgs: matches.map((m) => ({ ...m, alreadyRequested: pendingOrgIds.has(m.organizationId) })),
  };
}

/** Ask to join `organizationId`. Every authority check (policy, membership,
 *  domain match) is re-derived and re-verified inside the Convex `request`
 *  mutation itself, not here — this action only supplies the identity. */
export async function requestToJoinOrg(organizationId: string) {
  const session = await requireSession();
  if (!session.user.emailVerified) {
    throw new Error("Please verify your email before requesting to join an organisation.");
  }
  if (!session.user.email) throw new Error("Your account has no email address.");

  const convex = await getConvexClient();
  const result = await convex.mutation(api.pendingOrgJoinRequests.request, {
    id: createId(),
    organizationId,
    userId: session.user.id,
    email: session.user.email,
    name: session.user.name || undefined,
    createdAt: Date.now(),
  });

  if (result.created) {
    const org = await prisma.organization.findUnique({ where: { id: organizationId }, select: { name: true } });
    const admins = await prisma.member.findMany({
      where: { organizationId, role: { in: ["owner", "admin"] } },
      include: { user: { select: { email: true } } },
    });
    const pName = await getPlatformName();
    const reviewUrl = `${env.NEXT_PUBLIC_APP_URL}/settings/team`;
    await Promise.all(
      admins
        .filter((m: { user: { email: string } }) => m.user.email)
        .map((m: { user: { email: string } }) =>
          sendEmail({
            to: m.user.email,
            ...joinRequestReceivedEmail({
              orgName: org?.name || "your organisation",
              requesterName: session.user.name,
              requesterEmail: session.user.email,
              reviewUrl,
              platformName: pName,
            }),
          }).catch((e) => logger.error("async task failed", { error: e })),
        ),
    );
  }

  return serialize(result);
}

// ─── Approve / reject (Settings → Team) ─────────────────────────────────────

export async function getPendingJoinRequests() {
  const { organizationId } = await getOrgContext();
  const rows = await (await getConvexClient()).query(api.pendingOrgJoinRequests.list, { orgId: organizationId });
  const requests = rows.map((r) => ({ ...r, createdAt: r.createdAt != null ? new Date(r.createdAt) : new Date(0) }));
  return serialize(requests);
}

const JOIN_APPROVAL_ROLES = ["admin", "manager", "member", "warehouse", "viewer"];

export async function approveJoinRequest(requestId: string, role?: string) {
  const { organizationId, userId, userName } = await requirePermission("orgMembers", "create");
  const convex = await getConvexClient();

  let claimed: { userId: string; email: string };
  try {
    claimed = await convex.mutation(api.pendingOrgJoinRequests.review, {
      id: requestId,
      orgId: organizationId,
      status: "APPROVED",
      reviewedById: userId,
      reviewedAt: Date.now(),
    });
  } catch {
    throw new Error("Pending join request not found");
  }

  const assignRole = role && JOIN_APPROVAL_ROLES.includes(role) ? role : "member";

  try {
    const existingMember = await prisma.member.findFirst({
      where: { organizationId, userId: claimed.userId },
      select: { id: true },
    });
    if (!existingMember) {
      await prisma.member.create({ data: { organizationId, userId: claimed.userId, role: assignRole } });
    }
  } catch (e) {
    await convex
      .mutation(api.pendingOrgJoinRequests.revertToPending, { id: requestId, orgId: organizationId })
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
    summary: `Approved join request from ${claimed.email} with role ${assignRole}`,
  });

  await upsertMemberMirrorByOrgUser(organizationId, claimed.userId);

  const pName = await getPlatformName();
  const org = await prisma.organization.findUnique({ where: { id: organizationId }, select: { name: true } });
  sendEmail({
    to: claimed.email,
    ...ssoAccessApprovedEmail({
      orgName: org?.name || "the organization",
      role: assignRole,
      dashboardUrl: `${env.NEXT_PUBLIC_APP_URL}/dashboard`,
      platformName: pName,
    }),
  }).catch((e) => logger.error("async task failed", { error: e }));

  return { success: true };
}

export async function rejectJoinRequest(requestId: string, note?: string) {
  const { organizationId, userId, userName } = await requirePermission("orgMembers", "create");

  let request: { userId: string; email: string };
  try {
    request = await (await getConvexClient()).mutation(api.pendingOrgJoinRequests.review, {
      id: requestId,
      orgId: organizationId,
      status: "REJECTED",
      reviewedById: userId,
      reviewedAt: Date.now(),
      reviewNote: note,
    });
  } catch {
    throw new Error("Pending join request not found");
  }

  await logActivity({
    organizationId,
    userId,
    userName,
    action: "DELETE",
    entityType: "pending_org_join_request",
    entityId: requestId,
    entityName: request.email,
    summary: `Rejected join request from ${request.email}${note ? `: ${note}` : ""}`,
  });

  const pName = await getPlatformName();
  const org = await prisma.organization.findUnique({ where: { id: organizationId }, select: { name: true } });
  sendEmail({
    to: request.email,
    ...ssoAccessRejectedEmail({ orgName: org?.name || "the organization", note, platformName: pName }),
  }).catch((e) => logger.error("async task failed", { error: e }));

  return { success: true };
}
