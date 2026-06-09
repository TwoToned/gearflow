"use server";

import { prisma } from "@/lib/prisma";
import { getOrgContext, requirePermission } from "@/lib/org-context";
import { getClientById, getClientMap, attachClient } from "@/lib/clients-read";
import {
  projectSchema,
  type ProjectFormValues,
} from "@/lib/validations/project";
import type { Prisma, ProjectStatus } from "@/generated/prisma/client";
import { serialize } from "@/lib/serialize";
import { computeOverbookedStatus } from "@/lib/availability";
import { recalculateProjectTotals } from "@/server/line-items";
import { logActivity } from "@/lib/activity-log";
import { syncKitsToConvex } from "@/lib/kit-mirror";
import { syncAssetsToConvex } from "@/lib/asset-mirror";
import { mirrorProjectCategoryCreate, mirrorProjectGroupCreate } from "@/lib/project-grouping-mirror";
import { upsertProjectLineItemsToConvex, removeLineItemFromConvex } from "@/lib/line-item-mirror";
import { mirrorProjectCreate, patchProjectInConvex, removeProjectFromConvex } from "@/lib/project-mirror";
import { emitIfDiscordEnabled } from "@/lib/services/outbox-service";
import { buildFilterWhere, type FilterValue, type FilterColumnDef } from "@/lib/table-utils";
import { translatePrismaError, UserFacingError } from "@/lib/errors";
import { createId } from "@paralleldrive/cuid2";
import {
  renderProjectNumber,
  scopeKeyFor,
  datePartsInTimezone,
  hasIncrementToken,
  DEFAULT_INCREMENT_RESET,
  DEFAULT_INCREMENT_PADDING,
  type IncrementReset,
} from "@/lib/project-number";

/** Resolved auto project-number config, or null when auto-numbering is off. */
type ProjectNumberConfig = {
  format: string;
  reset: IncrementReset;
  padding: number;
  timezone?: string;
};

/** Parse the org's auto project-number config from its settings metadata JSON. */
function readProjectNumberConfig(metadata: string | null): ProjectNumberConfig | null {
  if (!metadata) return null;
  try {
    const s = JSON.parse(metadata) as Record<string, unknown>;
    const format = typeof s.projectNumberFormat === "string" ? s.projectNumberFormat.trim() : "";
    // Treat a missing OR invalid format (no increment token) as "disabled" so
    // blank creates fall back to the required-manual-code path rather than the
    // auto path, where a token-less format would render the same code every time
    // and collide-retry until failure.
    if (!format || !hasIncrementToken(format)) return null;
    const reset = (s.projectNumberIncrementReset as IncrementReset) || DEFAULT_INCREMENT_RESET;
    const padding =
      typeof s.projectNumberIncrementPadding === "number"
        ? s.projectNumberIncrementPadding
        : DEFAULT_INCREMENT_PADDING;
    const timezone = typeof s.timezone === "string" ? s.timezone : undefined;
    return { format, reset, padding, timezone };
  } catch {
    return null;
  }
}

/**
 * Atomically allocate the next auto project number inside a transaction. The
 * sequence counter is bumped with INSERT ... ON CONFLICT (race-free across
 * concurrent project creation); if the rendered number collides with an
 * existing (e.g. manually-entered) one, we bump again. Returns the number.
 */
async function generateProjectNumber(
  tx: Prisma.TransactionClient,
  organizationId: string,
  config: ProjectNumberConfig,
  now: Date,
): Promise<string> {
  const parts = datePartsInTimezone(now, config.timezone);
  const scopeKey = scopeKeyFor(config.reset, parts);

  for (let attempt = 0; attempt < 50; attempt++) {
    const rows = await tx.$queryRaw<{ value: number }[]>`
      INSERT INTO "project_number_sequence" ("id", "organizationId", "scopeKey", "value", "updatedAt")
      VALUES (${createId()}, ${organizationId}, ${scopeKey}, 1, NOW())
      ON CONFLICT ("organizationId", "scopeKey")
      DO UPDATE SET "value" = "project_number_sequence"."value" + 1, "updatedAt" = NOW()
      RETURNING "value"
    `;
    const sequence = Number(rows[0]?.value ?? 1);
    const number = renderProjectNumber(config.format, { parts, sequence, padding: config.padding });
    const clash = await tx.project.findFirst({
      where: { organizationId, projectNumber: number },
      select: { id: true },
    });
    if (!clash) return number;
  }
  throw new Error("Could not generate a unique project number");
}

