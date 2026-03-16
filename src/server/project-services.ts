"use server";

import { prisma } from "@/lib/prisma";
import { getOrgContext, requirePermission } from "@/lib/org-context";
import { serialize } from "@/lib/serialize";
import {
  projectServiceSchema,
  serviceTemplateSchema,
  type ProjectServiceFormValues,
  type ServiceTemplateFormValues,
} from "@/lib/validations/project-service";
import { logActivity } from "@/lib/activity-log";
import { sendCrewOffer } from "@/server/crew-communication";
import { recalculateProjectTotals } from "@/server/line-items";
import type { ServiceType, LineItemType, PricingType, ProjectPhase } from "@/generated/prisma/client";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function roundCurrency(n: number): number {
  return Math.round(n * 100) / 100;
}

function calculateServiceLineTotal(
  unitPrice: number | undefined,
  quantity: number,
  duration: number | undefined,
  discount: number | undefined,
): number | null {
  if (unitPrice == null) return null;
  const dur = duration ?? 1;
  const gross = roundCurrency(unitPrice * quantity * dur);
  const disc = discount ?? 0;
  return Math.max(0, roundCurrency(gross - disc));
}

function serviceTypeToLineItemType(type: ServiceType): LineItemType {
  switch (type) {
    case "DELIVERY":
    case "PICKUP":
      return "TRANSPORT";
    case "BUMP_IN":
    case "BUMP_OUT":
    case "LABOUR":
      return "LABOUR";
    case "MISC":
      return "SERVICE";
  }
}

const SERVICE_TYPE_LABELS: Record<ServiceType, string> = {
  DELIVERY: "Delivery",
  PICKUP: "Pickup",
  BUMP_IN: "Bump In",
  BUMP_OUT: "Bump Out",
  LABOUR: "Labour",
  MISC: "Misc",
};

function serviceTypeToPhase(type: ServiceType): ProjectPhase {
  switch (type) {
    case "DELIVERY": return "DELIVERY";
    case "PICKUP": return "PICKUP";
    case "BUMP_IN": return "BUMP_IN";
    case "BUMP_OUT": return "BUMP_OUT";
    case "LABOUR": return "EVENT";
    case "MISC": return "FULL_DURATION";
  }
}

