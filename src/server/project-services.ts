"use server";

import { getOrgContext, requirePermission } from "@/lib/org-context";
import { serialize } from "@/lib/serialize";
import { logActivity } from "@/lib/activity-log";
import { getConvexClient } from "@/lib/convex-client";
import { api } from "../../convex/_generated/api";
import { roundCurrency } from "@/lib/formatters";
import {
  getProjectServicesFromConvex,
  getProjectServiceByIdFromConvex,
  getServiceTemplatesFromConvex,
  getProjectServicesSummaryFromConvex,
} from "@/lib/project-service-read";
import { getProjectById } from "@/lib/projects-read";
import { getLocationById } from "@/lib/locations-read";
import { getCrewRoleMap, getCrewMemberMap, getCrewMemberById } from "@/lib/crew-read";
import {
  getAssignmentsByProject,
  compareAscNullsLast,
} from "@/lib/crew-scheduling-read";
import { sendCrewOffer } from "@/server/crew-communication";

/**
 * TRIMMED (Phase 3 browser-direct): the ProjectService + ServiceTemplate write
 * actions moved to native Convex mutations (convex/projectServicesWrites.ts,
 * consumed via useProjectServiceWrites / useServiceTemplateWrites). What remains
 * here is deliberately server-only:
 *
 *  • updateServiceCrewStatus — its OFFERED branch calls sendCrewOffer (crypto + email
 *    + Prisma), which can't run browser-direct.
 *  • generateCrewMessage — a live preview read (no writes).
 *  • getProjectServices / getProjectServicesSummary / getServiceTemplates — live reads
 *    that the shared-store consumers still call server-side.
 */

// ─── Service reads ────────────────────────────────────────────────────────────

export async function getProjectServices(projectId: string) {
  const { organizationId } = await getOrgContext();
  const services = await getProjectServicesFromConvex(organizationId, projectId);
  return serialize(services);
}

export async function getProjectServicesSummary(projectId: string) {
  const { organizationId } = await getOrgContext();

  const { chargeTotal, costTotal, serviceCount } =
    await getProjectServicesSummaryFromConvex(organizationId, projectId);

  return serialize({
    chargeTotal: roundCurrency(chargeTotal),
    costTotal: roundCurrency(costTotal),
    // Legacy compatibility
    totalCost: roundCurrency(costTotal),
    onDocumentsTotal: roundCurrency(chargeTotal),
    internalTotal: roundCurrency(costTotal),
    serviceCount,
  });
}

export async function getServiceTemplates() {
  const { organizationId } = await getOrgContext();
  const templates = await getServiceTemplatesFromConvex(organizationId);
  return serialize(templates);
}

// ─── Crew status (OFFERED → sendCrewOffer stays server) ───────────────────────

export async function updateServiceCrewStatus(
  serviceId: string,
  status: "OFFERED" | "CONFIRMED" | "CANCELLED",
) {
  const { organizationId, userId, userName } = await requirePermission(
    "crew",
    "update",
  );

  // projectService is Convex-only now (Phase C) — read the service there.
  const service = await getProjectServiceByIdFromConvex(organizationId, serviceId).catch(() => null);
  if (!service) throw new Error("Service not found");

  let updatedCount: number;

  // crewAssignment is Convex-only — read the service's assignments there.
  const convex = await getConvexClient();
  const serviceAssignments = (await getAssignmentsByProject(service.projectId, organizationId)).filter(
    (a) => a.serviceId === serviceId,
  );

  if (status === "OFFERED") {
    const memberMap = await getCrewMemberMap(organizationId);
    const pendingAssignments = serviceAssignments.filter(
      (a) => a.status === "PENDING" && (memberMap.get(a.crewMemberId)?.email ?? null) != null,
    );

    let sent = 0;
    for (const a of pendingAssignments) {
      try {
        await sendCrewOffer(a.id);
        sent++;
      } catch {
        // Log but continue — partial send is better than no send
      }
    }
    updatedCount = sent;
  } else {
    const targets = serviceAssignments.filter((a) => {
      if (status === "CONFIRMED") return ["PENDING", "OFFERED", "ACCEPTED"].includes(a.status);
      if (status === "CANCELLED") return !["COMPLETED", "CANCELLED"].includes(a.status);
      return true;
    });
    // Bulk single-call: ONE array mutation instead of one patchAssignment per target
    // (mirrors updateAssignmentStatus' first-transition CONFIRMED stamp per row).
    if (targets.length > 0) {
      const { updated } = await convex.mutation(api.crewAssignments.patchManyStatus, {
        ids: targets.map((a) => a.id),
        orgId: organizationId,
        status: status as "PENDING" | "OFFERED" | "ACCEPTED" | "CONFIRMED" | "DECLINED" | "CANCELLED" | "COMPLETED",
        confirmedById: userId,
        now: Date.now(),
      });
      updatedCount = updated;
    } else {
      updatedCount = 0;
    }
  }

  const statusLabels: Record<string, string> = {
    OFFERED: "sent offers to",
    CONFIRMED: "confirmed",
    CANCELLED: "cancelled",
  };

  await logActivity({
    organizationId,
    userId,
    userName,
    action: "crew_status_changed",
    entityType: "service",
    entityId: serviceId,
    entityName: service.title,
    summary: `${statusLabels[status]} ${updatedCount} crew on "${service.title}"`,
    projectId: service.projectId,
  });

  return serialize({ updated: updatedCount });
}

