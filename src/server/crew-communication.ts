"use server";

import { randomBytes } from "crypto";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/org-context";
import { serialize } from "@/lib/serialize";
import { sendEmail } from "@/lib/email";
import { deliverSideEffectEmail } from "@/lib/email-side-effect";
import { logActivity } from "@/lib/activity-log";
import { env } from "@/env";
import {
  crewOfferEmail,
  crewConfirmationEmail,
  crewCancellationEmail,
  crewBulkMessageEmail,
} from "@/lib/crew-emails";
import { getConvexClient } from "@/lib/convex-client";
import { api } from "../../convex/_generated/api";
import { getLocationById } from "@/lib/locations-read";
import {
  getAssignmentById,
  getAssignmentsByProject,
} from "@/lib/crew-scheduling-read";
import { getCrewMemberById, getCrewRoleMap } from "@/lib/crew-read";
import { getProjectByIdMapped } from "@/lib/projects-read";

function generateToken(): string {
  return randomBytes(32).toString("base64url");
}

// ─── Build email data from assignment ────────────────────────────────────────

async function buildAssignmentEmailData(assignmentId: string) {
  // crewAssignment / crewMember / crewRole and project are all dual-written /
  // Convex-only — re-source the assignment + its crew member, role and project
  // from Convex (the old Prisma `crewAssignment.findUnique` reads empty). The
  // organization name stays Prisma (Better-Auth-adjacent org table, kept).
  const assignmentRow = await getAssignmentById(assignmentId);
  if (!assignmentRow) throw new Error("Assignment not found");

  const [crewMember, project, roleMap, org] = await Promise.all([
    getCrewMemberById(assignmentRow.crewMemberId),
    getProjectByIdMapped(assignmentRow.projectId, assignmentRow.organizationId),
    assignmentRow.crewRoleId ? getCrewRoleMap(assignmentRow.organizationId) : Promise.resolve(null),
    prisma.organization.findUnique({
      where: { id: assignmentRow.organizationId },
      select: { name: true },
    }),
  ]);
  if (!crewMember) throw new Error("Assignment not found");
  if (!project) throw new Error("Assignment not found");

  const roleName = assignmentRow.crewRoleId
    ? roleMap?.get(assignmentRow.crewRoleId)?.name ?? null
    : null;

  // Location FK was dropped (Phase B); resolve the project's location from the
  // Convex mirror (replaces the old nested `project.location` select).
  const location = project.locationId
    ? await getLocationById(project.locationId)
    : null;

  // Reconstruct the nested shape the senders consume (assignment.crewMember /
  // .project / .organizationId).
  const assignment = {
    ...assignmentRow,
    crewMember: {
      firstName: crewMember.firstName,
      lastName: crewMember.lastName,
      email: crewMember.email ?? null,
    },
    crewRole: roleName ? { name: roleName } : null,
    project: {
      name: project.name,
      projectNumber: project.projectNumber,
      siteContactName: project.siteContactName,
      siteContactPhone: project.siteContactPhone,
    },
    organization: org ? { name: org.name } : null,
  };

  return {
    assignment,
    emailData: {
      crewFirstName: crewMember.firstName,
      projectName: project.name,
      projectNumber: project.projectNumber,
      roleName,
      phase: assignmentRow.phase,
      startDate: assignmentRow.startDate?.toISOString() || null,
      endDate: assignmentRow.endDate?.toISOString() || null,
      startTime: assignmentRow.startTime,
      endTime: assignmentRow.endTime,
      locationName: location?.name || null,
      locationAddress: location?.address || null,
      siteContactName: project.siteContactName,
      siteContactPhone: project.siteContactPhone,
      notes: assignmentRow.notes,
      orgName: org?.name || "GearFlow",
    },
  };
}

// ─── Send Offer ──────────────────────────────────────────────────────────────

export async function sendCrewOffer(assignmentId: string) {
  const { organizationId, userId, userName } = await requirePermission(
    "crew",
    "update"
  );

  const { assignment, emailData } =
    await buildAssignmentEmailData(assignmentId);

  if (assignment.organizationId !== organizationId) {
    throw new Error("Assignment not found");
  }

  const crewEmail = assignment.crewMember.email;
  if (!crewEmail) {
    throw new Error(
      `${assignment.crewMember.firstName} ${assignment.crewMember.lastName} has no email address`
    );
  }

  // Generate response token
  const token = generateToken();

  // Status-machine: → OFFERED, stamp a fresh single-use token + offeredAt.
  // Convex-only write (dates → epoch-ms).
  const convex = await getConvexClient();
  await convex.mutation(api.crewAssignments.patchAssignment, {
    id: assignmentId,
    set: {
      status: "OFFERED",
      responseToken: token,
      offeredAt: Date.now(),
      updatedAt: Date.now(),
    },
  });

  // Build accept/decline URLs
  const baseUrl = env.NEXT_PUBLIC_APP_URL;
  const acceptUrl = `${baseUrl}/api/crew/respond/${token}?action=accept`;
  const declineUrl = `${baseUrl}/api/crew/respond/${token}?action=decline`;

  // Send email (Phase 6b: routed through the Convex durable/idempotent scheduler
  // when NATIVE_EMAIL_SIDEEFFECTS is on). The response token is a natural nonce —
  // a re-offer mints a new token → new key → new email, while an action retry of
  // this same send dedupes.
  const email = crewOfferEmail(emailData, acceptUrl, declineUrl);
  await deliverSideEffectEmail({
    idempotencyKey: `crew-offer:${assignmentId}:${token}`,
    to: crewEmail,
    subject: email.subject,
    html: email.html,
  });

  await logActivity({
    organizationId,
    userId,
    userName,
    action: "UPDATE",
    entityType: "crew_assignment",
    entityId: assignmentId,
    entityName: `${assignment.crewMember.firstName} ${assignment.crewMember.lastName}`,
    summary: `Sent crew offer to ${assignment.crewMember.firstName} ${assignment.crewMember.lastName} for ${assignment.project.name}`,
  });

  return serialize({ success: true });
}

