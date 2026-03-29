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
import { roundCurrency } from "@/lib/formatters";
import { sendCrewOffer } from "@/server/crew-communication";
import { recalculateProjectTotals } from "@/server/line-items";
import { SERVICE_TYPE_LABELS } from "@/lib/constants/services";
import type { ServiceType, LineItemType, PricingType, ProjectPhase } from "@/generated/prisma/client";

// ─── Helpers ──────────────────────────────────────────────────────────────────

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
    const [h, m] = scheduledTime.split(":").map(Number);
    const endH = (h + 1) % 24;
    const padded = `${String(endH).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
    return { crewStart: scheduledTime, crewEnd: padded };
  }
  return { crewStart: null, crewEnd: null };
}

/** DRY helper: build the shared data shape for create + update (Arch fix #8) */
function buildServiceData(parsed: ReturnType<typeof projectServiceSchema.parse>) {
  const serviceDate = parsed.date ? new Date(parsed.date as unknown as string) : null;
  const serviceEndDate = parsed.endDate ? new Date(parsed.endDate as unknown as string) : serviceDate;
  const lineTotal = calculateServiceLineTotal(
    parsed.unitPrice,
    parsed.quantity,
    parsed.duration,
    parsed.discount,
  );

  return {
    fields: {
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
      billableToClient: parsed.billableToClient,
      unitPrice: parsed.unitPrice ?? null,
      quantity: parsed.quantity,
      pricingType: (parsed.pricingType && String(parsed.pricingType) !== ""
        ? parsed.pricingType
        : null) as PricingType | null,
      duration: parsed.duration ?? null,
      discount: parsed.discount ?? null,
      lineTotal,
      costTotal: parsed.costTotal ?? null,
      taxable: parsed.taxable,
      vehicleDescription: parsed.vehicleDescription || null,
      numberOfTrips: parsed.numberOfTrips || null,
      crewCountRequired: parsed.crewCountRequired || null,
      crewRoleId: parsed.crewRoleId || null,
    },
    serviceDate,
    serviceEndDate,
    lineTotal,
  };
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
          estimatedCost: true,
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

  const project = await prisma.project.findFirst({
    where: { id: projectId, organizationId },
    select: { id: true, name: true, projectNumber: true },
  });
  if (!project) throw new Error("Project not found");

  const { fields, serviceDate, serviceEndDate } = buildServiceData(parsed);

  // Wrap in transaction (Arch fix #1)
  const service = await prisma.$transaction(async (tx) => {
    const maxSort = await tx.projectService.aggregate({
      where: { projectId },
      _max: { sortOrder: true },
    });

    const svc = await tx.projectService.create({
      data: {
        organizationId,
        projectId,
        ...fields,
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
        await tx.crewAssignment.create({
          data: {
            organizationId,
            projectId,
            crewMemberId,
            crewRoleId: parsed.crewRoleId || null,
            serviceId: svc.id,
            phase,
            status: "PENDING",
            startDate: serviceDate,
            startTime: crewStart,
            endDate: serviceEndDate,
            endTime: crewEnd,
          },
        });
      }
    }

    return svc;
  });

  // Sync line item if showOnDocuments (outside transaction — calls recalculate)
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

  const { fields, serviceDate, serviceEndDate } = buildServiceData(parsed);

  // Wrap in transaction (Arch fix #1)
  const service = await prisma.$transaction(async (tx) => {
    const svc = await tx.projectService.update({
      where: { id },
      data: fields,
    });

    // Sync crew assignments — reconcile with crewMemberIds
    if (parsed.crewMemberIds != null) {
      const phase = serviceTypeToPhase(parsed.type);
      const existingAssignments = await tx.crewAssignment.findMany({
        where: { serviceId: id },
        select: { id: true, crewMemberId: true },
      });
      const existingMemberIds = new Set(existingAssignments.map((a) => a.crewMemberId));
      const desiredMemberIds = new Set(parsed.crewMemberIds);

      // Remove assignments for crew no longer selected
      const toRemove = existingAssignments.filter((a) => !desiredMemberIds.has(a.crewMemberId));
      if (toRemove.length > 0) {
        await tx.crewAssignment.deleteMany({
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
      const toAdd = parsed.crewMemberIds.filter((memberId) => !existingMemberIds.has(memberId));
      for (const crewMemberId of toAdd) {
        await tx.crewAssignment.create({
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
      }

      // Update role on existing assignments if role changed
      const toUpdateRole = existingAssignments.filter((a) => desiredMemberIds.has(a.crewMemberId));
      if (toUpdateRole.length > 0 && parsed.crewRoleId !== existing.crewRoleId) {
        await tx.crewAssignment.updateMany({
          where: { id: { in: toUpdateRole.map((a) => a.id) } },
          data: { crewRoleId: parsed.crewRoleId || null },
        });
      }
    }

    return svc;
  });

  // Sync line item based on showOnDocuments
  const wasOnDocuments = existing.showOnDocuments;
  const nowOnDocuments = parsed.showOnDocuments;

  if (nowOnDocuments) {
    await syncServiceLineItem(service.id);
  } else if (wasOnDocuments && !nowOnDocuments) {
    // Unlink line item (Arch fix #7 — always unlink, never delete the line item)
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

  // Wrap in transaction (Arch fix #1)
  await prisma.$transaction(async (tx) => {
    // Unlink line item — set lineItemId to null, don't delete the line item (Arch fix #7)
    if (service.lineItemId) {
      await tx.projectService.update({
        where: { id },
        data: { lineItemId: null },
      });
      // Delete the orphaned line item since the service is being deleted
      await tx.projectLineItem.delete({
        where: { id: service.lineItemId },
      });
    }

    // Remove crew assignments linked to this service
    await tx.crewAssignment.deleteMany({
      where: { serviceId: id },
    });

    await tx.projectService.delete({ where: { id } });
  });

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
    const pendingAssignments = await prisma.crewAssignment.findMany({
      where: {
        serviceId,
        status: "PENDING",
        crewMember: { email: { not: null } },
      },
      select: { id: true },
    });

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
    // Guard: verify line item exists and is NOT a kit child (Arch fix #6)
    const existingLineItem = await prisma.projectLineItem.findUnique({
      where: { id: service.lineItemId },
      select: { id: true, isKitChild: true },
    });
    if (!existingLineItem) {
      // Line item was deleted externally — unlink and create fresh
      await prisma.projectService.update({
        where: { id: serviceId },
        data: { lineItemId: null },
      });
    } else if (existingLineItem.isKitChild) {
      // Service line items can never be kit children — unlink silently
      await prisma.projectService.update({
        where: { id: serviceId },
        data: { lineItemId: null },
      });
    } else {
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
      await recalculateProjectTotals(service.projectId);
      return;
    }
  }

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

  await recalculateProjectTotals(service.projectId);
}

// ─── Generate Services (Phase 1) ─────────────────────────────────────────────

/** Map service types to project date fields */
function getServiceDateForType(
  type: ServiceType,
  project: {
    loadInDate: Date | null;
    loadOutDate: Date | null;
    eventStartDate: Date | null;
    eventEndDate: Date | null;
  },
): { date: Date | null; endDate: Date | null } {
  switch (type) {
    case "DELIVERY":
      return { date: project.loadInDate, endDate: project.loadInDate };
    case "BUMP_IN":
      return { date: project.loadInDate, endDate: project.loadInDate };
    case "BUMP_OUT":
      return { date: project.loadOutDate, endDate: project.loadOutDate };
    case "PICKUP":
      return { date: project.loadOutDate, endDate: project.loadOutDate };
    case "LABOUR":
      return { date: project.eventStartDate, endDate: project.eventEndDate ?? project.eventStartDate };
    case "MISC":
      return { date: project.eventStartDate, endDate: project.eventEndDate ?? project.eventStartDate };
  }
}

export async function generateProjectServices(projectId: string) {
  const { organizationId, userId, userName } = await requirePermission(
    "project",
    "update",
  );

  const project = await prisma.project.findFirst({
    where: { id: projectId, organizationId },
    select: {
      id: true,
      name: true,
      projectNumber: true,
      loadInDate: true,
      loadOutDate: true,
      eventStartDate: true,
      eventEndDate: true,
      location: {
        select: { address: true, latitude: true, longitude: true },
      },
    },
  });
  if (!project) throw new Error("Project not found");

  // Need at least one date to generate
  if (!project.loadInDate && !project.loadOutDate && !project.eventStartDate) {
    throw new Error("Project must have at least one date (load in, load out, or event start) to generate services");
  }

  // Get auto-added templates + all active templates as fallback
  const templates = await prisma.serviceTemplate.findMany({
    where: { organizationId, isActive: true },
    orderBy: { sortOrder: "asc" },
  });

  // Use only isAutoAdded templates; if none exist, use all active templates
  const autoTemplates = templates.filter((t) => t.isAutoAdded);
  const templatesToUse = autoTemplates.length > 0 ? autoTemplates : templates;

  if (templatesToUse.length === 0) {
    // No templates — generate default set
    const defaultTypes: ServiceType[] = ["DELIVERY", "BUMP_IN", "BUMP_OUT", "PICKUP"];
    const templatesToUse = defaultTypes.map((type) => ({
      type,
      title: SERVICE_TYPE_LABELS[type],
      description: null as string | null,
      defaultCrewCount: null as number | null,
      defaultVehicle: null as string | null,
      defaultPricingType: null as string | null,
      defaultUnitPrice: null as unknown,
      showOnDocuments: false,
    }));
    // Add event day services if event dates exist
    if (project.eventStartDate) {
      templatesToUse.push({
        type: "LABOUR",
        title: "Show Day",
        description: null,
        defaultCrewCount: null,
        defaultVehicle: null,
        defaultPricingType: null,
        defaultUnitPrice: null,
        showOnDocuments: false,
      });
    }
    return await _createServicesFromTemplateData(
      projectId,
      organizationId,
      project,
      templatesToUse,
      userId,
      userName,
    );
  }

  return await _createServicesFromTemplateData(
    projectId,
    organizationId,
    project,
    templatesToUse,
    userId,
    userName,
  );
}

async function _createServicesFromTemplateData(
  projectId: string,
  organizationId: string,
  project: {
    id: string;
    name: string;
    projectNumber: string;
    loadInDate: Date | null;
    loadOutDate: Date | null;
    eventStartDate: Date | null;
    eventEndDate: Date | null;
    location: { address: string | null; latitude: number | null; longitude: number | null } | null;
  },
  templates: Array<{
    type: ServiceType;
    title: string;
    description: string | null;
    defaultCrewCount: number | null;
    defaultVehicle: string | null;
    defaultPricingType: string | null;
    defaultUnitPrice: unknown;
    showOnDocuments: boolean;
  }>,
  userId: string,
  userName: string,
) {
  // Get existing services to avoid duplicates (idempotent re-run)
  const existingServices = await prisma.projectService.findMany({
    where: { projectId },
    select: { type: true, date: true },
  });

  const existingKey = new Set(
    existingServices.map((s) =>
      `${s.type}:${s.date ? s.date.toISOString().slice(0, 10) : "null"}`
    ),
  );

  const toCreate: Array<{
    type: ServiceType;
    title: string;
    description: string | null;
    date: Date | null;
    endDate: Date | null;
    crewCountRequired: number | null;
    vehicleDescription: string | null;
    pricingType: PricingType | null;
    unitPrice: number | null;
    showOnDocuments: boolean;
  }> = [];

  for (const tmpl of templates) {
    const { date, endDate } = getServiceDateForType(tmpl.type, project);
    if (!date) continue; // Skip types with no applicable date

    // For LABOUR type with multi-day events, create one service per day
    if (tmpl.type === "LABOUR" && date && endDate && endDate > date) {
      const current = new Date(date);
      const end = new Date(endDate);
      while (current <= end) {
        const dayKey = `${tmpl.type}:${current.toISOString().slice(0, 10)}`;
        if (!existingKey.has(dayKey)) {
          toCreate.push({
            type: tmpl.type,
            title: tmpl.title,
            description: tmpl.description,
            date: new Date(current),
            endDate: new Date(current),
            crewCountRequired: tmpl.defaultCrewCount,
            vehicleDescription: tmpl.defaultVehicle,
            pricingType: (tmpl.defaultPricingType || null) as PricingType | null,
            unitPrice: tmpl.defaultUnitPrice != null ? Number(tmpl.defaultUnitPrice) : null,
            showOnDocuments: tmpl.showOnDocuments,
          });
        }
        current.setDate(current.getDate() + 1);
      }
    } else {
      const dayKey = `${tmpl.type}:${date.toISOString().slice(0, 10)}`;
      if (!existingKey.has(dayKey)) {
        toCreate.push({
          type: tmpl.type,
          title: tmpl.title,
          description: tmpl.description,
          date,
          endDate: endDate ?? date,
          crewCountRequired: tmpl.defaultCrewCount,
          vehicleDescription: tmpl.defaultVehicle,
          pricingType: (tmpl.defaultPricingType || null) as PricingType | null,
          unitPrice: tmpl.defaultUnitPrice != null ? Number(tmpl.defaultUnitPrice) : null,
          showOnDocuments: tmpl.showOnDocuments,
        });
      }
    }
  }

  if (toCreate.length === 0) {
    return serialize({ created: 0, lineItemsCreated: 0 });
  }

  // Create all services inside a transaction (Arch fix #1)
  const maxSort = await prisma.projectService.aggregate({
    where: { projectId },
    _max: { sortOrder: true },
  });
  let sortOrder = (maxSort._max.sortOrder ?? -1) + 1;

  const createdServices = await prisma.$transaction(async (tx) => {
    const created = [];
    for (const svc of toCreate) {
      const lineTotal = svc.unitPrice != null
        ? calculateServiceLineTotal(svc.unitPrice, 1, 1, 0)
        : null;

      const service = await tx.projectService.create({
        data: {
          organizationId,
          projectId,
          type: svc.type,
          title: svc.title,
          description: svc.description,
          date: svc.date,
          endDate: svc.endDate,
          address: project.location?.address ?? null,
          latitude: project.location?.latitude ?? null,
          longitude: project.location?.longitude ?? null,
          crewCountRequired: svc.crewCountRequired,
          vehicleDescription: svc.vehicleDescription,
          pricingType: svc.pricingType,
          unitPrice: svc.unitPrice,
          lineTotal,
          showOnDocuments: svc.showOnDocuments,
          sortOrder: sortOrder++,
        },
      });
      created.push(service);
    }
    return created;
  });

  // Sync line items for services that show on documents
  let lineItemsCreated = 0;
  for (const svc of createdServices) {
    if (svc.showOnDocuments) {
      await syncServiceLineItem(svc.id);
      lineItemsCreated++;
    }
  }

  await logActivity({
    organizationId,
    userId,
    userName,
    action: "generated",
    entityType: "service",
    entityId: projectId,
    entityName: project.name,
    summary: `Generated ${createdServices.length} services for ${project.projectNumber}`,
    projectId,
  });

  return serialize({
    created: createdServices.length,
    lineItemsCreated,
  });
}

// ─── Clone Services (Phase 9 — Expansion #2) ─────────────────────────────────

export async function cloneServicesFromProject(
  targetProjectId: string,
  sourceProjectId: string,
) {
  const { organizationId, userId, userName } = await requirePermission(
    "project",
    "update",
  );

  // Verify both projects belong to the same org
  const [target, source] = await Promise.all([
    prisma.project.findFirst({
      where: { id: targetProjectId, organizationId },
      select: {
        id: true, name: true, projectNumber: true,
        loadInDate: true, loadOutDate: true, eventStartDate: true, eventEndDate: true,
      },
    }),
    prisma.project.findFirst({
      where: { id: sourceProjectId, organizationId },
      select: {
        id: true, projectNumber: true,
        loadInDate: true, loadOutDate: true, eventStartDate: true, eventEndDate: true,
      },
    }),
  ]);
  if (!target) throw new Error("Target project not found");
  if (!source) throw new Error("Source project not found");

  const sourceServices = await prisma.projectService.findMany({
    where: { projectId: sourceProjectId, status: { not: "CANCELLED" } },
    orderBy: { sortOrder: "asc" },
  });

  if (sourceServices.length === 0) {
    return serialize({ cloned: 0 });
  }

  // Calculate date offset: diff between source and target first dates
  const sourceFirstDate = source.loadInDate || source.eventStartDate;
  const targetFirstDate = target.loadInDate || target.eventStartDate;
  const dayOffset = sourceFirstDate && targetFirstDate
    ? Math.round((targetFirstDate.getTime() - sourceFirstDate.getTime()) / (1000 * 60 * 60 * 24))
    : 0;

  function offsetDate(d: Date | null): Date | null {
    if (!d || dayOffset === 0) return d;
    const result = new Date(d);
    result.setDate(result.getDate() + dayOffset);
    return result;
  }

  const maxSort = await prisma.projectService.aggregate({
    where: { projectId: targetProjectId },
    _max: { sortOrder: true },
  });
  let sortOrder = (maxSort._max.sortOrder ?? -1) + 1;

  const created = await prisma.$transaction(async (tx) => {
    const results = [];
    for (const svc of sourceServices) {
      const service = await tx.projectService.create({
        data: {
          organizationId,
          projectId: targetProjectId,
          type: svc.type,
          title: svc.title,
          description: svc.description,
          notes: svc.notes,
          date: offsetDate(svc.date),
          endDate: offsetDate(svc.endDate),
          startTime: svc.startTime,
          endTime: svc.endTime,
          scheduledTime: svc.scheduledTime,
          estimatedDuration: svc.estimatedDuration,
          address: svc.address,
          latitude: svc.latitude,
          longitude: svc.longitude,
          showOnDocuments: svc.showOnDocuments,
          billableToClient: svc.billableToClient,
          unitPrice: svc.unitPrice,
          quantity: svc.quantity,
          pricingType: svc.pricingType,
          duration: svc.duration,
          discount: svc.discount,
          lineTotal: svc.lineTotal,
          costTotal: svc.costTotal,
          taxable: svc.taxable,
          vehicleDescription: svc.vehicleDescription,
          numberOfTrips: svc.numberOfTrips,
          crewCountRequired: svc.crewCountRequired,
          crewRoleId: svc.crewRoleId,
          status: "PLANNED", // Reset status
          sortOrder: sortOrder++,
        },
      });
      results.push(service);
    }
    return results;
  });

  // Sync line items for cloned services
  for (const svc of created) {
    if (svc.showOnDocuments) {
      await syncServiceLineItem(svc.id);
    }
  }

  await logActivity({
    organizationId,
    userId,
    userName,
    action: "cloned",
    entityType: "service",
    entityId: targetProjectId,
    entityName: target.name,
    summary: `Cloned ${created.length} services from ${source.projectNumber} to ${target.projectNumber}`,
    projectId: targetProjectId,
  });

  return serialize({ cloned: created.length });
}

// ─── Convert Line Item to Service (Phase 7) ──────────────────────────────────

export async function convertLineItemToService(lineItemId: string) {
  const { organizationId, userId, userName } = await requirePermission(
    "project",
    "update",
  );

  const lineItem = await prisma.projectLineItem.findFirst({
    where: { id: lineItemId, organizationId },
    select: {
      id: true,
      projectId: true,
      type: true,
      description: true,
      quantity: true,
      unitPrice: true,
      pricingType: true,
      duration: true,
      discount: true,
      lineTotal: true,
    },
  });
  if (!lineItem) throw new Error("Line item not found");

  // Map line item type back to service type
  const typeMap: Record<string, ServiceType> = {
    TRANSPORT: "DELIVERY",
    LABOUR: "LABOUR",
    SERVICE: "MISC",
  };
  const serviceType = typeMap[lineItem.type] || "MISC";

  const maxSort = await prisma.projectService.aggregate({
    where: { projectId: lineItem.projectId },
    _max: { sortOrder: true },
  });

  const service = await prisma.$transaction(async (tx) => {
    const svc = await tx.projectService.create({
      data: {
        organizationId,
        projectId: lineItem.projectId,
        type: serviceType,
        title: lineItem.description || SERVICE_TYPE_LABELS[serviceType],
        showOnDocuments: true,
        unitPrice: lineItem.unitPrice,
        quantity: lineItem.quantity,
        pricingType: lineItem.pricingType as PricingType | null,
        duration: lineItem.duration ? Number(lineItem.duration) : null,
        discount: lineItem.discount ? Number(lineItem.discount) : null,
        lineTotal: lineItem.lineTotal ? Number(lineItem.lineTotal) : null,
        lineItemId: lineItem.id,
        sortOrder: (maxSort._max.sortOrder ?? -1) + 1,
      },
    });
    return svc;
  });

  await logActivity({
    organizationId,
    userId,
    userName,
    action: "converted",
    entityType: "service",
    entityId: service.id,
    entityName: service.title,
    summary: `Converted line item "${lineItem.description}" to ${SERVICE_TYPE_LABELS[serviceType]} service`,
    projectId: lineItem.projectId,
  });

  return serialize(service);
}

// ─── Service Cost History (Phase 12 — Expansion #6) ──────────────────────────

export async function getServiceCostHistory(
  organizationId: string,
  serviceType: ServiceType,
  limit = 10,
) {
  const { organizationId: orgId } = await getOrgContext();
  // Use authenticated org context, not the passed param
  const resolvedOrgId = orgId || organizationId;

  const history = await prisma.projectService.findMany({
    where: {
      organizationId: resolvedOrgId,
      type: serviceType,
      unitPrice: { not: null },
      status: { in: ["COMPLETED", "CONFIRMED", "IN_PROGRESS"] },
    },
    select: {
      unitPrice: true,
      pricingType: true,
      lineTotal: true,
      costTotal: true,
      date: true,
      project: { select: { projectNumber: true, name: true } },
    },
    orderBy: { date: "desc" },
    take: limit,
  });

  if (history.length === 0) {
    return serialize({ average: null, min: null, max: null, count: 0, history: [] });
  }

  const prices = history.map((h) => Number(h.unitPrice));
  const avg = prices.reduce((a, b) => a + b, 0) / prices.length;

  return serialize({
    average: roundCurrency(avg),
    min: Math.min(...prices),
    max: Math.max(...prices),
    count: history.length,
    history: history.map((h) => ({
      unitPrice: Number(h.unitPrice),
      pricingType: h.pricingType,
      lineTotal: h.lineTotal ? Number(h.lineTotal) : null,
      date: h.date,
      projectNumber: h.project.projectNumber,
      projectName: h.project.name,
    })),
  });
}

// ─── Crew Auto-Suggest (Phase 8 — Expansion #1) ─────────────────────────────

export async function getCrewSuggestionsForProject(projectId: string) {
  const { organizationId } = await getOrgContext();

  // Get equipment categories used in this project
  const projectCategories = await prisma.projectLineItem.findMany({
    where: {
      projectId,
      organizationId,
      type: "EQUIPMENT",
    },
    select: { categoryId: true },
    distinct: ["categoryId"],
  });

  const categoryIds = projectCategories
    .map((p) => p.categoryId)
    .filter((id): id is string => id != null);

  if (categoryIds.length === 0) {
    return serialize({ suggestedRoleIds: [], suggestedMembers: [] });
  }

  // Get suggested crew roles from categories
  const categories = await prisma.category.findMany({
    where: { id: { in: categoryIds } },
    select: { suggestedCrewRoles: true },
  });

  const suggestedRoleIds = [...new Set(categories.flatMap((c) => c.suggestedCrewRoles))];

  if (suggestedRoleIds.length === 0) {
    return serialize({ suggestedRoleIds: [], suggestedMembers: [] });
  }

  // Get crew members with matching roles
  const members = await prisma.crewMember.findMany({
    where: {
      organizationId,
      isActive: true,
      status: "ACTIVE",
      crewRoleId: { in: suggestedRoleIds },
    },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      image: true,
      crewRole: { select: { id: true, name: true, color: true } },
    },
    orderBy: { lastName: "asc" },
    take: 20,
  });

  return serialize({ suggestedRoleIds, suggestedMembers: members });
}

// ─── Crew Notification Message (Phase 10 — Expansion #3) ─────────────────────

export async function generateCrewMessage(
  projectId: string,
  crewMemberId: string,
) {
  const { organizationId } = await getOrgContext();

  const project = await prisma.project.findFirst({
    where: { id: projectId, organizationId },
    select: {
      name: true,
      projectNumber: true,
      location: { select: { address: true } },
      eventStartDate: true,
      eventEndDate: true,
      loadInDate: true,
      loadOutDate: true,
      siteContactName: true,
      siteContactPhone: true,
    },
  });
  if (!project) throw new Error("Project not found");

  const member = await prisma.crewMember.findFirst({
    where: { id: crewMemberId, organizationId },
    select: { firstName: true, lastName: true, email: true, phone: true },
  });
  if (!member) throw new Error("Crew member not found");

  const assignments = await prisma.crewAssignment.findMany({
    where: {
      projectId,
      crewMemberId,
      status: { notIn: ["CANCELLED", "DECLINED"] },
    },
    include: {
      service: { select: { title: true, type: true, date: true, startTime: true, endTime: true, address: true } },
      crewRole: { select: { name: true } },
    },
    orderBy: { startDate: "asc" },
  });

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
    crewMemberPhone: member.phone,
    crewMemberEmail: member.email,
  });
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
    select: { showOnDocuments: true, lineTotal: true, costTotal: true },
  });

  let chargeTotal = 0; // What we charge clients (lineTotal)
  let costTotal = 0;   // What it costs us (costTotal)

  for (const s of services) {
    chargeTotal += s.lineTotal ? Number(s.lineTotal) : 0;
    costTotal += s.costTotal ? Number(s.costTotal) : 0;
  }

  return serialize({
    chargeTotal: roundCurrency(chargeTotal),
    costTotal: roundCurrency(costTotal),
    // Legacy compatibility
    totalCost: roundCurrency(costTotal),
    onDocumentsTotal: roundCurrency(chargeTotal),
    internalTotal: roundCurrency(costTotal),
    serviceCount: services.length,
  });
}
