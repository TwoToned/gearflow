"use server";

import { randomBytes } from "crypto";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/org-context";
import { serialize } from "@/lib/serialize";
import { sendEmail } from "@/lib/email";
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

function generateToken(): string {
  return randomBytes(32).toString("base64url");
}

// ─── Build email data from assignment ────────────────────────────────────────

async function buildAssignmentEmailData(assignmentId: string) {
  const assignment = await prisma.crewAssignment.findUnique({
    where: { id: assignmentId },
    include: {
      crewMember: {
        select: { firstName: true, lastName: true, email: true },
      },
      crewRole: { select: { name: true } },
      project: {
        select: {
          name: true,
          projectNumber: true,
          locationId: true,
          siteContactName: true,
          siteContactPhone: true,
        },
      },
      organization: { select: { name: true } },
    },
  });

  if (!assignment) throw new Error("Assignment not found");

  // Location FK was dropped (Phase B); resolve the project's location from the
  // Convex mirror (replaces the old nested `project.location` select).
  const location = assignment.project.locationId
    ? await getLocationById(assignment.project.locationId)
    : null;

  return {
    assignment,
    emailData: {
      crewFirstName: assignment.crewMember.firstName,
      projectName: assignment.project.name,
      projectNumber: assignment.project.projectNumber,
      roleName: assignment.crewRole?.name || null,
      phase: assignment.phase,
      startDate: assignment.startDate?.toISOString() || null,
      endDate: assignment.endDate?.toISOString() || null,
      startTime: assignment.startTime,
      endTime: assignment.endTime,
      locationName: location?.name || null,
      locationAddress: location?.address || null,
      siteContactName: assignment.project.siteContactName,
      siteContactPhone: assignment.project.siteContactPhone,
      notes: assignment.notes,
      orgName: assignment.organization?.name || "GearFlow",
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

  // Send email
  const email = crewOfferEmail(emailData, acceptUrl, declineUrl);
  await sendEmail({
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

  const assignments = await prisma.crewAssignment.findMany({
    where: {
      projectId,
      organizationId,
      status: "PENDING",
      crewMember: { email: { not: null } },
    },
    select: { id: true },
  });

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
  await sendEmail({
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
  await sendEmail({
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

  const where: Record<string, unknown> = {
    projectId,
    organizationId,
    status: { notIn: ["CANCELLED", "DECLINED"] },
    crewMember: { email: { not: null } },
  };

  if (filter?.phase) where.phase = filter.phase;
  if (filter?.crewRoleId) where.crewRoleId = filter.crewRoleId;

  const assignments = await prisma.crewAssignment.findMany({
    where,
    include: {
      crewMember: { select: { firstName: true, email: true } },
      project: { select: { name: true, projectNumber: true } },
      organization: { select: { name: true } },
    },
  });

  let sent = 0;
  const errors: string[] = [];

  for (const a of assignments) {
    if (!a.crewMember.email) continue;
    try {
      const email = crewBulkMessageEmail(
        a.crewMember.firstName,
        a.project.name,
        a.project.projectNumber,
        message,
        userName,
        a.organization?.name || "GearFlow"
      );
      await sendEmail({
        to: a.crewMember.email,
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