// ─── Send Offer to All ───────────────────────────────────────────────────────

export async function sendCrewOfferAll(projectId: string) {
  const { organizationId } = await requirePermission("crew", "update");

  // crewAssignment / crewMember are Convex-only — read the project's assignments
  // from Convex, keep PENDING ones whose crew member has an email (replacing the
  // old relational Prisma `where`).
  const projectAssignments = await getAssignmentsByProject(projectId, organizationId);
  const pendingAssignments = projectAssignments.filter((a) => a.status === "PENDING");
  const memberIds = [...new Set(pendingAssignments.map((a) => a.crewMemberId))];
  const memberEmail = new Map<string, string | null>();
  await Promise.all(
    memberIds.map(async (mid) => {
      const m = await getCrewMemberById(mid);
      memberEmail.set(mid, m?.email ?? null);
    }),
  );
  const assignments = pendingAssignments.filter((a) => !!memberEmail.get(a.crewMemberId));

  let sent = 0;
  const errors: string[] = [];

  for (const a of assignments) {
    try {
      await sendCrewOffer(a.id);
      sent++;
    } catch (e) {
      errors.push((e as Error).message);
    }
  }

  return serialize({ sent, errors, total: assignments.length });
}

// ─── Send Confirmation Email ─────────────────────────────────────────────────

export async function sendConfirmationEmail(assignmentId: string) {
  const { organizationId } = await requirePermission("crew", "update");

  const { assignment, emailData } =
    await buildAssignmentEmailData(assignmentId);

  if (assignment.organizationId !== organizationId) {
    throw new Error("Assignment not found");
  }

  const crewEmail = assignment.crewMember.email;
  if (!crewEmail) return serialize({ success: false, reason: "no email" });

  const email = crewConfirmationEmail(emailData);
  await deliverSideEffectEmail({
    // No natural token here — mint a per-send nonce so a user-initiated re-send
    // is a new email while an action retry of THIS send dedupes.
    idempotencyKey: `crew-confirm:${assignmentId}:${generateToken()}`,
    to: crewEmail,
    subject: email.subject,
    html: email.html,
  });

  return serialize({ success: true });
}

// ─── Send Cancellation Email ─────────────────────────────────────────────────

export async function sendCancellationEmail(assignmentId: string) {
  const { organizationId } = await requirePermission("crew", "update");

  const { assignment, emailData } =
    await buildAssignmentEmailData(assignmentId);

  if (assignment.organizationId !== organizationId) {
    throw new Error("Assignment not found");
  }

  const crewEmail = assignment.crewMember.email;
  if (!crewEmail) return serialize({ success: false, reason: "no email" });

  const email = crewCancellationEmail(emailData);
  await deliverSideEffectEmail({
    idempotencyKey: `crew-cancel:${assignmentId}:${generateToken()}`,
    to: crewEmail,
    subject: email.subject,
    html: email.html,
  });

  return serialize({ success: true });
}

// ─── Bulk Message ────────────────────────────────────────────────────────────

export async function sendBulkMessage(
  projectId: string,
  message: string,
  filter?: { phase?: string; crewRoleId?: string }
) {
  const { organizationId, userName } = await requirePermission(
    "crew",
    "update"
  );

  // crewAssignment / crewMember / project / organization are dual-written /
  // Convex-only — read the project's assignments from Convex and replicate the
  // Prisma `where` (status notIn [CANCELLED, DECLINED], crewMember has email, +
  // optional phase / crewRoleId) in JS. crewMember (first name + email) + project
  // (name + number) come from Convex; org name stays Prisma.
  const projectAssignments = await getAssignmentsByProject(projectId, organizationId);
  const filteredAssignments = projectAssignments.filter(
    (a) =>
      a.status !== "CANCELLED" &&
      a.status !== "DECLINED" &&
      (filter?.phase ? a.phase === filter.phase : true) &&
      (filter?.crewRoleId ? a.crewRoleId === filter.crewRoleId : true),
  );

  const [project, org] = await Promise.all([
    getProjectByIdMapped(projectId, organizationId),
    prisma.organization.findUnique({ where: { id: organizationId }, select: { name: true } }),
  ]);
  const memberIds = [...new Set(filteredAssignments.map((a) => a.crewMemberId))];
  const memberById = new Map<string, { firstName: string; email: string | null }>();
  await Promise.all(
    memberIds.map(async (mid) => {
      const m = await getCrewMemberById(mid);
      if (m) memberById.set(mid, { firstName: m.firstName, email: m.email ?? null });
    }),
  );
  // crewMember email present (mirrors `crewMember: { email: { not: null } }`).
  const assignments = filteredAssignments.filter((a) => !!memberById.get(a.crewMemberId)?.email);

  let sent = 0;
  const errors: string[] = [];

  for (const a of assignments) {
    const member = memberById.get(a.crewMemberId);
    if (!member?.email) continue;
    try {
      const email = crewBulkMessageEmail(
        member.firstName,
        project?.name ?? "",
        project?.projectNumber ?? "",
        message,
        userName,
        org?.name || "GearFlow"
      );
      await sendEmail({
        to: member.email,
        subject: email.subject,
        html: email.html,
      });
      sent++;
    } catch (e) {
      errors.push((e as Error).message);
    }
  }

  return serialize({ sent, errors, total: assignments.length });
}