/**
 * Preview the next auto project number WITHOUT incrementing the counter. Powers
 * the settings live preview. Pass `override` to preview unsaved form values
 * (e.g. while the user types a new format); omit it to preview the saved config.
 * Returns null when auto-numbering is disabled / format is empty.
 */
export async function peekNextProjectNumber(override?: {
  format?: string;
  reset?: IncrementReset;
  padding?: number;
}): Promise<string | null> {
  const { organizationId } = await getOrgContext();
  const org = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: { metadata: true },
  });
  let config = readProjectNumberConfig(org?.metadata ?? null);

  if (override?.format !== undefined) {
    const fmt = override.format.trim();
    config = fmt && hasIncrementToken(fmt)
      ? {
          format: fmt,
          reset: override.reset ?? config?.reset ?? DEFAULT_INCREMENT_RESET,
          padding: override.padding ?? config?.padding ?? DEFAULT_INCREMENT_PADDING,
          timezone: config?.timezone,
        }
      : null;
  }
  if (!config) return null;

  const parts = datePartsInTimezone(new Date(), config.timezone);
  const scopeKey = scopeKeyFor(config.reset, parts);
  const seqRow = await prisma.projectNumberSequence.findUnique({
    where: { organizationId_scopeKey: { organizationId, scopeKey } },
    select: { value: true },
  });
  const nextSeq = (seqRow?.value ?? 0) + 1;
  return renderProjectNumber(config.format, { parts, sequence: nextSeq, padding: config.padding });
}

const projectFilterColumns: FilterColumnDef[] = [
  { id: "status", filterType: "enum" },
  { id: "type", filterType: "enum" },
];

/**
 * Per-unit fulfillment rows to thread through every line-item include
 * on `getProject`. The project view's equipment tab uses these to show
 * each physical asset assigned to a multi-quantity line (post-cutover
 * `line.asset` is null for those — the assignments live on units).
 * CANCELLED units are filtered out at the query layer.
 */