// ─── Crew Notification Message (live preview read) ────────────────────────────

export async function generateCrewMessage(
  projectId: string,
  crewMemberId: string,
) {
  const { organizationId } = await getOrgContext();

  const convexProject = await getProjectById(projectId);
  if (!convexProject || convexProject.organizationId !== organizationId) {
    throw new Error("Project not found");
  }
  const convexLocation = convexProject.locationId
    ? await getLocationById(convexProject.locationId)
    : null;
  const project = {
    name: convexProject.name,
    projectNumber: convexProject.projectNumber,
    location: convexLocation ? { address: convexLocation.address ?? null } : null,
    siteContactName: convexProject.siteContactName ?? null,
    siteContactPhone: convexProject.siteContactPhone ?? null,
  };

  const memberDoc = await getCrewMemberById(crewMemberId);
  const member = memberDoc && memberDoc.organizationId === organizationId ? memberDoc : null;
  if (!member) throw new Error("Crew member not found");

  // Assignments + their service / crewRole come from Convex (the assignment,
  // projectService and crewRole tables are dual-written). Mirrors the Prisma
  // where (project + member + status notIn CANCELLED/DECLINED) and startDate asc;
  // `service` resolves from the project's services map, `crewRole` from the map.
  const [allAssignments, services, crewRoleMap] = await Promise.all([
    getAssignmentsByProject(projectId, organizationId),
    getProjectServicesFromConvex(organizationId, projectId),
    getCrewRoleMap(organizationId),
  ]);
  const serviceById = new Map(services.map((s) => [s.id, s]));
  const assignments = allAssignments
    .filter(
      (a) =>
        a.crewMemberId === crewMemberId &&
        a.status !== "CANCELLED" &&
        a.status !== "DECLINED",
    )
    .sort((a, b) => compareAscNullsLast(a.startDate?.getTime(), b.startDate?.getTime()))
    .map((a) => ({
      ...a,
      service: a.serviceId ? serviceById.get(a.serviceId) ?? null : null,
      crewRole: a.crewRoleId ? crewRoleMap.get(a.crewRoleId) ?? null : null,
    }));

  // Build message
  const lines: string[] = [];
  lines.push(`Hi ${member.firstName},`);
  lines.push("");
  lines.push(`Here are your details for ${project.name} (${project.projectNumber}):`);
  lines.push("");

  if (project.location?.address) {
    lines.push(`Venue: ${project.location.address}`);
  }
  if (project.siteContactName) {
    lines.push(`Site Contact: ${project.siteContactName}${project.siteContactPhone ? ` (${project.siteContactPhone})` : ""}`);
  }
  lines.push("");

  lines.push("Your Schedule:");
  for (const a of assignments) {
    const svc = a.service;
    if (svc) {
      const dateStr = svc.date
        ? new Date(svc.date).toLocaleDateString("en-AU", { weekday: "short", month: "short", day: "numeric" })
        : "TBC";
      const timeStr = svc.startTime
        ? `${svc.startTime}${svc.endTime ? ` - ${svc.endTime}` : ""}`
        : "";
      const role = a.crewRole?.name ? ` (${a.crewRole.name})` : "";
      lines.push(`  ${dateStr} — ${svc.title}${role}${timeStr ? `, ${timeStr}` : ""}`);
      if (svc.address && svc.address !== project.location?.address) {
        lines.push(`    Location: ${svc.address}`);
      }
    } else {
      const dateStr = a.startDate
        ? new Date(a.startDate).toLocaleDateString("en-AU", { weekday: "short", month: "short", day: "numeric" })
        : "TBC";
      const role = a.crewRole?.name ? ` (${a.crewRole.name})` : "";
      lines.push(`  ${dateStr}${role}`);
    }
  }

  lines.push("");
  lines.push("Please confirm your availability. Thanks!");

  return serialize({
    message: lines.join("\n"),
    crewMemberName: `${member.firstName} ${member.lastName}`,
    crewMemberPhone: member.phone ?? null,
    crewMemberEmail: member.email ?? null,
  });
}
