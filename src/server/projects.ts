"use server";

import { prisma } from "@/lib/prisma";
import { getOrgContext, requirePermission } from "@/lib/org-context";
import { getClientById, getClientMap, attachClient } from "@/lib/clients-read";
import { buildProjectEquipmentTree } from "@/lib/project-line-item-read";
import { getCallSheetData } from "@/lib/projects-read";
import {
  getLineItemsByProjectIds,
  buildIncludeLineItemsByProject,
  groupActiveLineItemsByProject,
  countTopLevelLineItemsByProject,
} from "@/lib/line-item-count-read";
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
import { getConvexClient } from "@/lib/convex-client";
import { getProjectMediaFromConvex, withResolvedFile } from "@/lib/media-read";
import { api } from "../../convex/_generated/api";
import { upsertProjectLineItemsToConvex, removeLineItemFromConvex } from "@/lib/line-item-mirror";
import { mirrorProjectCreate, patchProjectInConvex, removeProjectFromConvex } from "@/lib/project-mirror";
import { syncProjectServicesToConvex } from "@/lib/project-subtable-mirror";
import { snapshotProjectCrew, removeCrewAssignmentCascadeFromConvex } from "@/lib/crew-scheduling-mirror";
import { buildFilterWhere, type FilterValue, type FilterColumnDef } from "@/lib/table-utils";
import { translatePrismaError, UserFacingError } from "@/lib/errors";
import { getDefaultLocation, getLocationMap, getMappedLocationsByOrg, mapLocation } from "@/lib/locations-read";
import { createId } from "@paralleldrive/cuid2";
import { assertNoBlockingComments } from "@/lib/blocking-comments-read";
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

const BLOCKED_FORWARD_PROJECT_STATUSES: ProjectStatus[] = [
  "PREPPING",
  "CHECKED_OUT",
  "ON_SITE",
];