const PROJECT_UNIT_INCLUDE = {
  orderBy: { ordinal: "asc" as const },
  where: { status: { not: "CANCELLED" as const } },
  include: {
    asset: { select: { id: true, assetTag: true } },
    bulkAsset: { select: { id: true, assetTag: true } },
  },
} as const;

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

  // Clients live in Convex (no Prisma join). Sorting by client name therefore
  // can't happen in the DB — when sortBy === "client" we fetch all matching
  // projects, attach clients, then sort + paginate in JS. Other sorts keep DB
  // pagination and just attach clients to the page.
  const sortByClient = sortBy === "client";
  const [projectsRaw, total] = await Promise.all([
    prisma.project.findMany({
      where,
      include: {
        location: true,
        ...(includeLineItems && {
          lineItems: {
            where: { status: { not: "CANCELLED" }, type: "EQUIPMENT" },
            select: { id: true, status: true, type: true, isKitChild: true },
          },
        }),
      },
      ...(sortByClient
        ? {}
        : { orderBy: { [sortBy]: sortOrder }, skip: (page - 1) * pageSize, take: pageSize }),
    }),
    prisma.project.count({ where }),
  ]);

  const clientMap = await getClientMap(organizationId);
  let projects = projectsRaw.map((p) => ({
    ...p,
    client: p.clientId ? clientMap.get(p.clientId) ?? null : null,
  }));

  if (sortByClient) {
    const dir = sortOrder === "desc" ? -1 : 1;
    projects.sort(
      (a, b) =>
        (a.client?.name ?? "").localeCompare(b.client?.name ?? "", undefined, { sensitivity: "base" }) * dir,
    );
    projects = projects.slice((page - 1) * pageSize, page * pageSize);
  }

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
      location: { include: { parent: true } },
      projectManagers: {
        include: {
          user: { select: { id: true, name: true, email: true, image: true } },
        },
        orderBy: { addedAt: "asc" },
      },
      categories: {
        include: {
          groups: {
            include: {
              lineItems: {
                // Hide merge tombstones (status CANCELLED, qty 0) left by
                // the split-collapse migrations. Normal removal hard-deletes,
                // so CANCELLED line items are only ever inert merge residue.
                where: { status: { not: "CANCELLED" } },
                include: {
                  model: true, asset: true, bulkAsset: true, kit: true,
                  units: PROJECT_UNIT_INCLUDE,
                  childLineItems: {
                    include: {
                      model: true, asset: true, bulkAsset: true, kit: true,
                      units: PROJECT_UNIT_INCLUDE,
                    },
                    orderBy: { sortOrder: "asc" },
                  },
                },
                orderBy: { sortOrder: "asc" },
              },
            },
            orderBy: { sortOrder: "asc" },
          },
          lineItems: {
            where: { groupId: null, status: { not: "CANCELLED" } },
            include: {
              model: true, asset: true, bulkAsset: true, kit: true,
              units: PROJECT_UNIT_INCLUDE,
              childLineItems: {
                include: {
                  model: true, asset: true, bulkAsset: true, kit: true,
                  units: PROJECT_UNIT_INCLUDE,
                },
                orderBy: { sortOrder: "asc" },
              },
            },
            orderBy: { sortOrder: "asc" },
          },
        },
        orderBy: { sortOrder: "asc" },
      },
      lineItems: {
        where: { status: { not: "CANCELLED" } },
        include: {
          model: true,
          asset: true,
          bulkAsset: true,
          kit: true,
          supplier: true,
          units: PROJECT_UNIT_INCLUDE,
          childLineItems: {
            include: {
              model: true, asset: true, bulkAsset: true, kit: true,
              units: PROJECT_UNIT_INCLUDE,
              childLineItems: {
                include: {
                  model: true, asset: true, bulkAsset: true,
                  units: PROJECT_UNIT_INCLUDE,
                },
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

  // Clients live in Convex — attach instead of a Prisma join.
  const client = project.clientId ? await getClientById(project.clientId) : null;
  return serialize({ ...project, client, lineItems: enrichedLineItems });
}

export async function createProject(data: ProjectFormValues & { isTemplate?: boolean }) {
  const { organizationId, userId, userName } = await requirePermission("project", "create");
  const parsed = projectSchema.parse(data);

  const isTemplate = data.isTemplate ?? false;

  // Auto project-number config (null when the org hasn't enabled it).
  const org = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: { metadata: true },
  });
  const autoConfig = readProjectNumberConfig(org?.metadata ?? null);
  const useAutoNumber = !isTemplate && !parsed.projectNumber && !!autoConfig;

  if (!isTemplate && !parsed.projectNumber && !useAutoNumber) {
    throw new UserFacingError({
      code: "MISSING_PROJECT_CODE",
      title: "Project code is required",
      message: "Enter a project code (e.g. P-2024-001) before saving.",
      field: "projectNumber",
    });
  }

  // Templates without an explicit code get a template code (pre-txn is fine —
  // no shared counter). Auto project numbers are allocated INSIDE the txn so
  // the sequence bump and the create commit (or roll back) together.
  const templateNumber =
    isTemplate && !parsed.projectNumber ? await generateTemplateCode(organizationId) : null;

  try {
    const result = await prisma.$transaction(async (tx) => {
      const projectNumber = useAutoNumber
        ? await generateProjectNumber(tx, organizationId, autoConfig!, new Date())
        : (templateNumber ?? parsed.projectNumber!);
      const project = await tx.project.create({
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
        defaultRentalPeriod: parsed.defaultRentalPeriod || null,
        defaultRentalQuantity: parsed.defaultRentalQuantity || null,
        billingWeeks: parsed.billingWeeks ?? null,
        billingDays: parsed.billingDays ?? null,
        taxRate: parsed.taxRate ?? null,
        discountPercent: parsed.discountPercent ?? null,
        depositPercent: parsed.depositPercent ?? null,
        depositPaid: parsed.depositPaid ?? null,
        invoicedTotal: parsed.invoicedTotal ?? null,
        tags: parsed.tags,
      },
      });

      // Transactional outbox: a Discord channel-sync event that rolls back with
      // the project if the txn fails. Templates never get a channel.
      if (!isTemplate) {
        await emitIfDiscordEnabled(tx, {
          organizationId,
          eventType: "project.created",
          payload: {
            projectId: project.id,
            projectNumber: project.projectNumber,
            name: project.name,
            status: project.status,
          },
          dedupeKey: `project.created:${project.id}`,
        });
      }

      return project;
    });
    await mirrorProjectCreate(result);

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
    const translated = translatePrismaError(e);
    if (translated) throw translated;
    throw e;
  }
}

export async function updateProject(id: string, data: ProjectFormValues) {
  const { organizationId, userId, userName } = await requirePermission("project", "update");
  const parsed = projectSchema.parse(data);

  // Read the prior status so a project-form save that flips status emits the
  // same outbox event as updateProjectStatus would.
  const before = await prisma.project.findUnique({
    where: { id, organizationId },
    select: { status: true, isTemplate: true },
  });

  const updated = await prisma.$transaction(async (tx) => {
    const result = await tx.project.update({
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
      defaultRentalPeriod: parsed.defaultRentalPeriod || null,
      defaultRentalQuantity: parsed.defaultRentalQuantity || null,
      billingWeeks: parsed.billingWeeks ?? null,
      billingDays: parsed.billingDays ?? null,
      taxRate: parsed.taxRate ?? null,
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

    if (before && !before.isTemplate && before.status !== parsed.status) {
      await emitIfDiscordEnabled(tx, {
        organizationId,
        eventType: "project.status.changed",
        payload: { projectId: id, fromStatus: before.status, toStatus: parsed.status },
        dedupeKey: `project.status.changed:${id}:${before.status}->${parsed.status}:${Date.now()}`,
      });
    }
    return result;
  });
  await patchProjectInConvex(updated.id, updated);

  // Recalculate totals if tax rate changed
  if (parsed.taxRate !== undefined) {
    await recalculateProjectTotals(id);
  }

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
  if (!project) {
    throw new UserFacingError({
      code: "NOT_FOUND",
      title: "Project not found",
      message: "This project was deleted or moved. Refresh the page to see the latest state.",
    });
  }
  if (project.isTemplate) {
    throw new UserFacingError({
      code: "TEMPLATE_STATUS",
      title: "Cannot change template status",
      message: "Templates don't have a status — they're a starting point for creating projects.",
    });
  }
  const updated = await prisma.$transaction(async (tx) => {
    const result = await tx.project.update({
      where: { id, organizationId },
      data: { status },
    });
    if (project.status !== status) {
      await emitIfDiscordEnabled(tx, {
        organizationId,
        eventType: "project.status.changed",
        payload: { projectId: id, fromStatus: project.status, toStatus: String(status) },
        // Include status + a monotonic timestamp so a rapid CONFIRMED→PREPPING→CONFIRMED
        // sequence doesn't collide on the unique dedupeKey.
        dedupeKey: `project.status.changed:${id}:${project.status}->${String(status)}:${Date.now()}`,
      });
    }
    return result;
  });
  await patchProjectInConvex(updated.id, updated);

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
  const updated = await prisma.project.update({
    where: { id, organizationId },
    data: { [field]: notes || null },
  });
  await patchProjectInConvex(updated.id, updated);
  return serialize(updated);
}

export async function archiveProject(id: string) {
  const { organizationId } = await requirePermission("project", "update");
  const updated = await prisma.project.update({
    where: { id, organizationId },
    data: { status: "CANCELLED" },
  });
  await patchProjectInConvex(updated.id, updated);
  return serialize(updated);
}

export async function duplicateProject(sourceId: string, newProjectNumber: string, newName: string) {
  const { organizationId } = await requirePermission("project", "create");

  const source = await prisma.project.findUniqueOrThrow({
    where: { id: sourceId, organizationId },
    include: {
      categories: {
        include: {
          groups: {
            include: {
              lineItems: {
                include: { childLineItems: true },
                orderBy: { sortOrder: "asc" },
              },
            },
            orderBy: { sortOrder: "asc" },
          },
          lineItems: {
            where: { groupId: null },
            include: { childLineItems: true },
            orderBy: { sortOrder: "asc" },
          },
        },
        orderBy: { sortOrder: "asc" },
      },
      lineItems: {
        where: { isKitChild: false, categoryId: null },
        include: { childLineItems: true },
        orderBy: { sortOrder: "asc" },
      },
      projectManagers: true,
    },
  });

  // Mirror the duplicated grouping substructure to Convex after the tx commits
  // (the new project + line items are step-6 / step-4 domains, not mirrored here).
  const createdCategories: Array<Record<string, unknown>> = [];
  const createdGroups: Array<Record<string, unknown>> = [];
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
          defaultRentalPeriod: source.defaultRentalPeriod,
          defaultRentalQuantity: source.defaultRentalQuantity,
          billingWeeks: source.billingWeeks,
          billingDays: source.billingDays,
          taxRate: source.taxRate,
          tags: source.tags,
          isTemplate: false,
        },
      });

      // Copy project managers
      for (const pm of source.projectManagers) {
        await tx.projectManager.create({
          data: {
            organizationId,
            projectId: newProject.id,
            userId: pm.userId,
          },
        });
      }

      // Helper to copy a line item and its children
      async function copyLineItem(
        li: typeof source.lineItems[0],
        newProjectId: string,
        newCategoryId: string | null,
        newGroupId: string | null,
      ) {
        const parentItem = await tx.projectLineItem.create({
          data: {
            organizationId,
            projectId: newProjectId,
            categoryId: newCategoryId,
            groupId: newGroupId,
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
                projectId: newProjectId,
                categoryId: newCategoryId,
                groupId: newGroupId,
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

      // Copy categories → groups → line items
      for (const cat of source.categories) {
        const newCat = await tx.projectCategory.create({
          data: {
            organizationId,
            projectId: newProject.id,
            name: cat.name,
            sortOrder: cat.sortOrder,
          },
        });
        createdCategories.push(newCat);

        for (const group of cat.groups) {
          const newGroup = await tx.projectGroup.create({
            data: {
              organizationId,
              projectId: newProject.id,
              categoryId: newCat.id,
              title: group.title,
              description: group.description,
              quantity: group.quantity,
              price: group.price,
              suggestedPrice: group.suggestedPrice,
              rentalPeriod: group.rentalPeriod,
              rentalQuantity: group.rentalQuantity,
              sortOrder: group.sortOrder,
            },
          });
          createdGroups.push(newGroup);

          for (const li of group.lineItems) {
            await copyLineItem(li, newProject.id, newCat.id, newGroup.id);
          }
        }

        // Copy standalone line items in category
        for (const li of cat.lineItems) {
          await copyLineItem(li, newProject.id, newCat.id, null);
        }
      }

      // Copy uncategorized line items
      for (const li of source.lineItems) {
        await copyLineItem(li, newProject.id, null, null);
      }

      return newProject;
    });

    // Mirror the duplicated project + categories + groups + line items to Convex.
    await mirrorProjectCreate(result);
    for (const c of createdCategories) await mirrorProjectCategoryCreate(c);
    for (const g of createdGroups) await mirrorProjectGroupCreate(g);
    await upsertProjectLineItemsToConvex(result.id);

    // Recalculate totals after transaction commits
    await recalculateProjectTotals(result.id);

    return serialize(result);
  } catch (e: unknown) {
    const translated = translatePrismaError(e);
    if (translated) throw translated;
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

  if (!source) {
    throw new UserFacingError({
      code: "NOT_FOUND",
      title: "Project not found",
      message: "This project was deleted or moved. Refresh the page to see the latest state.",
    });
  }

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

    // Mirror the new template project + its copied line items to Convex.
    await mirrorProjectCreate(result);
    await upsertProjectLineItemsToConvex(result.id);

    // Recalculate totals after transaction commits
    await recalculateProjectTotals(result.id);

    return serialize(result);
  } catch (e: unknown) {
    const translated = translatePrismaError(e);
    if (translated) throw translated;
    throw e;
  }
}

export async function getTemplates() {
  const { organizationId } = await getOrgContext();

  const templates = await prisma.project.findMany({
    where: { organizationId, isTemplate: true },
    include: {
      location: true,
      _count: { select: { lineItems: { where: { isKitChild: false } } } },
    },
    orderBy: { updatedAt: "desc" },
  });

  // Clients live in Convex — attach instead of a Prisma join.
  return serialize(await attachClient(organizationId, templates));
}

export async function deleteTemplate(id: string) {
  const { organizationId } = await requirePermission("project", "delete");

  const template = await prisma.project.findUnique({
    where: { id, organizationId },
  });
  if (!template) {
    throw new UserFacingError({
      code: "NOT_FOUND",
      title: "Template not found",
      message: "This template was deleted or moved. Refresh the page to see the latest state.",
    });
  }
  if (!template.isTemplate) {
    throw new UserFacingError({
      code: "NOT_A_TEMPLATE",
      title: "Not a template",
      message: "That ID points at a project, not a template.",
    });
  }

  await prisma.project.delete({ where: { id, organizationId } });
  await removeProjectFromConvex(id);
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

  if (!project) {
    throw new UserFacingError({
      code: "NOT_FOUND",
      title: "Project not found",
      message: "This project was deleted or moved. Refresh the page to see the latest state.",
    });
  }
  if (project.status !== "CANCELLED") {
    throw new UserFacingError({
      code: "DELETE_GUARD",
      title: "Cannot delete this project",
      message: "Only cancelled projects can be deleted.",
      hint: "Set the project status to Cancelled first, then try again.",
    });
  }

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

  const freedKitAssetIds = await prisma.$transaction(async (tx) => {
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
    let kitAssetIds: string[] = [];
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
      kitAssetIds = kitAssets.map((ka) => ka.assetId);
      if (kitAssetIds.length > 0) {
        await tx.asset.updateMany({
          where: { id: { in: kitAssetIds }, organizationId },
          data: {
            status: "AVAILABLE",
            locationId: defaultLocation?.id ?? null,
          },
        });
      }
    }

    // Delete the project (cascades to line items, media, etc.)
    await tx.project.delete({ where: { id, organizationId } });
    return kitAssetIds;
  });

  // Mirror the freed kits + assets (direct line-item assets + kit-content assets)
  // status/location resets to Convex, and remove the cascade-deleted line items.
  await syncKitsToConvex(checkedOutKitIds);
  await syncAssetsToConvex([...checkedOutAssetIds, ...freedKitAssetIds]);
  for (const li of project.lineItems) await removeLineItemFromConvex(li.id);
  await removeProjectFromConvex(id);

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

/** Get project milestone dates for call sheet dialog */
export async function getCallSheetDates(projectId: string) {
  const { organizationId } = await getOrgContext();
  const [project, services] = await Promise.all([
    prisma.project.findUnique({
      where: { id: projectId, organizationId },
      select: {
        loadInDate: true,
        eventStartDate: true,
        eventEndDate: true,
        loadOutDate: true,
      },
    }),
    prisma.projectService.findMany({
      where: { projectId, organizationId, status: { not: "CANCELLED" } },
      select: {
        date: true,
        _count: { select: { crewAssignments: true } },
      },
      orderBy: { date: "asc" },
    }),
  ]);
  if (!project) {
    throw new UserFacingError({
      code: "NOT_FOUND",
      title: "Project not found",
      message: "This project was deleted or moved. Refresh the page to see the latest state.",
    });
  }
  return serialize({
    ...project,
    serviceDates: services
      .filter((s) => s.date != null)
      .map((s) => ({ date: s.date, crewCount: s._count.crewAssignments })),
  });
}