/** For DELIVERY/PICKUP with no crew work window, default to scheduledTime → +1 hr */
function deriveCrewTimes(
  startTime: string | undefined,
  endTime: string | undefined,
  scheduledTime: string | undefined,
  type: ServiceType,
): { crewStart: string | null; crewEnd: string | null } {
  if (startTime) return { crewStart: startTime, crewEnd: endTime || null };
  if (
    (type === "DELIVERY" || type === "PICKUP") &&
    scheduledTime
  ) {
    // Parse HH:MM and add 1 hour
    const [h, m] = scheduledTime.split(":").map(Number);
    const endH = (h + 1) % 24;
    const padded = `${String(endH).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
    return { crewStart: scheduledTime, crewEnd: padded };
  }
  return { crewStart: null, crewEnd: null };
}

// ─── Service CRUD ─────────────────────────────────────────────────────────────

export async function getProjectServices(projectId: string) {
  const { organizationId } = await getOrgContext();

  const services = await prisma.projectService.findMany({
    where: { organizationId, projectId },
    include: {
      crewRole: {
        select: { id: true, name: true, color: true },
      },
      crewAssignments: {
        select: {
          id: true,
          status: true,
          crewMember: {
            select: { id: true, firstName: true, lastName: true, image: true },
          },
        },
      },
    },
    orderBy: [{ date: "asc" }, { sortOrder: "asc" }],
  });

  return serialize(services);
}

export async function getProjectServiceById(id: string) {
  const { organizationId } = await getOrgContext();

  const service = await prisma.projectService.findFirst({
    where: { id, organizationId },
    include: {
      crewRole: { select: { id: true, name: true, color: true } },
      crewAssignments: {
        select: {
          id: true,
          status: true,
          crewMember: {
            select: { id: true, firstName: true, lastName: true, image: true },
          },
        },
      },
    },
  });

  if (!service) throw new Error("Service not found");
  return serialize(service);
}

export async function createProjectService(
  projectId: string,
  data: ProjectServiceFormValues,
) {
  const { organizationId, userId, userName } = await requirePermission(
    "project",
    "update",
  );
  const parsed = projectServiceSchema.parse(data);

  // Verify project belongs to org
  const project = await prisma.project.findFirst({
    where: { id: projectId, organizationId },
    select: { id: true, name: true, projectNumber: true },
  });
  if (!project) throw new Error("Project not found");

  // Get next sort order
  const maxSort = await prisma.projectService.aggregate({
    where: { projectId },
    _max: { sortOrder: true },
  });

  const lineTotal = calculateServiceLineTotal(
    parsed.unitPrice,
    parsed.quantity,
    parsed.duration,
    parsed.discount,
  );

  const serviceDate = parsed.date ? new Date(parsed.date as unknown as string) : null;
  const serviceEndDate = parsed.endDate ? new Date(parsed.endDate as unknown as string) : serviceDate;

  const service = await prisma.projectService.create({
    data: {
      organizationId,
      projectId,
      type: parsed.type,
      title: parsed.title,
      description: parsed.description || null,
      notes: parsed.notes || null,
      date: serviceDate,
      endDate: serviceEndDate,
      startTime: parsed.startTime || null,
      endTime: parsed.endTime || null,
      scheduledTime: parsed.scheduledTime || null,
      estimatedDuration: parsed.estimatedDuration || null,
      address: parsed.address || null,
      latitude: parsed.latitude ?? null,
      longitude: parsed.longitude ?? null,
      showOnDocuments: parsed.showOnDocuments,
      unitPrice: parsed.unitPrice ?? null,
      quantity: parsed.quantity,
      pricingType: (parsed.pricingType && String(parsed.pricingType) !== ""
        ? parsed.pricingType
        : null) as PricingType | null,
      duration: parsed.duration ?? null,
      discount: parsed.discount ?? null,
      lineTotal,
      taxable: parsed.taxable,
      vehicleDescription: parsed.vehicleDescription || null,
      numberOfTrips: parsed.numberOfTrips || null,
      crewCountRequired: parsed.crewCountRequired || null,
      crewRoleId: parsed.crewRoleId || null,
      sortOrder: (maxSort._max.sortOrder ?? -1) + 1,
    },
  });

  // Create crew assignments for selected crew members
  if (parsed.crewMemberIds && parsed.crewMemberIds.length > 0) {
    const phase = serviceTypeToPhase(parsed.type);
    const { crewStart, crewEnd } = deriveCrewTimes(
      parsed.startTime,
      parsed.endTime,
      parsed.scheduledTime,
      parsed.type,
    );
    for (const crewMemberId of parsed.crewMemberIds) {
      try {
        await prisma.crewAssignment.create({
          data: {
            organizationId,
            projectId,
            crewMemberId,
            crewRoleId: parsed.crewRoleId || null,
            serviceId: service.id,
            phase,
            status: "PENDING",
            startDate: serviceDate,
            startTime: crewStart,
            endDate: serviceEndDate,
            endTime: crewEnd,
          },
        });
      } catch {
        // Skip if duplicate (unique constraint on [projectId, crewMemberId, phase])
      }
    }
  }

  // Sync line item if showOnDocuments
  if (parsed.showOnDocuments) {
    await syncServiceLineItem(service.id);
  }

  await logActivity({
    organizationId,
    userId,
    userName,
    action: "created",
    entityType: "service",
    entityId: service.id,
    entityName: service.title,
    summary: `Created ${SERVICE_TYPE_LABELS[service.type]} service "${service.title}"`,
    projectId,
  });

  return serialize(service);
}

export async function updateProjectService(
  id: string,
  data: ProjectServiceFormValues,
) {
  const { organizationId, userId, userName } = await requirePermission(
    "project",
    "update",
  );
  const parsed = projectServiceSchema.parse(data);

  const existing = await prisma.projectService.findFirst({
    where: { id, organizationId },
  });
  if (!existing) throw new Error("Service not found");

  const lineTotal = calculateServiceLineTotal(
    parsed.unitPrice,
    parsed.quantity,
    parsed.duration,
    parsed.discount,
  );

  const serviceDate = parsed.date ? new Date(parsed.date as unknown as string) : null;
  const serviceEndDate = parsed.endDate ? new Date(parsed.endDate as unknown as string) : serviceDate;

  const service = await prisma.projectService.update({
    where: { id },
    data: {
      type: parsed.type,
      title: parsed.title,
      description: parsed.description || null,
      notes: parsed.notes || null,
      date: serviceDate,
      endDate: serviceEndDate,
      startTime: parsed.startTime || null,
      endTime: parsed.endTime || null,
      scheduledTime: parsed.scheduledTime || null,
      estimatedDuration: parsed.estimatedDuration || null,
      address: parsed.address || null,
      latitude: parsed.latitude ?? null,
      longitude: parsed.longitude ?? null,
      showOnDocuments: parsed.showOnDocuments,
      unitPrice: parsed.unitPrice ?? null,
      quantity: parsed.quantity,
      pricingType: (parsed.pricingType && String(parsed.pricingType) !== ""
        ? parsed.pricingType
        : null) as PricingType | null,
      duration: parsed.duration ?? null,
      discount: parsed.discount ?? null,
      lineTotal,
      taxable: parsed.taxable,
      vehicleDescription: parsed.vehicleDescription || null,
      numberOfTrips: parsed.numberOfTrips || null,
      crewCountRequired: parsed.crewCountRequired || null,
      crewRoleId: parsed.crewRoleId || null,
    },
  });

  // Sync crew assignments — reconcile with crewMemberIds
  if (parsed.crewMemberIds != null) {
    const phase = serviceTypeToPhase(parsed.type);
    const existingAssignments = await prisma.crewAssignment.findMany({
      where: { serviceId: id },
      select: { id: true, crewMemberId: true },
    });
    const existingMemberIds = new Set(existingAssignments.map((a) => a.crewMemberId));
    const desiredMemberIds = new Set(parsed.crewMemberIds);

    // Remove assignments for crew no longer selected
    const toRemove = existingAssignments.filter((a) => !desiredMemberIds.has(a.crewMemberId));
    if (toRemove.length > 0) {
      await prisma.crewAssignment.deleteMany({
        where: { id: { in: toRemove.map((a) => a.id) } },
      });
    }

    // Add assignments for newly selected crew
    const { crewStart, crewEnd } = deriveCrewTimes(
      parsed.startTime,
      parsed.endTime,
      parsed.scheduledTime,
      parsed.type,
    );
    const toAdd = parsed.crewMemberIds.filter((id) => !existingMemberIds.has(id));
    for (const crewMemberId of toAdd) {
      try {
        await prisma.crewAssignment.create({
          data: {
            organizationId,
            projectId: existing.projectId,
            crewMemberId,
            crewRoleId: parsed.crewRoleId || null,
            serviceId: id,
            phase,
            status: "PENDING",
            startDate: serviceDate,
            startTime: crewStart,
            endDate: serviceEndDate,
            endTime: crewEnd,
          },
        });
      } catch {
        // Skip duplicates
      }
    }

    // Update role on existing assignments if role changed
    const toUpdateRole = existingAssignments.filter((a) => desiredMemberIds.has(a.crewMemberId));
    if (toUpdateRole.length > 0 && parsed.crewRoleId !== existing.crewRoleId) {
      await prisma.crewAssignment.updateMany({
        where: { id: { in: toUpdateRole.map((a) => a.id) } },
        data: { crewRoleId: parsed.crewRoleId || null },
      });
    }
  }

  // Sync line item based on showOnDocuments
  const wasOnDocuments = existing.showOnDocuments;
  const nowOnDocuments = parsed.showOnDocuments;

  if (nowOnDocuments) {
    await syncServiceLineItem(service.id);
  } else if (wasOnDocuments && !nowOnDocuments) {
    // Remove linked line item
    if (existing.lineItemId) {
      await prisma.projectLineItem.delete({
        where: { id: existing.lineItemId },
      });
      await prisma.projectService.update({
        where: { id },
        data: { lineItemId: null },
      });
      await recalculateProjectTotals(existing.projectId);
    }
  }

  await logActivity({
    organizationId,
    userId,
    userName,
    action: "updated",
    entityType: "service",
    entityId: service.id,
    entityName: service.title,
    summary: `Updated ${SERVICE_TYPE_LABELS[service.type]} service "${service.title}"`,
    projectId: existing.projectId,
  });

  return serialize(service);
}

export async function deleteProjectService(id: string) {
  const { organizationId, userId, userName } = await requirePermission(
    "project",
    "update",
  );

  const service = await prisma.projectService.findFirst({
    where: { id, organizationId },
  });
  if (!service) throw new Error("Service not found");

  // Delete linked line item first
  if (service.lineItemId) {
    await prisma.projectLineItem.delete({
      where: { id: service.lineItemId },
    });
  }

  // Remove crew assignments linked to this service
  await prisma.crewAssignment.deleteMany({
    where: { serviceId: id },
  });

  await prisma.projectService.delete({ where: { id } });

  // Recalculate project totals if there was a linked line item
  if (service.lineItemId) {
    await recalculateProjectTotals(service.projectId);
  }

  await logActivity({
    organizationId,
    userId,
    userName,
    action: "deleted",
    entityType: "service",
    entityId: id,
    entityName: service.title,
    summary: `Deleted ${SERVICE_TYPE_LABELS[service.type]} service "${service.title}"`,
    projectId: service.projectId,
  });
}

export async function updateServiceStatus(
  id: string,
  status: "PLANNED" | "CONFIRMED" | "IN_PROGRESS" | "COMPLETED" | "CANCELLED",
) {
  const { organizationId, userId, userName } = await requirePermission(
    "project",
    "update",
  );

  const service = await prisma.projectService.findFirst({
    where: { id, organizationId },
  });
  if (!service) throw new Error("Service not found");

  const updated = await prisma.projectService.update({
    where: { id },
    data: { status },
  });

  await logActivity({
    organizationId,
    userId,
    userName,
    action: "status_changed",
    entityType: "service",
    entityId: id,
    entityName: service.title,
    summary: `Changed ${service.title} status from ${service.status} to ${status}`,
    projectId: service.projectId,
  });

  return serialize(updated);
}

export async function bulkUpdateServiceStatus(
  ids: string[],
  status: "PLANNED" | "CONFIRMED" | "IN_PROGRESS" | "COMPLETED" | "CANCELLED",
) {
  const { organizationId, userId, userName } = await requirePermission(
    "project",
    "update",
  );

  await prisma.projectService.updateMany({
    where: { id: { in: ids }, organizationId },
    data: { status },
  });

  await logActivity({
    organizationId,
    userId,
    userName,
    action: "bulk_status_changed",
    entityType: "service",
    entityId: ids[0],
    entityName: `${ids.length} services`,
    summary: `Changed ${ids.length} services to ${status}`,
  });
}

export async function updateServiceCrewStatus(
  serviceId: string,
  status: "OFFERED" | "CONFIRMED" | "CANCELLED",
) {
  const { organizationId, userId, userName } = await requirePermission(
    "crew",
    "update",
  );

  const service = await prisma.projectService.findFirst({
    where: { id: serviceId, organizationId },
    select: { id: true, title: true, type: true, projectId: true },
  });
  if (!service) throw new Error("Service not found");

  let updatedCount: number;

  if (status === "OFFERED") {
    // For OFFERED status, use sendCrewOffer to send emails + update status
    const pendingAssignments = await prisma.crewAssignment.findMany({
      where: {
        serviceId,
        status: "PENDING",
        crewMember: { email: { not: null } },
      },
      select: { id: true },
    });

    let sent = 0;
    const errors: string[] = [];
    for (const a of pendingAssignments) {
      try {
        await sendCrewOffer(a.id);
        sent++;
      } catch (e) {
        errors.push((e as Error).message);
      }
    }
    updatedCount = sent;
  } else {
    const result = await prisma.crewAssignment.updateMany({
      where: {
        serviceId,
        ...(status === "CONFIRMED" ? { status: { in: ["PENDING", "OFFERED", "ACCEPTED"] } } : {}),
        ...(status === "CANCELLED" ? { status: { notIn: ["COMPLETED", "CANCELLED"] } } : {}),
      },
      data: { status },
    });
    updatedCount = result.count;
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

// ─── Line Item Sync ───────────────────────────────────────────────────────────

async function syncServiceLineItem(serviceId: string) {
  const service = await prisma.projectService.findUnique({
    where: { id: serviceId },
  });
  if (!service || !service.showOnDocuments) return;

  const lineItemType = serviceTypeToLineItemType(service.type);
  const pricingType = service.pricingType ?? "FLAT";
  const duration = service.duration ? Number(service.duration) : 1;
  const unitPrice = service.unitPrice ? Number(service.unitPrice) : null;
  const discount = service.discount ? Number(service.discount) : null;
  const lineTotal = service.lineTotal ? Number(service.lineTotal) : null;

  if (service.lineItemId) {
    // Update existing line item
    await prisma.projectLineItem.update({
      where: { id: service.lineItemId },
      data: {
        type: lineItemType,
        description: service.title,
        quantity: service.quantity,
        unitPrice,
        pricingType,
        duration: duration,
        discount,
        lineTotal,
      },
    });
  } else {
    // Create new line item
    const maxSort = await prisma.projectLineItem.aggregate({
      where: { projectId: service.projectId },
      _max: { sortOrder: true },
    });

    const lineItem = await prisma.projectLineItem.create({
      data: {
        organizationId: service.organizationId,
        projectId: service.projectId,
        type: lineItemType,
        description: service.title,
        quantity: service.quantity,
        unitPrice,
        pricingType,
        duration: duration,
        discount,
        lineTotal,
        sortOrder: (maxSort._max.sortOrder ?? -1) + 1,
        groupName: "Services",
      },
    });

    await prisma.projectService.update({
      where: { id: serviceId },
      data: { lineItemId: lineItem.id },
    });
  }

  await recalculateProjectTotals(service.projectId);
}

// ─── Service Templates ────────────────────────────────────────────────────────

export async function getServiceTemplates() {
  const { organizationId } = await getOrgContext();

  const templates = await prisma.serviceTemplate.findMany({
    where: { organizationId },
    orderBy: { sortOrder: "asc" },
  });

  return serialize(templates);
}

export async function createServiceTemplate(data: ServiceTemplateFormValues) {
  const { organizationId, userId, userName } = await requirePermission(
    "orgSettings",
    "update",
  );
  const parsed = serviceTemplateSchema.parse(data);

  const maxSort = await prisma.serviceTemplate.aggregate({
    where: { organizationId },
    _max: { sortOrder: true },
  });

  const template = await prisma.serviceTemplate.create({
    data: {
      organizationId,
      type: parsed.type,
      title: parsed.title,
      description: parsed.description || null,
      defaultCrewCount: parsed.defaultCrewCount || null,
      defaultVehicle: parsed.defaultVehicle || null,
      defaultPricingType: (parsed.defaultPricingType && String(parsed.defaultPricingType) !== ""
        ? parsed.defaultPricingType
        : null) as PricingType | null,
      defaultUnitPrice: parsed.defaultUnitPrice ?? null,
      showOnDocuments: parsed.showOnDocuments,
      isAutoAdded: parsed.isAutoAdded,
      isActive: parsed.isActive,
      sortOrder: (maxSort._max.sortOrder ?? -1) + 1,
    },
  });

  await logActivity({
    organizationId,
    userId,
    userName,
    action: "created",
    entityType: "serviceTemplate",
    entityId: template.id,
    entityName: template.title,
    summary: `Created service template "${template.title}"`,
  });

  return serialize(template);
}

export async function updateServiceTemplate(
  id: string,
  data: ServiceTemplateFormValues,
) {
  const { organizationId, userId, userName } = await requirePermission(
    "orgSettings",
    "update",
  );
  const parsed = serviceTemplateSchema.parse(data);

  const existing = await prisma.serviceTemplate.findFirst({
    where: { id, organizationId },
  });
  if (!existing) throw new Error("Template not found");

  const template = await prisma.serviceTemplate.update({
    where: { id },
    data: {
      type: parsed.type,
      title: parsed.title,
      description: parsed.description || null,
      defaultCrewCount: parsed.defaultCrewCount || null,
      defaultVehicle: parsed.defaultVehicle || null,
      defaultPricingType: (parsed.defaultPricingType && String(parsed.defaultPricingType) !== ""
        ? parsed.defaultPricingType
        : null) as PricingType | null,
      defaultUnitPrice: parsed.defaultUnitPrice ?? null,
      showOnDocuments: parsed.showOnDocuments,
      isAutoAdded: parsed.isAutoAdded,
      isActive: parsed.isActive,
    },
  });

  await logActivity({
    organizationId,
    userId,
    userName,
    action: "updated",
    entityType: "serviceTemplate",
    entityId: template.id,
    entityName: template.title,
    summary: `Updated service template "${template.title}"`,
  });

  return serialize(template);
}

export async function deleteServiceTemplate(id: string) {
  const { organizationId, userId, userName } = await requirePermission(
    "orgSettings",
    "update",
  );

  const template = await prisma.serviceTemplate.findFirst({
    where: { id, organizationId },
  });
  if (!template) throw new Error("Template not found");

  await prisma.serviceTemplate.delete({ where: { id } });

  await logActivity({
    organizationId,
    userId,
    userName,
    action: "deleted",
    entityType: "serviceTemplate",
    entityId: id,
    entityName: template.title,
    summary: `Deleted service template "${template.title}"`,
  });
}

// ─── Services Financial Summary ───────────────────────────────────────────────

export async function getProjectServicesSummary(projectId: string) {
  const { organizationId } = await getOrgContext();

  const services = await prisma.projectService.findMany({
    where: { organizationId, projectId, status: { not: "CANCELLED" } },
    select: { showOnDocuments: true, lineTotal: true },
  });

  let onDocumentsTotal = 0;
  let internalTotal = 0;

  for (const s of services) {
    const total = s.lineTotal ? Number(s.lineTotal) : 0;
    if (s.showOnDocuments) {
      onDocumentsTotal += total;
    } else {
      internalTotal += total;
    }
  }

  return serialize({
    onDocumentsTotal: roundCurrency(onDocumentsTotal),
    internalTotal: roundCurrency(internalTotal),
    totalCost: roundCurrency(onDocumentsTotal + internalTotal),
    serviceCount: services.length,
  });
}