function isBlockedForwardProjectStatus(status: ProjectStatus | ProjectFormValues["status"] | null | undefined) {
  return status ? BLOCKED_FORWARD_PROJECT_STATUSES.includes(status as ProjectStatus) : false;
}

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
  const startSeq = (seqRow?.value ?? 0) + 1;

  // Skip past any rendered code that's already taken so the preview matches what
  // `generateProjectNumber` will actually allocate. The counter can lag behind
  // the real projects (codes entered manually, imported, or created before
  // auto-numbering was switched on), in which case `startSeq` would render an
  // already-used number — e.g. counter 0 → "260601" when 260601-260603 exist.
  // Probe forward only; never persist (this is a preview, must not consume a number).
  // Keep this skip loop in sync with `generateProjectNumber` above.
  for (let i = 0; i < 50; i++) {
    const number = renderProjectNumber(config.format, {
      parts,
      sequence: startSeq + i,
      padding: config.padding,
    });
    const clash = await prisma.project.findFirst({
      where: { organizationId, projectNumber: number },
      select: { id: true },
    });
    if (!clash) return number;
  }
  // Pathological: 50 consecutive codes taken. Fall back to the unskipped render
  // rather than hard-erroring the preview query.
  return renderProjectNumber(config.format, { parts, sequence: startSeq, padding: config.padding });
}

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

  // The location FK was dropped (Phase B) — the search-by-location-name clause
  // can no longer be a Prisma relational filter. Resolve matching location ids
  // from the Convex mirror and match projects by `locationId in [...]` instead.
  const searchLocationIds = search
    ? (await getMappedLocationsByOrg(organizationId))
        .filter((l) => l.name.toLowerCase().includes(search.toLowerCase()))
        .map((l) => l.id)
    : [];

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
        ...(searchLocationIds.length > 0 ? [{ locationId: { in: searchLocationIds } }] : []),
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
      ...(sortByClient
        ? {}
        : { orderBy: { [sortBy]: sortOrder }, skip: (page - 1) * pageSize, take: pageSize }),
    }),
    prisma.project.count({ where }),
  ]);

  const [clientMap, locationMap] = await Promise.all([
    getClientMap(organizationId),
    getLocationMap(organizationId),
  ]);
  let projects = projectsRaw.map((p) => ({
    ...p,
    client: p.clientId ? clientMap.get(p.clientId) ?? null : null,
    location: p.locationId ? locationMap.get(p.locationId) ?? null : null,
  }));

  // includeLineItems: the slim `{id,status,type,isKitChild}` list (status !=
  // CANCELLED && type === EQUIPMENT) now comes from the dual-written Convex line
  // items, not a Prisma include. Fetched only for the page being returned.
  if (includeLineItems) {
    const pageProjectIds = projects.map((p) => p.id);
    const liByProject = buildIncludeLineItemsByProject(
      await getLineItemsByProjectIds(organizationId, pageProjectIds),
      pageProjectIds,
    );
    projects = projects.map((p) => ({ ...p, lineItems: liByProject.get(p.id) ?? [] }));
  }

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

  // Batch fetch all (non-CANCELLED) line items across all active projects from the
  // dual-written Convex table, grouped per project. computeOverbookedStatus reads
  // id/modelId/quantity/isKitChild/parentLineItemId/kitId/status/subHireId — all
  // present on the mapped row. (computeOverbookedStatus's own overlapping-bookings
  // query stays Prisma; it's shared by warehouse/project-categories.)
  const itemsByProject = groupActiveLineItemsByProject(
    await getLineItemsByProjectIds(organizationId, activeIds),
    activeIds,
  );

  const result: Record<string, { hasOverbooked: boolean; hasReducedStock: boolean }> = {};

  // Compute per project
  for (const project of projects) {
    const items = itemsByProject.get(project.id) ?? [];
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
  // The equipment line-item tree (categories → groups → lineItems →
  // childLineItems → units, with asset/bulkAsset/kit/model/supplier) now comes
  // from the dual-written Convex tables, reconstructed in JS — see
  // src/lib/project-line-item-read.ts (Phase A keystone). Prisma here only
  // supplies the project scalars + location + projectManagers + media, which stay
  // Prisma reads for now.
  const projectRow = await prisma.project.findUnique({
    where: { id, organizationId },
    include: {
      projectManagers: {
        include: {
          user: { select: { id: true, name: true, email: true, image: true } },
        },
        orderBy: { addedAt: "asc" },
      },
    },
  });
  if (!projectRow) return null;

  // project media gallery now from the Convex mirror (dual-written → identical
  // data); was a Prisma projectMedia + file join. See media-read.ts.
  const media = withResolvedFile(await getProjectMediaFromConvex(projectRow.id));

  // Location FK was dropped (Phase B) — reconstruct `location` (with its parent)
  // from the Convex mirror, replacing the old `include: { location: { include:
  // { parent } } }`. Returns the Prisma-row business shape (mapLocation) so the
  // address/lat/long inheritance below behaves identically.
  let location:
    | (import("@/lib/locations-read").MappedLocation & {
        parent: import("@/lib/locations-read").MappedLocation | null;
      })
    | null = null;
  if (projectRow.locationId) {
    const locationMap = await getLocationMap(organizationId);
    const locDoc = locationMap.get(projectRow.locationId);
    if (locDoc) {
      const loc = mapLocation(locDoc);
      const parentDoc = loc.parentId ? locationMap.get(loc.parentId) : undefined;
      location = { ...loc, parent: parentDoc ? mapLocation(parentDoc) : null };
    }
  }
  const project = { ...projectRow, media, location };

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

  // The whole equipment composition (categories → groups → lineItems →
  // childLineItems → units, with model/supplier/asset/bulkAsset/kit attached) is
  // reconstructed from the dual-written Convex tables in JS — keystone reader.
  const { categories, lineItems: topLineItems } = await buildProjectEquipmentTree(
    project.id,
    organizationId,
  );

  const overbookedMap = await computeOverbookedStatus(
    organizationId,
    topLineItems,
    project.rentalStartDate,
    project.rentalEndDate,
    project.id,
  );

  const enrichedLineItems = topLineItems.map((li) => {
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
  return serialize({ ...project, categories, client, lineItems: enrichedLineItems });
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
        taxRate: parsed.taxRate ?? null,
        discountPercent: parsed.discountPercent ?? null,
        depositPercent: parsed.depositPercent ?? null,
        depositPaid: parsed.depositPaid ?? null,
        invoicedTotal: parsed.invoicedTotal ?? null,
        tags: parsed.tags,
      },
      });

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

  // Read the prior status so a project-form save that flips status into a
  // blocked-forward state can be gated on blocking comments.
  const before = await prisma.project.findUnique({
    where: { id, organizationId },
    select: { status: true, isTemplate: true },
  });

  if (
    before &&
    !before.isTemplate &&
    before.status !== parsed.status &&
    isBlockedForwardProjectStatus(parsed.status)
  ) {
    await assertNoBlockingComments(organizationId, id, {
      actionLabel: `move this project to ${String(parsed.status).toLowerCase().replaceAll("_", " ")}`,
    });
  }

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

  if (project.status !== status && isBlockedForwardProjectStatus(status)) {
    await assertNoBlockingComments(organizationId, id, {
      actionLabel: `move this project to ${String(status).toLowerCase().replaceAll("_", " ")}`,
    });
  }

  const updated = await prisma.$transaction(async (tx) => {
    const result = await tx.project.update({
      where: { id, organizationId },
      data: { status },
    });
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

  const client = await getConvexClient();
  const source = await prisma.project.findUniqueOrThrow({
    where: { id: sourceId, organizationId },
    include: {
      lineItems: {
        where: { isKitChild: false, categoryId: null },
        include: { childLineItems: true },
        orderBy: { sortOrder: "asc" },
      },
      projectManagers: true,
    },
  });

  // Read source categories/groups from Convex (Convex-only after write inversion).
  const [sourceCategories, sourceGroups] = await Promise.all([
    client.query(api.projectCategories.listByProject, { projectId: sourceId, orgId: organizationId }),
    client.query(api.projectGroups.listByProject, { projectId: sourceId, orgId: organizationId }),
  ]);
  const sortedSourceCategories = [...sourceCategories].sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));

  // Read all non-kit-child source line items from Prisma (line items stay Prisma).
  type SourceLineItem = Awaited<ReturnType<typeof prisma.projectLineItem.findMany<{
    include: { childLineItems: true }
  }>>>[number];
  const allSourceLineItems = await prisma.projectLineItem.findMany({
    where: { projectId: sourceId, organizationId, isKitChild: false },
    include: { childLineItems: true },
    orderBy: { sortOrder: "asc" },
  }) as SourceLineItem[];

  const lineItemsByGroupId = new Map<string, SourceLineItem[]>();
  const lineItemsByCatId = new Map<string, SourceLineItem[]>();
  for (const li of allSourceLineItems) {
    if (li.groupId) {
      const arr = lineItemsByGroupId.get(li.groupId) ?? [];
      arr.push(li);
      lineItemsByGroupId.set(li.groupId, arr);
    } else if (li.categoryId) {
      const arr = lineItemsByCatId.get(li.categoryId) ?? [];
      arr.push(li);
      lineItemsByCatId.set(li.categoryId, arr);
    }
  }

  // Pre-generate IDs for new categories and groups so line items can reference them
  // inside the Prisma transaction before Convex rows are written.
  const catIdMap = new Map(sourceCategories.map((c) => [c.id, createId()]));
  const groupIdMap = new Map(sourceGroups.map((g) => [g.id, createId()]));
  const groupsByCatId = new Map<string, typeof sourceGroups[number][]>();
  for (const g of sourceGroups) {
    if (g.categoryId) {
      const arr = groupsByCatId.get(g.categoryId) ?? [];
      arr.push(g);
      groupsByCatId.set(g.categoryId, arr);
    }
  }

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
          taxRate: source.taxRate,
          tags: source.tags,
          isTemplate: false,
        },
      });

      // Helper to copy a line item and its children
      async function copyLineItem(
        li: SourceLineItem,
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

      // Copy category line items using pre-generated category/group IDs.
      // Categories and groups are Convex-only; no Prisma rows are written for them.
      for (const cat of sortedSourceCategories) {
        const newCatId = catIdMap.get(cat.id)!;
        const catGroups = (groupsByCatId.get(cat.id) ?? [])
          .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));

        for (const group of catGroups) {
          const newGroupId = groupIdMap.get(group.id)!;
          for (const li of lineItemsByGroupId.get(group.id) ?? []) {
            await copyLineItem(li, newProject.id, newCatId, newGroupId);
          }
        }

        // Copy standalone line items in category (groupId=null)
        for (const li of lineItemsByCatId.get(cat.id) ?? []) {
          await copyLineItem(li, newProject.id, newCatId, null);
        }
      }

      // Copy uncategorized line items
      const uncategorizedLineItems = allSourceLineItems.filter((li) => !li.categoryId && !li.groupId);
      for (const li of uncategorizedLineItems) {
        await copyLineItem(li, newProject.id, null, null);
      }

      return newProject;
    });

    // Create duplicated categories + groups in Convex. Line items were written
    // to Prisma above using the pre-generated IDs.
    const dupNow = Date.now();
    for (const cat of sortedSourceCategories) {
      await client.mutation(api.projectCategories.createIfMissing, {
        id: catIdMap.get(cat.id)!,
        organizationId,
        projectId: result.id,
        name: cat.name,
        sortOrder: cat.sortOrder ?? 0,
        createdAt: dupNow,
        updatedAt: dupNow,
      });
    }
    for (const group of sourceGroups) {
      const newCatId = group.categoryId ? catIdMap.get(group.categoryId) : undefined;
      await client.mutation(api.projectGroups.createIfMissing, {
        id: groupIdMap.get(group.id)!,
        organizationId,
        projectId: result.id,
        categoryId: newCatId,
        title: group.title,
        description: group.description,
        quantity: group.quantity,
        price: group.price ?? undefined,
        suggestedPrice: group.suggestedPrice ?? undefined,
        rentalPeriod: group.rentalPeriod ?? undefined,
        rentalQuantity: group.rentalQuantity ?? undefined,
        sortOrder: group.sortOrder ?? 0,
        createdAt: dupNow,
        updatedAt: dupNow,
      });
    }

    await mirrorProjectCreate(result);
    await upsertProjectLineItemsToConvex(result.id);
    // Copy project managers directly to Convex (Convex-only after Phase B).
    for (const pm of source.projectManagers) {
      await client.mutation(api.projectManagers.createIfMissing, {
        id: createId(),
        organizationId,
        projectId: result.id,
        userId: pm.userId,
        addedAt: dupNow,
      });
    }

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
    orderBy: { updatedAt: "desc" },
  });

  // The `_count.lineItems` (top-level / non kit-child) now comes from the
  // dual-written Convex line items instead of a Prisma `_count` aggregate.
  const templateIds = templates.map((t) => t.id);
  const [topLevelCounts, locationMap] = await Promise.all([
    countTopLevelLineItemsByProject(
      await getLineItemsByProjectIds(organizationId, templateIds),
      templateIds,
    ),
    // Location FK was dropped (Phase B); attach `location` from the Convex mirror.
    getLocationMap(organizationId),
  ]);
  const withCounts = templates.map((t) => ({
    ...t,
    location: t.locationId ? locationMap.get(t.locationId) ?? null : null,
    _count: { lineItems: topLevelCounts.get(t.id) ?? 0 },
  }));

  // Clients live in Convex — attach instead of a Prisma join.
  return serialize(await attachClient(organizationId, withCounts));
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
  // Delete Convex-only sub-table rows (PM/tasks) and reconcile Prisma-cascade ones (services).
  const convexForDelete = await getConvexClient();
  const [pmRows, taskRows] = await Promise.all([
    convexForDelete.query(api.projectManagers.listByProject, { projectId: id, orgId: organizationId }),
    convexForDelete.query(api.projectTasks.listByProject, { projectId: id, orgId: organizationId }),
  ]);
  await Promise.all([
    ...pmRows.map((pm) => convexForDelete.mutation(api.projectManagers.remove, { id: pm.id })),
    ...taskRows.map((t) => convexForDelete.mutation(api.projectTasks.remove, { id: t.id })),
  ]);
  await syncProjectServicesToConvex(organizationId, id);
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

  // Get org default location from Convex.
  const defaultLocation = await getDefaultLocation(organizationId);

  // Capture the project's crew cascade (assignments → shifts/time-entries) before
  // the project delete cascades them away, so they can be dropped from Convex.
  const crewCascade = await snapshotProjectCrew(id);

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
  await removeCrewAssignmentCascadeFromConvex(crewCascade);
  await removeProjectFromConvex(id);
  // Delete Convex-only sub-table rows (PM/tasks) and reconcile Prisma-cascade ones (services).
  const convex = await getConvexClient();
  const [pmRows, taskRows] = await Promise.all([
    convex.query(api.projectManagers.listByProject, { projectId: id, orgId: organizationId }),
    convex.query(api.projectTasks.listByProject, { projectId: id, orgId: organizationId }),
  ]);
  await Promise.all([
    ...pmRows.map((pm) => convex.mutation(api.projectManagers.remove, { id: pm.id })),
    ...taskRows.map((t) => convex.mutation(api.projectTasks.remove, { id: t.id })),
  ]);
  await syncProjectServicesToConvex(organizationId, id);

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
  // project (scalar milestone dates), projectService (date + per-service crew
  // count) and crewAssignment are all dual-written to Convex — read from there
  // instead of Prisma. No line-item/group/category data is touched, so this is
  // safe ahead of the keystone tree reader. See src/lib/projects-read.ts.
  const data = await getCallSheetData(organizationId, projectId);
  if (!data) {
    throw new UserFacingError({
      code: "NOT_FOUND",
      title: "Project not found",
      message: "This project was deleted or moved. Refresh the page to see the latest state.",
    });
  }
  return serialize({
    ...data.milestones,
    serviceDates: data.serviceDates,
  });
}
