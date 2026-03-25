"use server";

import { prisma } from "@/lib/prisma";
import { getOrgContext, requirePermission } from "@/lib/org-context";
import {
  projectSchema,
  type ProjectFormValues,
} from "@/lib/validations/project";
import type { Prisma, ProjectStatus } from "@/generated/prisma/client";
import { serialize } from "@/lib/serialize";
import { computeOverbookedStatus } from "@/lib/availability";
import { recalculateProjectTotals } from "@/server/line-items";
import { logActivity } from "@/lib/activity-log";
import { buildFilterWhere, type FilterValue, type FilterColumnDef } from "@/lib/table-utils";

const projectFilterColumns: FilterColumnDef[] = [
  { id: "status", filterType: "enum" },
  { id: "type", filterType: "enum" },
];

async function generateTemplateCode(organizationId: string): Promise<string> {
  const count = await prisma.project.count({
    where: { organizationId, isTemplate: true },
  });
  let code = `TPL-${String(count + 1).padStart(4, "0")}`;
  // Ensure uniqueness
  const existing = await prisma.project.findFirst({
    where: { organizationId, projectNumber: code },
  });
  if (existing) {
    code = `TPL-${String(count + 2).padStart(4, "0")}`;
  }
  return code;
}

export async function getProjects(params?: {
  search?: string;
  status?: string;
  type?: string;
  clientId?: string;
  rentalStartDate?: string;
  rentalEndDate?: string;
  page?: number;
  pageSize?: number;
  includeLineItems?: boolean;
  sortBy?: string;
  sortOrder?: "asc" | "desc";
  filters?: Record<string, FilterValue>;
}) {
  const { organizationId } = await getOrgContext();
  const {
    search,
    status,
    type,
    clientId,
    rentalStartDate,
    rentalEndDate,
    page = 1,
    pageSize = 25,
    includeLineItems = false,
    sortBy = "createdAt",
    sortOrder = "desc",
    filters,
  } = params || {};

  // Build filter where from DataTable filters
  const filterWhere = buildFilterWhere(filters, projectFilterColumns);

  const where: Prisma.ProjectWhereInput = {
    organizationId,
    isTemplate: false,
    ...(status && {
      status: status as Prisma.EnumProjectStatusFilter,
    }),
    ...(type && {
      type: type as Prisma.EnumProjectTypeFilter,
    }),
    ...(clientId && { clientId }),
    ...(search && {
      OR: [
        { name: { contains: search, mode: "insensitive" } },
        { projectNumber: { contains: search, mode: "insensitive" } },
        { location: { name: { contains: search, mode: "insensitive" } } },
      ],
    }),
    ...(rentalStartDate && {
      rentalStartDate: { gte: new Date(rentalStartDate) },
    }),
    ...(rentalEndDate && {
      rentalEndDate: { lte: new Date(rentalEndDate) },
    }),
    ...filterWhere,
  };

  const [projects, total] = await Promise.all([
    prisma.project.findMany({
      where,
      include: {
        client: true,
        location: true,
        ...(includeLineItems && {
          lineItems: {
            where: { status: { not: "CANCELLED" }, type: "EQUIPMENT" },
            select: { id: true, status: true, type: true, isKitChild: true },
          },
        }),
      },
      orderBy: sortBy === "client" ? { client: { name: sortOrder } }
        : { [sortBy]: sortOrder },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.project.count({ where }),
  ]);

  return serialize({
    projects,
    total,
    page,
    pageSize,
    totalPages: Math.ceil(total / pageSize),
  });
}

/**
 * For a list of project IDs, returns which ones have overbooked or reduced-stock issues.
 * Only computes for projects in active statuses (not completed/cancelled/etc).
 */
export async function getProjectIssueFlags(projectIds: string[]) {
  const { organizationId } = await getOrgContext();
  if (projectIds.length === 0) return {} as Record<string, { hasOverbooked: boolean; hasReducedStock: boolean }>;

  // Only compute for active projects
  const activeStatuses: ProjectStatus[] = ["ENQUIRY", "QUOTING", "QUOTED", "CONFIRMED", "PREPPING", "CHECKED_OUT", "ON_SITE"];
  const projects = await prisma.project.findMany({
    where: { id: { in: projectIds }, organizationId, status: { in: activeStatuses } },
    select: { id: true, rentalStartDate: true, rentalEndDate: true },
  });

  if (projects.length === 0) return {} as Record<string, { hasOverbooked: boolean; hasReducedStock: boolean }>;

  const activeIds = projects.map((p) => p.id);

  // Batch fetch all line items across all active projects
  const allLineItems = await prisma.projectLineItem.findMany({
    where: {
      organizationId,
      projectId: { in: activeIds },
      status: { not: "CANCELLED" },
    },
    select: {
      id: true, projectId: true, modelId: true, quantity: true,
      isKitChild: true, parentLineItemId: true, kitId: true, status: true,
    },
  });

  const result: Record<string, { hasOverbooked: boolean; hasReducedStock: boolean }> = {};

  // Compute per project
  for (const project of projects) {
    const items = allLineItems.filter((li) => li.projectId === project.id);
    if (items.length === 0) continue;

    const overbookedMap = await computeOverbookedStatus(
      organizationId, items, project.rentalStartDate, project.rentalEndDate, project.id,
    );

    if (overbookedMap.size === 0) continue;

    let hasOverbooked = false;
    let hasReducedStock = false;
    for (const info of overbookedMap.values()) {
      if (info.reducedOnly) hasReducedStock = true;
      else hasOverbooked = true;
    }
    result[project.id] = { hasOverbooked, hasReducedStock };
  }

  return result;
}

export async function getProject(id: string) {
  const { organizationId } = await getOrgContext();
  const project = await prisma.project.findUnique({
    where: { id, organizationId },
    include: {
      client: true,
      location: { include: { parent: true } },
      lineItems: {
        include: {
          model: true,
          asset: true,
          bulkAsset: true,
          kit: true,
          supplier: true,
          childLineItems: {
            include: {
              model: true, asset: true, bulkAsset: true, kit: true,
              childLineItems: {
                include: { model: true, asset: true, bulkAsset: true },
                orderBy: { sortOrder: "asc" },
              },
            },
            orderBy: { sortOrder: "asc" },
          },
        },
        orderBy: { sortOrder: "asc" },
      },
      media: {
        include: { file: true },
        orderBy: { sortOrder: "asc" },
      },
    },
  });
  if (!project) return null;

  // Inherit address/coordinates from parent location if child has none
  if (project.location?.parentId) {
    const loc = project.location;
    const parent = loc.parent;
    if (parent) {
      if (!loc.address) loc.address = parent.address;
      if (loc.latitude == null && loc.longitude == null && parent.latitude != null) {
        loc.latitude = parent.latitude;
        loc.longitude = parent.longitude;
      }
    }
  }

  const overbookedMap = await computeOverbookedStatus(
    organizationId,
    project.lineItems,
    project.rentalStartDate,
    project.rentalEndDate,
    project.id,
  );

  const enrichedLineItems = project.lineItems.map((li) => {
    const info = overbookedMap.get(li.id);
    return {
      ...li,
      isOverbooked: !!info,
      overbookedInfo: info ?? null,
      childLineItems: li.childLineItems?.map((child) => {
        const childInfo = overbookedMap.get(child.id);
        return {
          ...child,
          isOverbooked: !!childInfo,
          overbookedInfo: childInfo ?? null,
        };
      }),
    };
  });

  return serialize({ ...project, lineItems: enrichedLineItems });
}

export async function createProject(data: ProjectFormValues & { isTemplate?: boolean }) {
  const { organizationId, userId, userName } = await requirePermission("project", "create");
  const parsed = projectSchema.parse(data);

  const isTemplate = data.isTemplate ?? false;

  if (!isTemplate && !parsed.projectNumber) {
    throw new Error("Project code is required");
  }

  const projectNumber = isTemplate && !parsed.projectNumber
    ? await generateTemplateCode(organizationId)
    : parsed.projectNumber!;

  try {
    const result = await prisma.project.create({
      data: {
        organizationId,
        isTemplate,
        projectNumber,
        name: parsed.name,
        clientId: parsed.clientId || null,
        status: parsed.status,
        type: parsed.type,
        description: parsed.description || null,
        locationId: parsed.locationId || null,
        siteContactName: parsed.siteContactName || null,
        siteContactPhone: parsed.siteContactPhone || null,
        siteContactEmail: parsed.siteContactEmail || null,
        loadInDate: parsed.loadInDate ?? null,
        loadInTime: parsed.loadInTime || null,
        eventStartDate: parsed.eventStartDate ?? null,
        eventStartTime: parsed.eventStartTime || null,
        eventEndDate: parsed.eventEndDate ?? null,
        eventEndTime: parsed.eventEndTime || null,
        loadOutDate: parsed.loadOutDate ?? null,
        loadOutTime: parsed.loadOutTime || null,
        rentalStartDate: parsed.rentalStartDate ?? null,
        rentalEndDate: parsed.rentalEndDate ?? null,
        crewNotes: parsed.crewNotes || null,
        internalNotes: parsed.internalNotes || null,
        clientNotes: parsed.clientNotes || null,
        discountPercent: parsed.discountPercent ?? null,
        depositPercent: parsed.depositPercent ?? null,
        depositPaid: parsed.depositPaid ?? null,
        invoicedTotal: parsed.invoicedTotal ?? null,
        tags: parsed.tags,
      },
    });

    await logActivity({
      organizationId,
      userId,
      userName,
      action: "CREATE",
      entityType: "project",
      entityId: result.id,
      entityName: result.projectNumber,
      summary: `Created ${isTemplate ? "template" : "project"} ${result.projectNumber} - ${result.name}`,
      projectId: result.id,
    });

    return serialize(result);
  } catch (e: unknown) {
    if (e instanceof Error && e.message.includes("Unique constraint")) {
      throw new Error(`Project code "${parsed.projectNumber}" already exists`);
    }
    throw e;
  }
}

export async function updateProject(id: string, data: ProjectFormValues) {
  const { organizationId, userId, userName } = await requirePermission("project", "update");
  const parsed = projectSchema.parse(data);

  const updated = await prisma.project.update({
    where: { id, organizationId },
    data: {
      projectNumber: parsed.projectNumber,
      name: parsed.name,
      clientId: parsed.clientId || null,
      status: parsed.status,
      type: parsed.type,
      description: parsed.description || null,
      locationId: parsed.locationId || null,
      siteContactName: parsed.siteContactName || null,
      siteContactPhone: parsed.siteContactPhone || null,
      siteContactEmail: parsed.siteContactEmail || null,
      loadInDate: parsed.loadInDate ?? null,
      loadInTime: parsed.loadInTime || null,
      eventStartDate: parsed.eventStartDate ?? null,
      eventStartTime: parsed.eventStartTime || null,
      eventEndDate: parsed.eventEndDate ?? null,
      eventEndTime: parsed.eventEndTime || null,
      loadOutDate: parsed.loadOutDate ?? null,
      loadOutTime: parsed.loadOutTime || null,
      rentalStartDate: parsed.rentalStartDate ?? null,
      rentalEndDate: parsed.rentalEndDate ?? null,
      crewNotes: parsed.crewNotes || null,
      internalNotes: parsed.internalNotes || null,
      clientNotes: parsed.clientNotes || null,
      discountPercent: parsed.discountPercent ?? null,
      depositPercent: parsed.depositPercent ?? null,
      depositPaid: parsed.depositPaid ?? null,
      invoicedTotal: parsed.invoicedTotal ?? null,
      tags: parsed.tags,
    },
  });

  await logActivity({
    organizationId,
    userId,
    userName,
    action: "UPDATE",
    entityType: "project",
    entityId: updated.id,
    entityName: updated.projectNumber,
    summary: `Updated project ${updated.projectNumber} - ${updated.name}`,
    projectId: updated.id,
  });

  return serialize(updated);
}

export async function updateProjectStatus(
  id: string,
  status: ProjectFormValues["status"]
) {
  const { organizationId, userId, userName } = await requirePermission("project", "update");
  const project = await prisma.project.findUnique({ where: { id, organizationId } });
  if (!project) throw new Error("Project not found");
  if (project.isTemplate) throw new Error("Cannot change status of a template");
  const updated = await prisma.project.update({
    where: { id, organizationId },
    data: { status },
  });

  await logActivity({
    organizationId,
    userId,
    userName,
    action: "STATUS_CHANGE",
    entityType: "project",
    entityId: updated.id,
    entityName: updated.projectNumber,
    summary: `Changed project ${updated.projectNumber} status from ${project.status} to ${status}`,
    details: { changes: [{ field: "status", from: project.status, to: status }] },
    projectId: updated.id,
  });

  return serialize(updated);
}

export async function updateProjectNotes(
  id: string,
  field: "crewNotes" | "internalNotes" | "clientNotes",
  notes: string,
) {
  const { organizationId } = await requirePermission("project", "update");
  return serialize(await prisma.project.update({
    where: { id, organizationId },
    data: { [field]: notes || null },
  }));
}

export async function archiveProject(id: string) {
  const { organizationId } = await requirePermission("project", "update");
  return serialize(
    await prisma.project.update({
      where: { id, organizationId },
      data: { status: "CANCELLED" },
    })
  );
}

export async function duplicateProject(sourceId: string, newProjectNumber: string, newName: string) {
  const { organizationId } = await requirePermission("project", "create");

  const source = await prisma.project.findUnique({
    where: { id: sourceId, organizationId },
    include: {
      lineItems: {
        where: { isKitChild: false },
        include: {
          childLineItems: true,
        },
        orderBy: { sortOrder: "asc" },
      },
    },
  });

  if (!source) throw new Error("Project not found");

  try {
    const result = await prisma.$transaction(async (tx) => {
      const newProject = await tx.project.create({
        data: {
          organizationId,
          projectNumber: newProjectNumber,
          name: newName,
          clientId: source.clientId,
          status: "ENQUIRY",
          type: source.type,
          description: source.description,
          locationId: source.locationId,
          siteContactName: source.siteContactName,
          siteContactPhone: source.siteContactPhone,
          siteContactEmail: source.siteContactEmail,
          crewNotes: source.crewNotes,
          internalNotes: source.internalNotes,
          clientNotes: source.clientNotes,
          discountPercent: source.discountPercent,
          depositPercent: source.depositPercent,
          tags: source.tags,
          isTemplate: false,
        },
      });

      // Copy line items (parent items first, then children)
      for (const li of source.lineItems) {
        const parentItem = await tx.projectLineItem.create({
          data: {
            organizationId,
            projectId: newProject.id,
            type: li.type,
            modelId: li.modelId,
            bulkAssetId: li.bulkAssetId,
            kitId: li.kitId,
            supplierId: li.supplierId,
            description: li.description,
            quantity: li.quantity,
            unitPrice: li.unitPrice,
            pricingType: li.pricingType,
            duration: li.duration,
            discount: li.discount,
            lineTotal: li.lineTotal,
            sortOrder: li.sortOrder,
            groupName: li.groupName,
            notes: li.notes,
            isOptional: li.isOptional,
            isSubhire: li.isSubhire,
            showSubhireOnDocs: li.showSubhireOnDocs,
            isKitChild: false,
            pricingMode: li.pricingMode,
            status: "QUOTED",
          },
        });

        // Copy child line items (kit children)
        if (li.childLineItems?.length) {
          for (const child of li.childLineItems) {
            await tx.projectLineItem.create({
              data: {
                organizationId,
                projectId: newProject.id,
                type: child.type,
                modelId: child.modelId,
                bulkAssetId: child.bulkAssetId,
                description: child.description,
                quantity: child.quantity,
                unitPrice: child.unitPrice,
                pricingType: child.pricingType,
                duration: child.duration,
                discount: child.discount,
                lineTotal: child.lineTotal,
                sortOrder: child.sortOrder,
                groupName: child.groupName,
                notes: child.notes,
                isKitChild: true,
                parentLineItemId: parentItem.id,
                status: "QUOTED",
              },
            });
          }
        }
      }

      return newProject;
    });

    // Recalculate totals after transaction commits
    await recalculateProjectTotals(result.id);

    return serialize(result);
  } catch (e: unknown) {
    if (e instanceof Error && e.message.includes("Unique constraint")) {
      throw new Error(`Project code "${newProjectNumber}" already exists`);
    }
    throw e;
  }
}

export async function saveAsTemplate(projectId: string, templateName: string) {
  const { organizationId } = await requirePermission("project", "create");

  const source = await prisma.project.findUnique({
    where: { id: projectId, organizationId },
    include: {
      lineItems: {
        where: { isKitChild: false },
        include: { childLineItems: true },
        orderBy: { sortOrder: "asc" },
      },
    },
  });

  if (!source) throw new Error("Project not found");

  const templateNumber = await generateTemplateCode(organizationId);

  try {
    const result = await prisma.$transaction(async (tx) => {
      const template = await tx.project.create({
        data: {
          organizationId,
          projectNumber: templateNumber,
          name: templateName,
          clientId: source.clientId,
          status: "ENQUIRY",
          type: source.type,
          description: source.description,
          locationId: source.locationId,
          siteContactName: source.siteContactName,
          siteContactPhone: source.siteContactPhone,
          siteContactEmail: source.siteContactEmail,
          crewNotes: source.crewNotes,
          internalNotes: source.internalNotes,
          clientNotes: source.clientNotes,
          discountPercent: source.discountPercent,
          depositPercent: source.depositPercent,
          tags: source.tags,
          isTemplate: true,
        },
      });

      for (const li of source.lineItems) {
        const parentItem = await tx.projectLineItem.create({
          data: {
            organizationId,
            projectId: template.id,
            type: li.type,
            modelId: li.modelId,
            bulkAssetId: li.bulkAssetId,
            kitId: li.kitId,
            supplierId: li.supplierId,
            description: li.description,
            quantity: li.quantity,
            unitPrice: li.unitPrice,
            pricingType: li.pricingType,
            duration: li.duration,
            discount: li.discount,
            lineTotal: li.lineTotal,
            sortOrder: li.sortOrder,
            groupName: li.groupName,
            notes: li.notes,
            isOptional: li.isOptional,
            isSubhire: li.isSubhire,
            showSubhireOnDocs: li.showSubhireOnDocs,
            isKitChild: false,
            pricingMode: li.pricingMode,
            status: "QUOTED",
          },
        });

        if (li.childLineItems?.length) {
          for (const child of li.childLineItems) {
            await tx.projectLineItem.create({
              data: {
                organizationId,
                projectId: template.id,
                type: child.type,
                modelId: child.modelId,
                bulkAssetId: child.bulkAssetId,
                description: child.description,
                quantity: child.quantity,
                unitPrice: child.unitPrice,
                pricingType: child.pricingType,
                duration: child.duration,
                discount: child.discount,
                lineTotal: child.lineTotal,
                sortOrder: child.sortOrder,
                groupName: child.groupName,
                notes: child.notes,
                isKitChild: true,
                parentLineItemId: parentItem.id,
                status: "QUOTED",
              },
            });
          }
        }
      }

      return template;
    });

    // Recalculate totals after transaction commits
    await recalculateProjectTotals(result.id);

    return serialize(result);
  } catch (e: unknown) {
    if (e instanceof Error && e.message.includes("Unique constraint")) {
      throw new Error("Template code conflict, please try again");
    }
    throw e;
  }
}

export async function getTemplates() {
  const { organizationId } = await getOrgContext();

  const templates = await prisma.project.findMany({
    where: { organizationId, isTemplate: true },
    include: {
      client: true,
      location: true,
      _count: { select: { lineItems: { where: { isKitChild: false } } } },
    },
    orderBy: { updatedAt: "desc" },
  });

  return serialize(templates);
}

export async function deleteTemplate(id: string) {
  const { organizationId } = await requirePermission("project", "delete");

  const template = await prisma.project.findUnique({
    where: { id, organizationId },
  });
  if (!template) throw new Error("Template not found");
  if (!template.isTemplate) throw new Error("This is not a template");

  await prisma.project.delete({ where: { id, organizationId } });
  return { success: true };
}

export async function deleteProject(id: string) {
  const { organizationId, userId, userName } = await requirePermission("project", "delete");

  // Only allow deleting cancelled projects
  const project = await prisma.project.findUnique({
    where: { id, organizationId },
    include: {
      lineItems: {
        select: {
          id: true,
          assetId: true,
          kitId: true,
          status: true,
          kit: { select: { id: true } },
        },
      },
    },
  });

  if (!project) throw new Error("Project not found");
  if (project.status !== "CANCELLED") throw new Error("Only cancelled projects can be deleted");

  // Collect IDs to reset
  const checkedOutAssetIds: string[] = [];
  const checkedOutKitIds: string[] = [];

  for (const li of project.lineItems) {
    if (li.assetId && (li.status === "CHECKED_OUT" || li.status === "CONFIRMED")) {
      checkedOutAssetIds.push(li.assetId);
    }
    if (li.kitId && (li.status === "CHECKED_OUT" || li.status === "CONFIRMED")) {
      checkedOutKitIds.push(li.kitId);
    }
  }

  // Get org default location
  const defaultLocation = await prisma.location.findFirst({
    where: { organizationId, isDefault: true },
    select: { id: true },
  });

  await prisma.$transaction(async (tx) => {
    // Reset checked-out assets to AVAILABLE
    if (checkedOutAssetIds.length > 0) {
      await tx.asset.updateMany({
        where: { id: { in: checkedOutAssetIds }, organizationId },
        data: {
          status: "AVAILABLE",
          locationId: defaultLocation?.id ?? null,
        },
      });
    }

    // Reset checked-out kits and their contents to AVAILABLE
    if (checkedOutKitIds.length > 0) {
      await tx.kit.updateMany({
        where: { id: { in: checkedOutKitIds }, organizationId },
        data: {
          status: "AVAILABLE",
          locationId: defaultLocation?.id ?? null,
        },
      });
      // Reset serialized assets inside those kits
      const kitAssets = await tx.kitSerializedItem.findMany({
        where: { kitId: { in: checkedOutKitIds } },
        select: { assetId: true },
      });
      if (kitAssets.length > 0) {
        await tx.asset.updateMany({
          where: { id: { in: kitAssets.map((ka) => ka.assetId) }, organizationId },
          data: {
            status: "AVAILABLE",
            locationId: defaultLocation?.id ?? null,
          },
        });
      }
    }

    // Delete the project (cascades to line items, media, etc.)
    await tx.project.delete({ where: { id, organizationId } });
  });

  await logActivity({
    organizationId,
    userId,
    userName,
    action: "DELETE",
    entityType: "project",
    entityId: id,
    entityName: project.projectNumber,
    summary: `Deleted project ${project.projectNumber} - ${project.name}`,
    details: {
      deleted: { projectNumber: project.projectNumber, name: project.name },
      freedAssets: checkedOutAssetIds.length,
      freedKits: checkedOutKitIds.length,
    },
  });
}
