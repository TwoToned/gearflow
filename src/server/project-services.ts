"use server";

import { getOrgContext, requirePermission } from "@/lib/org-context";
import { serialize } from "@/lib/serialize";
import {
  projectServiceSchema,
  serviceTemplateSchema,
  type ProjectServiceFormValues,
  type ServiceTemplateFormValues,
} from "@/lib/validations/project-service";
import { logActivity } from "@/lib/activity-log";
import { getConvexClient } from "@/lib/convex-client";
import { api } from "../../convex/_generated/api";
import { createId } from "@paralleldrive/cuid2";
import { roundCurrency } from "@/lib/formatters";
import { getCategoriesByOrg } from "@/lib/categories-read";
import {
  mapServiceTemplate,
  getProjectServicesFromConvex,
  getProjectServiceByIdFromConvex,
  getServiceTemplatesFromConvex,
  getProjectServicesSummaryFromConvex,
} from "@/lib/project-service-read";
import { getProjectById } from "@/lib/projects-read";
import { getProjectServicesByOrg } from "@/lib/project-services-read";
import { getLocationById } from "@/lib/locations-read";
import { getCrewRoleMap, getCrewMemberMap, getCrewMembersByOrg, getCrewMemberById } from "@/lib/crew-read";
import {
  getAssignmentsByProject,
  compareAscNullsLast,
} from "@/lib/crew-scheduling-read";
import { sendCrewOffer } from "@/server/crew-communication";
import { recalculateProjectTotals } from "@/server/line-items";
import { SERVICE_TYPE_LABELS } from "@/lib/constants/services";
import type { ServiceType, PricingType, ProjectPhase } from "@/generated/prisma/client";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function calculateServiceLineTotal(
  unitPrice: number | undefined,
  discount: number | undefined,
): number | null {
  if (unitPrice == null || unitPrice === 0) return null;
  const disc = discount ?? 0;
  return Math.max(0, roundCurrency(unitPrice - disc));
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
  let serviceEndDate = parsed.endDate ? new Date(parsed.endDate as unknown as string) : serviceDate;
  // Only BUMP_IN / BUMP_OUT / LABOUR services can span multiple days (mirrors
  // `canBeMultiDay` in services-panel.tsx). For every other type the end date
  // MUST track the start date — otherwise editing just the start date leaves a
  // stale endDate behind and silently turns a 1-day service into a 2-day span
  // (reported: "changing date forward turned it into a 2-day service", and the
  // date "not fully changing everywhere").
  const MULTI_DAY_TYPES = new Set(["BUMP_IN", "BUMP_OUT", "LABOUR"]);
  if (!MULTI_DAY_TYPES.has(String(parsed.type))) {
    serviceEndDate = serviceDate;
  }
  // An end date before the start also renders as a multi-day span — clamp it.
  if (serviceDate && serviceEndDate && serviceEndDate.getTime() < serviceDate.getTime()) {
    serviceEndDate = serviceDate;
  }
  const lineTotal = calculateServiceLineTotal(
    parsed.unitPrice,
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
  const services = await getProjectServicesFromConvex(organizationId, projectId);
  return serialize(services);
}

export async function getProjectServiceById(id: string) {
  const { organizationId } = await getOrgContext();
  const service = await getProjectServiceByIdFromConvex(organizationId, id);
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

  const project = await getProjectById(projectId);
  if (!project || project.organizationId !== organizationId) {
    throw new Error("Project not found");
  }

  const { fields, serviceDate, serviceEndDate } = buildServiceData(parsed);

  // projectService is Convex-only now (Phase C). Compute sortOrder = max+1 from the
  // project's existing Convex services, mint a cuid, and write directly.
  const convexForCreate = await getConvexClient();
  const existingForProject = (await getProjectServicesByOrg(organizationId)).filter(
    (s) => s.projectId === projectId,
  );
  const maxSort = existingForProject.reduce((m, s) => Math.max(m, s.sortOrder ?? 0), -1);
  const serviceId = createId();
  const nowCreate = Date.now();
  await convexForCreate.mutation(api.projectServices.create, {
    id: serviceId,
    organizationId,
    projectId,
    type: fields.type,
    title: fields.title,
    ...(fields.description != null ? { description: fields.description } : {}),
    ...(fields.notes != null ? { notes: fields.notes } : {}),
    ...(serviceDate ? { date: serviceDate.getTime() } : {}),
    ...(serviceEndDate ? { endDate: serviceEndDate.getTime() } : {}),
    ...(fields.startTime != null ? { startTime: fields.startTime } : {}),
    ...(fields.endTime != null ? { endTime: fields.endTime } : {}),
    ...(fields.scheduledTime != null ? { scheduledTime: fields.scheduledTime } : {}),
    ...(fields.estimatedDuration != null ? { estimatedDuration: fields.estimatedDuration } : {}),
    ...(fields.address != null ? { address: fields.address } : {}),
    ...(fields.latitude != null ? { latitude: fields.latitude } : {}),
    ...(fields.longitude != null ? { longitude: fields.longitude } : {}),
    showOnDocuments: fields.showOnDocuments,
    ...(fields.unitPrice != null ? { unitPrice: fields.unitPrice } : {}),
    quantity: fields.quantity,
    ...(fields.pricingType != null ? { pricingType: fields.pricingType } : {}),
    ...(fields.duration != null ? { duration: fields.duration } : {}),
    ...(fields.discount != null ? { discount: fields.discount } : {}),
    ...(fields.lineTotal != null ? { lineTotal: fields.lineTotal } : {}),
    ...(fields.costTotal != null ? { costTotal: fields.costTotal } : {}),
    taxable: fields.taxable,
    ...(fields.vehicleDescription != null ? { vehicleDescription: fields.vehicleDescription } : {}),
    ...(fields.numberOfTrips != null ? { numberOfTrips: fields.numberOfTrips } : {}),
    ...(fields.crewCountRequired != null ? { crewCountRequired: fields.crewCountRequired } : {}),
    ...(fields.crewRoleId != null ? { crewRoleId: fields.crewRoleId } : {}),
    sortOrder: maxSort + 1,
    createdAt: nowCreate,
    updatedAt: nowCreate,
  });
  const service = await getProjectServiceByIdFromConvex(organizationId, serviceId);

  // Crew assignments (Convex-only) — created after the service write, with the
  // partial-unique (projectId, crewMemberId, serviceId) invariant enforced in Convex.
  if (parsed.crewMemberIds && parsed.crewMemberIds.length > 0) {
    const phase = serviceTypeToPhase(parsed.type);
    const { crewStart, crewEnd } = deriveCrewTimes(
      parsed.startTime,
      parsed.endTime,
      parsed.scheduledTime,
      parsed.type,
    );
    const convex = await getConvexClient();
    const now = Date.now();
    for (const crewMemberId of parsed.crewMemberIds) {
      await convex.mutation(api.crewAssignments.createServiceAssignment, {
        id: createId(),
        organizationId,
        projectId,
        crewMemberId,
        serviceId: service.id,
        phase,
        status: "PENDING",
        ...(parsed.crewRoleId ? { crewRoleId: parsed.crewRoleId } : {}),
        ...(serviceDate ? { startDate: serviceDate.getTime() } : {}),
        ...(crewStart ? { startTime: crewStart } : {}),
        ...(serviceEndDate ? { endDate: serviceEndDate.getTime() } : {}),
        ...(crewEnd ? { endTime: crewEnd } : {}),
        createdAt: now,
        updatedAt: now,
      });
    }
  }

  // Always recalculate project totals — service charge/cost affects financials
  await recalculateProjectTotals(projectId);

  await logActivity({
    organizationId,
    userId,
    userName,
    action: "created",
    entityType: "service",
    entityId: service.id,
    entityName: service.title,
    summary: `Created ${SERVICE_TYPE_LABELS[service.type as ServiceType]} service "${service.title}"`,
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

  // projectService is Convex-only now (Phase C) — read the existing service there.
  const existing = await getProjectServiceByIdFromConvex(organizationId, id).catch(() => null);
  if (!existing) throw new Error("Service not found");

  const { fields, serviceDate, serviceEndDate } = buildServiceData(parsed);

  // Patch the service in Convex. Date/endDate can be cleared to null when the form
  // omits them; lineItemId/crewRoleId likewise clear-to-null when not set.
  const convexForUpdate = await getConvexClient();
  const updateSet: Record<string, unknown> = {
    type: fields.type,
    title: fields.title,
    showOnDocuments: fields.showOnDocuments,
    quantity: fields.quantity,
    taxable: fields.taxable,
    updatedAt: Date.now(),
  };
  const updateClear: string[] = [];
  const setOrClear = (key: string, value: unknown, asDate = false) => {
    if (value == null) updateClear.push(key);
    else updateSet[key] = asDate ? (value as Date).getTime() : value;
  };
  setOrClear("description", fields.description);
  setOrClear("notes", fields.notes);
  setOrClear("date", serviceDate, true);
  setOrClear("endDate", serviceEndDate, true);
  setOrClear("startTime", fields.startTime);
  setOrClear("endTime", fields.endTime);
  setOrClear("scheduledTime", fields.scheduledTime);
  setOrClear("estimatedDuration", fields.estimatedDuration);
  setOrClear("address", fields.address);
  setOrClear("latitude", fields.latitude);
  setOrClear("longitude", fields.longitude);
  setOrClear("unitPrice", fields.unitPrice);
  setOrClear("pricingType", fields.pricingType);
  setOrClear("duration", fields.duration);
  setOrClear("discount", fields.discount);
  setOrClear("lineTotal", fields.lineTotal);
  setOrClear("costTotal", fields.costTotal);
  setOrClear("vehicleDescription", fields.vehicleDescription);
  setOrClear("numberOfTrips", fields.numberOfTrips);
  setOrClear("crewCountRequired", fields.crewCountRequired);
  setOrClear("crewRoleId", fields.crewRoleId);
  await convexForUpdate.mutation(api.projectServices.patchService, {
    id,
    set: updateSet,
    clear: updateClear,
  });

  // Clean up any legacy linked line item (Convex-only — cascade delete the line).
  if (existing.lineItemId) {
    await convexForUpdate
      .mutation(api.projectLineItems.removeLineItemCascade, { id: existing.lineItemId })
      .catch(() => {});
    await convexForUpdate.mutation(api.projectServices.patchService, {
      id,
      set: {},
      clear: ["lineItemId"],
    });
  }
  const service = await getProjectServiceByIdFromConvex(organizationId, id);

  // Reconcile the service's crew assignments (Convex-only): remove de-selected
  // members (cascade their shifts/time-entries), add newly-selected, and patch the
  // role on survivors when it changed. Partial-unique enforced in createServiceAssignment.
  if (parsed.crewMemberIds != null) {
    const convex = await getConvexClient();
    const phase = serviceTypeToPhase(parsed.type);
    const existingAssignments = (await getAssignmentsByProject(existing.projectId, organizationId)).filter(
      (a) => a.serviceId === id,
    );
    const existingMemberIds = new Set(existingAssignments.map((a) => a.crewMemberId));
    const desiredMemberIds = new Set(parsed.crewMemberIds);

    for (const a of existingAssignments.filter((a) => !desiredMemberIds.has(a.crewMemberId))) {
      await convex.mutation(api.crewAssignments.deleteCascade, { id: a.id });
    }

    const { crewStart, crewEnd } = deriveCrewTimes(
      parsed.startTime,
      parsed.endTime,
      parsed.scheduledTime,
      parsed.type,
    );
    const now = Date.now();
    for (const crewMemberId of parsed.crewMemberIds.filter((m) => !existingMemberIds.has(m))) {
      await convex.mutation(api.crewAssignments.createServiceAssignment, {
        id: createId(),
        organizationId,
        projectId: existing.projectId,
        crewMemberId,
        serviceId: id,
        phase,
        status: "PENDING",
        ...(parsed.crewRoleId ? { crewRoleId: parsed.crewRoleId } : {}),
        ...(serviceDate ? { startDate: serviceDate.getTime() } : {}),
        ...(crewStart ? { startTime: crewStart } : {}),
        ...(serviceEndDate ? { endDate: serviceEndDate.getTime() } : {}),
        ...(crewEnd ? { endTime: crewEnd } : {}),
        createdAt: now,
        updatedAt: now,
      });
    }

    if (parsed.crewRoleId !== existing.crewRoleId) {
      for (const a of existingAssignments.filter((a) => desiredMemberIds.has(a.crewMemberId))) {
        await convex.mutation(api.crewAssignments.patchAssignment, {
          id: a.id,
          set: parsed.crewRoleId ? { crewRoleId: parsed.crewRoleId } : {},
          clear: parsed.crewRoleId ? [] : ["crewRoleId"],
        });
      }
    }
  }

  // Always recalculate project totals — service charge/cost affects financials
  await recalculateProjectTotals(existing.projectId);

  await logActivity({
    organizationId,
    userId,
    userName,
    action: "updated",
    entityType: "service",
    entityId: service.id,
    entityName: service.title,
    summary: `Updated ${SERVICE_TYPE_LABELS[service.type as ServiceType]} service "${service.title}"`,
    projectId: existing.projectId,
  });

  return serialize(service);
}

export async function deleteProjectService(id: string) {
  const { organizationId, userId, userName } = await requirePermission(
    "project",
    "update",
  );

  // projectService is Convex-only now (Phase C) — read it there.
  const service = await getProjectServiceByIdFromConvex(organizationId, id).catch(() => null);
  if (!service) throw new Error("Service not found");

  // The service's crew assignments (Convex-only) — captured before the delete so
  // their cascade (shifts + linked time-entries) can be removed from Convex after.
  const convex = await getConvexClient();
  const serviceAssignments = (await getAssignmentsByProject(service.projectId, organizationId)).filter(
    (a) => a.serviceId === id,
  );

  // The line item is Convex-only (Phase C) — cascade-delete it after unlinking, then
  // remove the service itself from Convex.
  if (service.lineItemId) {
    await convex
      .mutation(api.projectServices.patchService, { id, set: {}, clear: ["lineItemId"] });
    await convex
      .mutation(api.projectLineItems.removeLineItemCascade, { id: service.lineItemId })
      .catch(() => {});
  }
  await convex.mutation(api.projectServices.remove, { id });
  for (const a of serviceAssignments) {
    await convex.mutation(api.crewAssignments.deleteCascade, { id: a.id });
  }

  await recalculateProjectTotals(service.projectId);

  await logActivity({
    organizationId,
    userId,
    userName,
    action: "deleted",
    entityType: "service",
    entityId: id,
    entityName: service.title,
    summary: `Deleted ${SERVICE_TYPE_LABELS[service.type as ServiceType]} service "${service.title}"`,
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

  // projectService is Convex-only now (Phase C).
  const service = await getProjectServiceByIdFromConvex(organizationId, id).catch(() => null);
  if (!service) throw new Error("Service not found");

  const convex = await getConvexClient();
  await convex.mutation(api.projectServices.patchService, {
    id,
    set: { status, updatedAt: Date.now() },
  });
  const updated = await getProjectServiceByIdFromConvex(organizationId, id);

  await recalculateProjectTotals(service.projectId);

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

/**
 * Bulk-delete services in a single server round-trip. Mirrors deleteProjectService
 * per item (unlink + cascade the synthetic line item, remove the service, cascade
 * its crew assignments), then recalcs each affected project ONCE and writes ONE
 * bulk audit. Missing/foreign services are skipped and reported.
 */
export async function bulkDeleteProjectServices(ids: string[]) {
  const { organizationId, userId, userName } = await requirePermission(
    "project",
    "update",
  );
  if (ids.length === 0) return serialize({ deleted: 0, skipped: 0 });

  const convex = await getConvexClient();
  // ONE backend-local pass: the full per-service cascade (synthetic line item +
  // its crew assignments + the service) runs inside a single Convex mutation.
  const { deleted, skipped, projectIds } = await convex.mutation(
    api.projectServices.removeManyCascade,
    { ids, orgId: organizationId },
  );

  await Promise.all(projectIds.map((pid: string) => recalculateProjectTotals(pid)));

  if (deleted > 0) {
    await logActivity({
      organizationId,
      userId,
      userName,
      action: "bulk_deleted",
      entityType: "service",
      entityId: ids[0],
      entityName: `${deleted} service${deleted === 1 ? "" : "s"}`,
      summary: `Deleted ${deleted} service${deleted === 1 ? "" : "s"}`,
      projectId: projectIds[0],
    });
  }

  return serialize({ deleted, skipped });
}

export async function bulkUpdateServiceStatus(
  ids: string[],
  status: "PLANNED" | "CONFIRMED" | "IN_PROGRESS" | "COMPLETED" | "CANCELLED",
) {
  const { organizationId, userId, userName } = await requirePermission(
    "project",
    "update",
  );

  if (ids.length === 0) return;

  const convex = await getConvexClient();
  // ONE backend-local pass instead of one patch round-trip per service.
  const { updated, projectIds } = await convex.mutation(
    api.projectServices.patchManyStatus,
    { ids, orgId: organizationId, status, now: Date.now() },
  );

  await Promise.all(projectIds.map((pid: string) => recalculateProjectTotals(pid)));

  if (updated > 0) {
    await logActivity({
      organizationId,
      userId,
      userName,
      action: "bulk_status_changed",
      entityType: "service",
      entityId: ids[0],
      entityName: `${updated} services`,
      summary: `Changed ${updated} services to ${status}`,
      projectId: projectIds[0],
    });
  }
}

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
    for (const a of targets) {
      await convex.mutation(api.crewAssignments.patchAssignment, { id: a.id, set: { status } });
    }
    updatedCount = targets.length;
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

  const convexProject = await getProjectById(projectId);
  if (!convexProject || convexProject.organizationId !== organizationId) {
    throw new Error("Project not found");
  }
  const convexLocation = convexProject.locationId
    ? await getLocationById(convexProject.locationId)
    : null;
  const project = {
    id: convexProject.id,
    name: convexProject.name,
    projectNumber: convexProject.projectNumber,
    loadInDate: convexProject.loadInDate != null ? new Date(convexProject.loadInDate) : null,
    loadOutDate: convexProject.loadOutDate != null ? new Date(convexProject.loadOutDate) : null,
    eventStartDate: convexProject.eventStartDate != null ? new Date(convexProject.eventStartDate) : null,
    eventEndDate: convexProject.eventEndDate != null ? new Date(convexProject.eventEndDate) : null,
    location: convexLocation
      ? {
          address: convexLocation.address ?? null,
          latitude: convexLocation.latitude ?? null,
          longitude: convexLocation.longitude ?? null,
        }
      : null,
  };

  // Need at least one date to generate
  if (!project.loadInDate && !project.loadOutDate && !project.eventStartDate) {
    throw new Error("Project must have at least one date (load in, load out, or event start) to generate services");
  }

  // Get auto-added templates + all active templates as fallback. Service
  // templates are Convex-only (this file writes them to Convex); the Prisma
  // table is frozen, so read + map from Convex (defaults for optional fields).
  const convex = await getConvexClient();
  const rawTemplates = await convex.query(api.serviceTemplates.list, { orgId: organizationId });
  const templates = rawTemplates
    .filter((t) => t.isActive ?? true)
    .map((t) => ({
      type: t.type,
      title: t.title,
      description: t.description ?? null,
      defaultCrewCount: t.defaultCrewCount ?? null,
      defaultVehicle: t.defaultVehicle ?? null,
      defaultPricingType: t.defaultPricingType ?? null,
      defaultUnitPrice: t.defaultUnitPrice ?? null,
      showOnDocuments: t.showOnDocuments ?? false,
      isAutoAdded: t.isAutoAdded ?? false,
      sortOrder: t.sortOrder ?? 0,
    }))
    .sort((a, b) => a.sortOrder - b.sortOrder);

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
  // Get existing services to avoid duplicates (idempotent re-run). projectService is
  // Convex-only now (Phase C) — read the project's services from Convex.
  const existingServices = (await getProjectServicesByOrg(organizationId)).filter(
    (s) => s.projectId === projectId,
  );

  const existingKey = new Set(
    existingServices.map((s) =>
      `${s.type}:${s.date != null ? new Date(s.date).toISOString().slice(0, 10) : "null"}`
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

  // Create all services in Convex (projectService is Convex-only — Phase C).
  // sortOrder = max+1 computed from the project's existing Convex services.
  const maxSort = existingServices.reduce((m, s) => Math.max(m, s.sortOrder ?? 0), -1);
  let sortOrder = maxSort + 1;

  const convex = await getConvexClient();
  const createdServices: { id: string }[] = [];
  for (const svc of toCreate) {
    const lineTotal = svc.unitPrice != null
      ? calculateServiceLineTotal(svc.unitPrice, 0)
      : null;

    const id = createId();
    const now = Date.now();
    await convex.mutation(api.projectServices.create, {
      id,
      organizationId,
      projectId,
      type: svc.type,
      title: svc.title,
      ...(svc.description != null ? { description: svc.description } : {}),
      ...(svc.date ? { date: svc.date.getTime() } : {}),
      ...(svc.endDate ? { endDate: svc.endDate.getTime() } : {}),
      ...(project.location?.address != null ? { address: project.location.address } : {}),
      ...(project.location?.latitude != null ? { latitude: project.location.latitude } : {}),
      ...(project.location?.longitude != null ? { longitude: project.location.longitude } : {}),
      ...(svc.crewCountRequired != null ? { crewCountRequired: svc.crewCountRequired } : {}),
      ...(svc.vehicleDescription != null ? { vehicleDescription: svc.vehicleDescription } : {}),
      ...(svc.pricingType != null ? { pricingType: svc.pricingType } : {}),
      ...(svc.unitPrice != null ? { unitPrice: svc.unitPrice } : {}),
      ...(lineTotal != null ? { lineTotal } : {}),
      showOnDocuments: svc.showOnDocuments,
      sortOrder: sortOrder++,
      createdAt: now,
      updatedAt: now,
    });
    createdServices.push({ id });
  }

  // Sync line items for services that show on documents
  await recalculateProjectTotals(projectId);

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
  const [convexTarget, convexSource] = await Promise.all([
    getProjectById(targetProjectId),
    getProjectById(sourceProjectId),
  ]);
  if (!convexTarget || convexTarget.organizationId !== organizationId) {
    throw new Error("Target project not found");
  }
  if (!convexSource || convexSource.organizationId !== organizationId) {
    throw new Error("Source project not found");
  }
  const target = {
    id: convexTarget.id,
    name: convexTarget.name,
    projectNumber: convexTarget.projectNumber,
    loadInDate: convexTarget.loadInDate != null ? new Date(convexTarget.loadInDate) : null,
    eventStartDate: convexTarget.eventStartDate != null ? new Date(convexTarget.eventStartDate) : null,
  };
  const source = {
    id: convexSource.id,
    projectNumber: convexSource.projectNumber,
    loadInDate: convexSource.loadInDate != null ? new Date(convexSource.loadInDate) : null,
    eventStartDate: convexSource.eventStartDate != null ? new Date(convexSource.eventStartDate) : null,
  };

  // projectService is Convex-only now (Phase C) — read the source project's services,
  // replicate the Prisma where (status != CANCELLED) + orderBy sortOrder asc. Use the
  // mapped by-project helper (epoch-ms → Date) so the clone-create date math works.
  const sourceServicesRaw = (await getProjectServicesFromConvex(organizationId, sourceProjectId))
    .filter((s) => s.status !== "CANCELLED")
    .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));

  // Crew assignments live in Convex — group the source project's by serviceId.
  const sourceAssignmentsByService = new Map<string, Awaited<ReturnType<typeof getAssignmentsByProject>>>();
  for (const a of await getAssignmentsByProject(sourceProjectId, organizationId)) {
    if (!a.serviceId) continue;
    const arr = sourceAssignmentsByService.get(a.serviceId) ?? [];
    arr.push(a);
    sourceAssignmentsByService.set(a.serviceId, arr);
  }
  const sourceServices = sourceServicesRaw.map((svc) => ({
    ...svc,
    crewAssignments: sourceAssignmentsByService.get(svc.id) ?? [],
  }));

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

  // sortOrder = max+1 computed from the target project's existing Convex services.
  const targetServices = (await getProjectServicesByOrg(organizationId)).filter(
    (s) => s.projectId === targetProjectId,
  );
  let sortOrder = targetServices.reduce((m, s) => Math.max(m, s.sortOrder ?? 0), -1) + 1;

  const clonedCrew: { newServiceId: string; source: Awaited<ReturnType<typeof getAssignmentsByProject>> }[] = [];
  const cloneCreateConvex = await getConvexClient();
  const created: { id: string }[] = [];
  for (const svc of sourceServices) {
    const id = createId();
    const now = Date.now();
    const clonedDate = offsetDate(svc.date);
    const clonedEndDate = offsetDate(svc.endDate);
    await cloneCreateConvex.mutation(api.projectServices.create, {
      id,
      organizationId,
      projectId: targetProjectId,
      type: svc.type as ServiceType,
      title: svc.title,
      ...(svc.description != null ? { description: svc.description } : {}),
      ...(svc.notes != null ? { notes: svc.notes } : {}),
      ...(clonedDate ? { date: clonedDate.getTime() } : {}),
      ...(clonedEndDate ? { endDate: clonedEndDate.getTime() } : {}),
      ...(svc.startTime != null ? { startTime: svc.startTime } : {}),
      ...(svc.endTime != null ? { endTime: svc.endTime } : {}),
      ...(svc.scheduledTime != null ? { scheduledTime: svc.scheduledTime } : {}),
      ...(svc.estimatedDuration != null ? { estimatedDuration: svc.estimatedDuration } : {}),
      ...(svc.address != null ? { address: svc.address } : {}),
      ...(svc.latitude != null ? { latitude: svc.latitude } : {}),
      ...(svc.longitude != null ? { longitude: svc.longitude } : {}),
      showOnDocuments: svc.showOnDocuments,
      ...(svc.unitPrice != null ? { unitPrice: svc.unitPrice } : {}),
      quantity: svc.quantity,
      ...(svc.pricingType != null ? { pricingType: svc.pricingType as PricingType } : {}),
      ...(svc.duration != null ? { duration: svc.duration } : {}),
      ...(svc.discount != null ? { discount: svc.discount } : {}),
      ...(svc.lineTotal != null ? { lineTotal: svc.lineTotal } : {}),
      ...(svc.costTotal != null ? { costTotal: svc.costTotal } : {}),
      taxable: svc.taxable,
      ...(svc.vehicleDescription != null ? { vehicleDescription: svc.vehicleDescription } : {}),
      ...(svc.numberOfTrips != null ? { numberOfTrips: svc.numberOfTrips } : {}),
      ...(svc.crewCountRequired != null ? { crewCountRequired: svc.crewCountRequired } : {}),
      ...(svc.crewRoleId != null ? { crewRoleId: svc.crewRoleId } : {}),
      status: "PLANNED", // Reset status
      sortOrder: sortOrder++,
      createdAt: now,
      updatedAt: now,
    });

    // Defer crew-assignment clone to Convex.
    clonedCrew.push({ newServiceId: id, source: svc.crewAssignments });

    created.push({ id });
  }

  // Clone crew assignments (Convex-only) for every cloned service, partial-unique
  // enforced. Dates offset to the target project's timeline.
  const cloneConvex = await getConvexClient();
  const cloneNow = Date.now();
  for (const { newServiceId, source: sourceAssignments } of clonedCrew) {
    for (const a of sourceAssignments) {
      const startDate = offsetDate(a.startDate);
      const endDate = offsetDate(a.endDate);
      await cloneConvex.mutation(api.crewAssignments.createServiceAssignment, {
        id: createId(),
        organizationId,
        projectId: targetProjectId,
        crewMemberId: a.crewMemberId,
        serviceId: newServiceId,
        status: "PENDING",
        ...(a.crewRoleId ? { crewRoleId: a.crewRoleId } : {}),
        ...(a.phase ? { phase: a.phase as ProjectPhase } : {}),
        ...(startDate ? { startDate: startDate.getTime() } : {}),
        ...(a.startTime ? { startTime: a.startTime } : {}),
        ...(endDate ? { endDate: endDate.getTime() } : {}),
        ...(a.endTime ? { endTime: a.endTime } : {}),
        createdAt: cloneNow,
        updatedAt: cloneNow,
      });
    }
  }

  await recalculateProjectTotals(targetProjectId);

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

  const convexForRead = await getConvexClient();
  const lineItemDoc = await convexForRead.query(api.projectLineItems.getById, { id: lineItemId });
  if (!lineItemDoc || lineItemDoc.organizationId !== organizationId) {
    throw new Error("Line item not found");
  }
  const lineItem = {
    id: lineItemDoc.id,
    projectId: lineItemDoc.projectId,
    type: lineItemDoc.type ?? "EQUIPMENT",
    description: lineItemDoc.description ?? null,
    quantity: lineItemDoc.quantity ?? 1,
    unitPrice: lineItemDoc.unitPrice ?? null,
    pricingType: lineItemDoc.pricingType ?? null,
    duration: lineItemDoc.duration ?? null,
    discount: lineItemDoc.discount ?? null,
    lineTotal: lineItemDoc.lineTotal ?? null,
  };

  // Map line item type back to service type
  const typeMap: Record<string, ServiceType> = {
    TRANSPORT: "DELIVERY",
    LABOUR: "LABOUR",
    SERVICE: "MISC",
  };
  const serviceType = typeMap[lineItem.type] || "MISC";

  // projectService is Convex-only now (Phase C). sortOrder = max+1 from the project's
  // existing Convex services; mint a cuid and write directly.
  const convex = await getConvexClient();
  const existingForProject = (await getProjectServicesByOrg(organizationId)).filter(
    (s) => s.projectId === lineItem.projectId,
  );
  const maxSort = existingForProject.reduce((m, s) => Math.max(m, s.sortOrder ?? 0), -1);
  const serviceId = createId();
  const now = Date.now();
  const convertedPricingType = (lineItem.pricingType && String(lineItem.pricingType) !== ""
    ? lineItem.pricingType
    : null) as PricingType | null;
  await convex.mutation(api.projectServices.create, {
    id: serviceId,
    organizationId,
    projectId: lineItem.projectId,
    type: serviceType,
    title: lineItem.description || SERVICE_TYPE_LABELS[serviceType],
    showOnDocuments: true,
    ...(lineItem.unitPrice != null ? { unitPrice: lineItem.unitPrice } : {}),
    quantity: lineItem.quantity,
    ...(convertedPricingType ? { pricingType: convertedPricingType } : {}),
    ...(lineItem.duration ? { duration: Number(lineItem.duration) } : {}),
    ...(lineItem.discount ? { discount: Number(lineItem.discount) } : {}),
    ...(lineItem.lineTotal ? { lineTotal: Number(lineItem.lineTotal) } : {}),
    lineItemId: lineItem.id,
    sortOrder: maxSort + 1,
    createdAt: now,
    updatedAt: now,
  });
  const service = await getProjectServiceByIdFromConvex(organizationId, serviceId);

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

  // projectService + project are dual-written to Convex. Read the org's services,
  // replicate the Prisma where (type === serviceType, unitPrice != null, status in
  // [COMPLETED, CONFIRMED, IN_PROGRESS]) + orderBy date desc + take(limit) in JS,
  // and resolve each service's project (projectNumber / name) from a Convex map.
  const STATUSES = new Set(["COMPLETED", "CONFIRMED", "IN_PROGRESS"]);
  const allServices = await getProjectServicesByOrg(resolvedOrgId);
  const matched = allServices
    .filter(
      (s) =>
        s.type === serviceType &&
        s.unitPrice != null &&
        s.status != null &&
        STATUSES.has(s.status),
    )
    .sort((a, b) => (b.date ?? 0) - (a.date ?? 0))
    .slice(0, limit);

  if (matched.length === 0) {
    return serialize({ average: null, min: null, max: null, count: 0, history: [] });
  }

  const projectIds = [...new Set(matched.map((s) => s.projectId))];
  const projectRows = await Promise.all(projectIds.map((pid) => getProjectById(pid)));
  const projectMap = new Map(
    projectRows.flatMap((p) => (p ? [[p.id, p] as const] : [])),
  );

  const prices = matched.map((h) => Number(h.unitPrice));
  const avg = prices.reduce((a, b) => a + b, 0) / prices.length;

  return serialize({
    average: roundCurrency(avg),
    min: Math.min(...prices),
    max: Math.max(...prices),
    count: matched.length,
    history: matched.map((h) => {
      const project = projectMap.get(h.projectId);
      return {
        unitPrice: Number(h.unitPrice),
        pricingType: h.pricingType,
        lineTotal: h.lineTotal != null ? Number(h.lineTotal) : null,
        date: h.date != null ? new Date(h.date) : null,
        projectNumber: project?.projectNumber ?? "",
        projectName: project?.name ?? "",
      };
    }),
  });
}

// ─── Crew Auto-Suggest (Phase 8 — Expansion #1) ─────────────────────────────

export async function getCrewSuggestionsForProject(projectId: string) {
  const { organizationId } = await getOrgContext();

  // Get equipment categories used in this project (line items are Convex-only).
  const convexForRead = await getConvexClient();
  const projectLines = await convexForRead.query(api.projectLineItems.listByProject, {
    projectId,
    orgId: organizationId,
  });

  const categoryIds = [
    ...new Set(
      projectLines
        .filter((li) => li.type === "EQUIPMENT" && li.categoryId != null)
        .map((li) => li.categoryId as string),
    ),
  ];

  if (categoryIds.length === 0) {
    return serialize({ suggestedRoleIds: [], suggestedMembers: [] });
  }

  // Get suggested crew roles from categories (Convex read)
  const allCategories = await getCategoriesByOrg(organizationId);
  const categorySet = new Set(categoryIds);
  const suggestedRoleIds = [
    ...new Set(allCategories.filter((c) => categorySet.has(c.id)).flatMap((c) => c.suggestedCrewRoles ?? [])),
  ];

  if (suggestedRoleIds.length === 0) {
    return serialize({ suggestedRoleIds: [], suggestedMembers: [] });
  }

  // Get crew members with matching roles (crew_member / crew_role are Convex-only).
  // Replicates the Prisma where (active + status ACTIVE + crewRoleId in roles),
  // orderBy lastName asc, take 20, with the nested crewRole attached from the map.
  const roleIdSet = new Set(suggestedRoleIds);
  const [allMembers, roleMap] = await Promise.all([
    getCrewMembersByOrg(organizationId),
    getCrewRoleMap(organizationId),
  ]);
  const members = allMembers
    .filter(
      (m) =>
        (m.isActive ?? true) &&
        (m.status ?? "ACTIVE") === "ACTIVE" &&
        m.crewRoleId != null &&
        roleIdSet.has(m.crewRoleId),
    )
    .sort((a, b) => a.lastName.localeCompare(b.lastName))
    .slice(0, 20)
    .map((m) => {
      const role = m.crewRoleId ? roleMap.get(m.crewRoleId) ?? null : null;
      return {
        id: m.id,
        firstName: m.firstName,
        lastName: m.lastName,
        image: m.image ?? null,
        crewRole: role ? { id: role.id, name: role.name, color: role.color ?? null } : null,
      };
    });

  return serialize({ suggestedRoleIds, suggestedMembers: members });
}

// ─── Crew Notification Message (Phase 10 — Expansion #3) ─────────────────────

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

// ─── Service Templates ────────────────────────────────────────────────────────

export async function getServiceTemplates() {
  const { organizationId } = await getOrgContext();
  const templates = await getServiceTemplatesFromConvex(organizationId);
  return serialize(templates);
}

export async function createServiceTemplate(data: ServiceTemplateFormValues) {
  const { organizationId, userId, userName } = await requirePermission(
    "orgSettings",
    "update",
  );
  const parsed = serviceTemplateSchema.parse(data);

  const convex = await getConvexClient();
  const existing = await convex.query(api.serviceTemplates.list, { orgId: organizationId });
  const maxSort = existing.reduce((m, t) => Math.max(m, t.sortOrder ?? 0), -1);

  const id = createId();
  const now = Date.now();
  const defaultPricingType = (parsed.defaultPricingType && String(parsed.defaultPricingType) !== ""
    ? parsed.defaultPricingType
    : null) as PricingType | null;

  await convex.mutation(api.serviceTemplates.create, {
    id,
    organizationId,
    type: parsed.type,
    title: parsed.title,
    ...(parsed.description ? { description: parsed.description } : {}),
    ...(parsed.defaultCrewCount ? { defaultCrewCount: parsed.defaultCrewCount } : {}),
    ...(parsed.defaultVehicle ? { defaultVehicle: parsed.defaultVehicle } : {}),
    ...(defaultPricingType ? { defaultPricingType } : {}),
    ...(parsed.defaultUnitPrice != null ? { defaultUnitPrice: Number(parsed.defaultUnitPrice) } : {}),
    showOnDocuments: parsed.showOnDocuments,
    isAutoAdded: parsed.isAutoAdded,
    isActive: parsed.isActive,
    sortOrder: maxSort + 1,
    createdAt: now,
    updatedAt: now,
  });
  const raw = await convex.query(api.serviceTemplates.getById, { id });
  const template = raw ? mapServiceTemplate(raw) : null;

  await logActivity({
    organizationId,
    userId,
    userName,
    action: "created",
    entityType: "serviceTemplate",
    entityId: id,
    entityName: parsed.title,
    summary: `Created service template "${parsed.title}"`,
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

  const convex = await getConvexClient();
  const existingDoc = await convex.query(api.serviceTemplates.getById, { id });
  if (!existingDoc || existingDoc.organizationId !== organizationId) throw new Error("Template not found");

  const now = Date.now();
  const defaultPricingType = (parsed.defaultPricingType && String(parsed.defaultPricingType) !== ""
    ? parsed.defaultPricingType
    : null) as PricingType | null;

  await convex.mutation(api.serviceTemplates.replaceForOrg, {
    id,
    organizationId,
    type: parsed.type,
    title: parsed.title,
    ...(parsed.description ? { description: parsed.description } : {}),
    ...(parsed.defaultCrewCount ? { defaultCrewCount: parsed.defaultCrewCount } : {}),
    ...(parsed.defaultVehicle ? { defaultVehicle: parsed.defaultVehicle } : {}),
    ...(defaultPricingType ? { defaultPricingType } : {}),
    ...(parsed.defaultUnitPrice != null ? { defaultUnitPrice: Number(parsed.defaultUnitPrice) } : {}),
    showOnDocuments: parsed.showOnDocuments,
    isAutoAdded: parsed.isAutoAdded,
    isActive: parsed.isActive,
    sortOrder: existingDoc.sortOrder ?? 0,
    now,
  });
  const raw = await convex.query(api.serviceTemplates.getById, { id });
  const template = raw ? mapServiceTemplate(raw) : null;

  await logActivity({
    organizationId,
    userId,
    userName,
    action: "updated",
    entityType: "serviceTemplate",
    entityId: id,
    entityName: parsed.title,
    summary: `Updated service template "${parsed.title}"`,
  });

  return serialize(template);
}

export async function deleteServiceTemplate(id: string) {
  const { organizationId, userId, userName } = await requirePermission(
    "orgSettings",
    "update",
  );

  const convex = await getConvexClient();
  const template = await convex.query(api.serviceTemplates.getById, { id });
  if (!template || template.organizationId !== organizationId) throw new Error("Template not found");

  await convex.mutation(api.serviceTemplates.remove, { id });

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
