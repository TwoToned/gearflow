"use server";

import { prisma } from "@/lib/prisma";
import { getOrgContext, requirePermission } from "@/lib/org-context";
import { getClientById, getClientMap, attachClient } from "@/lib/clients-read";
import { buildProjectEquipmentTree } from "@/lib/project-line-item-read";
import {
  getCallSheetData,
  getProjectsByOrgMapped,
  getProjectByIdMapped,
  type ProjectRow,
} from "@/lib/projects-read";
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
import type { ProjectStatus } from "@/generated/prisma/client";
import { serialize } from "@/lib/serialize";
import { computeOverbookedStatus } from "@/lib/availability";
import { recalculateProjectTotals } from "@/server/line-items";
import { logActivity } from "@/lib/activity-log";
import { getKitSerializedItemsByOrg } from "@/lib/kits-read";
import { getConvexClient } from "@/lib/convex-client";
import { getProjectMediaFromConvex, withResolvedFile } from "@/lib/media-read";
import { api } from "../../convex/_generated/api";
import { getAssignmentsByProject } from "@/lib/crew-scheduling-read";
import { type FilterValue } from "@/lib/table-utils";
import { translatePrismaError, UserFacingError } from "@/lib/errors";
import { getDefaultLocation, getLocationMap, getMappedLocationsByOrg, mapLocation } from "@/lib/locations-read";
import { createId } from "@paralleldrive/cuid2";
import { nativeProjectWrites } from "@/lib/native-writes";
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
  organizationId: string,
  config: ProjectNumberConfig,
  now: Date,
): Promise<string> {
  const parts = datePartsInTimezone(now, config.timezone);
  const scopeKey = scopeKeyFor(config.reset, parts);
  const convex = await getConvexClient();

  for (let attempt = 0; attempt < 50; attempt++) {
    // Atomic counter bump (Convex serializable mutation = race-free across concurrent
    // creates — the ON CONFLICT … value+1 equivalent). cuid used only on first insert.
    const sequence = await convex.mutation(api.projectNumberSequences.reserveNextNumber, {
      organizationId,
      scopeKey,
      newId: createId(),
      now: now.getTime(),
    });
    const number = renderProjectNumber(config.format, { parts, sequence, padding: config.padding });
    const clash = await convex.query(api.projects.getByOrgAndNumber, { organizationId, projectNumber: number });
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
  // The sequence counter is Convex-only now — read the doc (no increment; this is
  // a pure preview) and use its `value`.
  const convex = await getConvexClient();
  const seqRow = await convex.query(api.projectNumberSequences.getByOrgAndScopeKey, {
    organizationId,
    scopeKey,
  });
  const startSeq = (seqRow?.value ?? 0) + 1;

  // Skip past any rendered code that's already taken so the preview matches what
  // `generateProjectNumber` will actually allocate. The counter can lag behind
  // the real projects (codes entered manually, imported, or created before
  // auto-numbering was switched on), in which case `startSeq` would render an
  // already-used number — e.g. counter 0 → "260601" when 260601-260603 exist.
  // Probe forward only; never persist (this is a preview, must not consume a number).
  // Keep this skip loop in sync with `generateProjectNumber` above.
  const takenNumbers = new Set(
    (await getProjectsByOrgMapped(organizationId)).map((p) => p.projectNumber),
  );
  for (let i = 0; i < 50; i++) {
    const number = renderProjectNumber(config.format, {
      parts,
      sequence: startSeq + i,
      padding: config.padding,
    });
    if (!takenNumbers.has(number)) return number;
  }
  // Pathological: 50 consecutive codes taken. Fall back to the unskipped render
  // rather than hard-erroring the preview query.
  return renderProjectNumber(config.format, { parts, sequence: startSeq, padding: config.padding });
}

/**
 * Compare two mapped project rows on a scalar `sortBy` column, returning the
 * ASCENDING ordering (the caller multiplies by -1 for desc). Mirrors the dropped
 * Prisma `orderBy: { [sortBy]: sortOrder }`: NULLs sort LAST under ASC (so they
 * compare "greater" here, then the desc multiply flips them to first, matching
 * Postgres NULLS FIRST under DESC). Dates compare by epoch, numbers numerically,
 * everything else lexicographically.
 */
function compareProjectField(a: ProjectRow, b: ProjectRow, sortBy: string): number {
  const av = (a as unknown as Record<string, unknown>)[sortBy] ?? null;
  const bv = (b as unknown as Record<string, unknown>)[sortBy] ?? null;
  if (av == null && bv == null) return 0;
  if (av == null) return 1; // nulls last under ASC
  if (bv == null) return -1;
  if (av instanceof Date && bv instanceof Date) return av.getTime() - bv.getTime();
  if (typeof av === "number" && typeof bv === "number") return av - bv;
  return String(av) < String(bv) ? -1 : String(av) > String(bv) ? 1 : 0;
}

async function generateTemplateCode(organizationId: string): Promise<string> {
  // project is Convex-only — count templates + check uniqueness off the Convex mirror.
  const allProjects = await getProjectsByOrgMapped(organizationId);
  const count = allProjects.filter((p) => p.isTemplate).length;
  let code = `TPL-${String(count + 1).padStart(4, "0")}`;
  // Ensure uniqueness
  const existingNumbers = new Set(allProjects.map((p) => p.projectNumber));
  if (existingNumbers.has(code)) {
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

  // The `project` row is dual-written to Convex — read all org projects from the
  // Convex mirror (Prisma-row-shaped) and replicate the old Prisma `where` / sort /
  // pagination in JS. Pure, reversible read swap (Phase C keystone read-cleanup).
  const allProjects = await getProjectsByOrgMapped(organizationId);

  // The location FK was dropped (Phase B) — the search-by-location-name clause
  // can no longer be a Prisma relational filter. Resolve matching location ids
  // from the Convex mirror and match projects by `locationId in [...]` instead.
  const searchLocationIdSet = search
    ? new Set(
        (await getMappedLocationsByOrg(organizationId))
          .filter((l) => l.name.toLowerCase().includes(search.toLowerCase()))
          .map((l) => l.id),
      )
    : null;

  // DataTable enum filters: status/type are the two enum columns → `{ in: [...] }`
  // filters on those scalar fields (replicates the dropped buildFilterWhere where).
  const statusFilterIn = (() => {
    const v = filters?.status;
    return Array.isArray(v) && v.length > 0 ? new Set(v as string[]) : null;
  })();
  const typeFilterIn = (() => {
    const v = filters?.type;
    return Array.isArray(v) && v.length > 0 ? new Set(v as string[]) : null;
  })();

  const searchLower = search?.toLowerCase();
  const rentalStartGte = rentalStartDate ? new Date(rentalStartDate).getTime() : null;
  const rentalEndLte = rentalEndDate ? new Date(rentalEndDate).getTime() : null;

  const filtered = allProjects.filter((p) => {
    if (p.isTemplate) return false;
    if (status && p.status !== status) return false;
    if (type && p.type !== type) return false;
    if (clientId && p.clientId !== clientId) return false;
    if (searchLower) {
      const matchesName = p.name.toLowerCase().includes(searchLower);
      const matchesNumber = p.projectNumber.toLowerCase().includes(searchLower);
      const matchesLocation =
        searchLocationIdSet != null && p.locationId != null && searchLocationIdSet.has(p.locationId);
      if (!matchesName && !matchesNumber && !matchesLocation) return false;
    }
    if (rentalStartGte != null && (p.rentalStartDate == null || p.rentalStartDate.getTime() < rentalStartGte))
      return false;
    if (rentalEndLte != null && (p.rentalEndDate == null || p.rentalEndDate.getTime() > rentalEndLte))
      return false;
    if (statusFilterIn && !statusFilterIn.has(p.status)) return false;
    if (typeFilterIn && !typeFilterIn.has(p.type)) return false;
    return true;
  });

  const total = filtered.length;

  // Clients live in Convex (no Prisma join). Sorting by client name therefore
  // can't happen at the source — when sortBy === "client" we sort + paginate
  // after attaching clients. Other sorts sort the mapped rows, then paginate.
  const sortByClient = sortBy === "client";

  if (!sortByClient) {
    const dir = sortOrder === "desc" ? -1 : 1;
    filtered.sort((a, b) => compareProjectField(a, b, sortBy) * dir);
  }

  // For non-client sorts, slice the page before attaching cross-domain data.
  const pageRows = sortByClient ? filtered : filtered.slice((page - 1) * pageSize, page * pageSize);

  const [clientMap, locationMap] = await Promise.all([
    getClientMap(organizationId),
    getLocationMap(organizationId),
  ]);
  let projects = pageRows.map((p) => ({
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

  // Only compute for active projects. `project` is dual-written to Convex — read
  // all org projects (Prisma-row-shaped) and filter to the requested ids + active
  // statuses in JS (pure, reversible swap of the old Prisma findMany).
  const activeStatuses: ProjectStatus[] = ["ENQUIRY", "QUOTING", "QUOTED", "CONFIRMED", "PREPPING", "CHECKED_OUT", "ON_SITE"];
  const idSet = new Set(projectIds);
  const activeStatusSet = new Set<string>(activeStatuses);
  const projects = (await getProjectsByOrgMapped(organizationId)).filter(
    (p) => idSet.has(p.id) && activeStatusSet.has(p.status),
  );

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
  // childLineItems → units, with asset/bulkAsset/kit/model/supplier) comes from
  // the dual-written Convex tables, reconstructed in JS — see
  // src/lib/project-line-item-read.ts (Phase A keystone).
  //
  // Project scalars are dual-written to Convex → read the Prisma-row-shaped doc.
  // projectManagers are Convex-only (Phase B); read the join rows from Convex and
  // attach the linked Better-Auth `user` (kept-table Prisma) by a single batched
  // findMany. media + location stay as before.
  const projectScalars = await getProjectByIdMapped(id, organizationId);
  if (!projectScalars) return null;

  const convexForProject = await getConvexClient();

  // WAVE 1 — every independent read in parallel (was ~5 SEQUENTIAL round-trips:
  // pmRows → media → location → equipment tree → client). At this app's data scale
  // the cost is round-trip COUNT × RTT, not payload, so collapsing the sequential
  // waterfall is the win.
  const [pmRows, media0, locationMap, equipmentTree, client] = await Promise.all([
    convexForProject.query(api.projectManagers.listByProject, { projectId: id, orgId: organizationId }),
    getProjectMediaFromConvex(id),
    projectScalars.locationId ? getLocationMap(organizationId) : Promise.resolve(null),
    // The whole equipment composition (categories → groups → lineItems → children →
    // units, with model/supplier/asset/bulkAsset/kit attached) — keystone reader.
    buildProjectEquipmentTree(id, organizationId),
    projectScalars.clientId ? getClientById(projectScalars.clientId) : Promise.resolve(null),
  ]);
  const media = withResolvedFile(media0);
  const { categories, lineItems: topLineItems } = equipmentTree;

  // WAVE 2 — pmUsers (needs pmRows' ids) + overbooking (needs the line-item tree),
  // independent of each other → parallel.
  const sortedPmRows = [...pmRows].sort((a, b) => (a.addedAt ?? 0) - (b.addedAt ?? 0));
  const pmUserIds = [...new Set(sortedPmRows.map((pm) => pm.userId))];
  // NOTE: pm.user left as a prisma.user join (NOT the Convex mirror): the project
  // page reads pm.user.id non-null, so a best-effort-mirror gap would crash it —
  // waits for the surface-conversion PR.
  const [pmUsers, overbookedMap] = await Promise.all([
    pmUserIds.length > 0
      ? prisma.user.findMany({
          where: { id: { in: pmUserIds } },
          select: { id: true, name: true, email: true, image: true },
        })
      : Promise.resolve([] as Array<{ id: string; name: string; email: string; image: string | null }>),
    computeOverbookedStatus(organizationId, topLineItems, projectScalars.rentalStartDate, projectScalars.rentalEndDate, id),
  ]);
  const pmUserMap = new Map(pmUsers.map((u) => [u.id, u]));
  const projectManagers = sortedPmRows.map((pm) => ({
    id: pm.id,
    organizationId: pm.organizationId,
    projectId: pm.projectId,
    userId: pm.userId,
    addedAt: pm.addedAt != null ? new Date(pm.addedAt) : null,
    user: pmUserMap.get(pm.userId) ?? null,
  }));

  const projectRow = { ...projectScalars, projectManagers };

  // Location (with parent) reconstructed from the wave-1 locationMap.
  let location:
    | (import("@/lib/locations-read").MappedLocation & {
        parent: import("@/lib/locations-read").MappedLocation | null;
      })
    | null = null;
  if (projectRow.locationId && locationMap) {
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

  // `client` fetched in wave 1 (Convex), attached here.
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

  // project is Convex-only now. Build the create args (dates → epoch-ms, nulls
  // omitted); the project number is allocated + the row created together below.
  const id = createId();
  const now = new Date();
  const baseArgs = {
    id,
    organizationId,
    isTemplate,
    name: parsed.name,
    clientId: parsed.clientId || undefined,
    status: parsed.status,
    type: parsed.type,
    description: parsed.description || undefined,
    locationId: parsed.locationId || undefined,
    siteContactName: parsed.siteContactName || undefined,
    siteContactPhone: parsed.siteContactPhone || undefined,
    siteContactEmail: parsed.siteContactEmail || undefined,
    loadInDate: parsed.loadInDate?.getTime(),
    loadInTime: parsed.loadInTime || undefined,
    eventStartDate: parsed.eventStartDate?.getTime(),
    eventStartTime: parsed.eventStartTime || undefined,
    eventEndDate: parsed.eventEndDate?.getTime(),
    eventEndTime: parsed.eventEndTime || undefined,
    loadOutDate: parsed.loadOutDate?.getTime(),
    loadOutTime: parsed.loadOutTime || undefined,
    rentalStartDate: parsed.rentalStartDate?.getTime(),
    rentalEndDate: parsed.rentalEndDate?.getTime(),
    crewNotes: parsed.crewNotes || undefined,
    internalNotes: parsed.internalNotes || undefined,
    clientNotes: parsed.clientNotes || undefined,
    defaultRentalPeriod: parsed.defaultRentalPeriod || undefined,
    defaultRentalQuantity: parsed.defaultRentalQuantity || undefined,
    taxRate: parsed.taxRate ?? undefined,
    discountPercent: parsed.discountPercent ?? undefined,
    depositPercent: parsed.depositPercent ?? undefined,
    depositPaid: parsed.depositPaid ?? undefined,
    invoicedTotal: parsed.invoicedTotal ?? undefined,
    tags: parsed.tags,
    createdAt: now.getTime(),
    updatedAt: now.getTime(),
  };

  const convex = await getConvexClient();
  // One audit id for the whole allocation loop — only the winning insert writes it.
  const projectAuditId = createId();
  let created: { created: boolean; id: string } | null = null;
  for (let attempt = 0; attempt < 50; attempt++) {
    const projectNumber = useAutoNumber
      ? await generateProjectNumber(organizationId, autoConfig!, now)
      : (templateNumber ?? parsed.projectNumber!);
    created = nativeProjectWrites()
      ? await convex.mutation(api.projectWrites.createNative, {
          ...baseArgs,
          projectNumber,
          actor: { userId, userName },
          auditId: projectAuditId,
        })
      : await convex.mutation(api.projects.createWithUniqueNumber, { ...baseArgs, projectNumber });
    if (created.created) break;
    // Number taken. A manual / template number is a hard duplicate; an auto number
    // lost a race — loop to allocate the next one.
    if (!useAutoNumber) {
      throw new UserFacingError({
        code: "DUPLICATE_PROJECT_CODE",
        title: "Project code already in use",
        message: `A ${isTemplate ? "template" : "project"} with code "${projectNumber}" already exists.`,
        field: "projectNumber",
      });
    }
  }
  if (!created?.created) throw new Error("Could not allocate a unique project number");

  const result = await getProjectByIdMapped(id, organizationId);
  if (!result) throw new Error("Project create failed");

  if (!nativeProjectWrites()) {
    // Native path already wrote the CREATE audit atomically in the mutation.
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
  }

  return serialize(result);
}

export async function updateProject(id: string, data: ProjectFormValues) {
  const { organizationId, userId, userName } = await requirePermission("project", "update");
  const parsed = projectSchema.parse(data);

  // Read the prior status so a project-form save that flips status into a
  // blocked-forward state can be gated on blocking comments. (project is
  // Convex-only — read the mapped row instead of Prisma.)
  const before = await getProjectByIdMapped(id, organizationId);

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

  // project is Convex-only — patch via api.projects.patchProject. Value→set,
  // empty/null→clear (mirrors the old `|| null` / `?? null` clear-to-null logic).
  const set: Record<string, unknown> = {
    projectNumber: parsed.projectNumber,
    name: parsed.name,
    status: parsed.status,
    type: parsed.type,
    tags: parsed.tags,
    updatedAt: Date.now(),
  };
  const clear: string[] = [];
  const setOrClear = (key: string, value: unknown) => {
    if (value === null || value === undefined || value === "") clear.push(key);
    else set[key] = value;
  };
  setOrClear("clientId", parsed.clientId || null);
  setOrClear("description", parsed.description || null);
  setOrClear("locationId", parsed.locationId || null);
  setOrClear("siteContactName", parsed.siteContactName || null);
  setOrClear("siteContactPhone", parsed.siteContactPhone || null);
  setOrClear("siteContactEmail", parsed.siteContactEmail || null);
  setOrClear("loadInDate", parsed.loadInDate?.getTime() ?? null);
  setOrClear("loadInTime", parsed.loadInTime || null);
  setOrClear("eventStartDate", parsed.eventStartDate?.getTime() ?? null);
  setOrClear("eventStartTime", parsed.eventStartTime || null);
  setOrClear("eventEndDate", parsed.eventEndDate?.getTime() ?? null);
  setOrClear("eventEndTime", parsed.eventEndTime || null);
  setOrClear("loadOutDate", parsed.loadOutDate?.getTime() ?? null);
  setOrClear("loadOutTime", parsed.loadOutTime || null);
  setOrClear("rentalStartDate", parsed.rentalStartDate?.getTime() ?? null);
  setOrClear("rentalEndDate", parsed.rentalEndDate?.getTime() ?? null);
  setOrClear("defaultRentalPeriod", parsed.defaultRentalPeriod || null);
  setOrClear("defaultRentalQuantity", parsed.defaultRentalQuantity || null);
  setOrClear("taxRate", parsed.taxRate ?? null);
  setOrClear("crewNotes", parsed.crewNotes || null);
  setOrClear("internalNotes", parsed.internalNotes || null);
  setOrClear("clientNotes", parsed.clientNotes || null);
  setOrClear("discountPercent", parsed.discountPercent ?? null);
  setOrClear("depositPercent", parsed.depositPercent ?? null);
  setOrClear("depositPaid", parsed.depositPaid ?? null);
  setOrClear("invoicedTotal", parsed.invoicedTotal ?? null);

  const convex = await getConvexClient();
  if (nativeProjectWrites()) {
    // Native: RBAC + patch/clear + UPDATE audit atomic. Zod validation stays above;
    // recalc stays below (server-side, unchanged → totals identical).
    await convex.mutation(api.projectWrites.updateNative, {
      id,
      orgId: organizationId,
      set,
      clear,
      actor: { userId, userName },
      auditId: createId(),
      now: Date.now(),
    });
  } else {
    await convex.mutation(api.projects.patchProject, {
      id,
      set,
      ...(clear.length > 0 ? { clear } : {}),
    });
  }

  // Recalculate totals if tax rate changed
  if (parsed.taxRate !== undefined) {
    await recalculateProjectTotals(id);
  }

  const updated = await getProjectByIdMapped(id, organizationId);
  if (!updated) throw new Error("Project update failed");

  if (!nativeProjectWrites()) {
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
  }

  return serialize(updated);
}

export async function updateProjectStatus(
  id: string,
  status: ProjectFormValues["status"]
) {
  const { organizationId, userId, userName } = await requirePermission("project", "update");
  const project = await getProjectByIdMapped(id, organizationId);
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

  // project is Convex-only — patch the status directly.
  const convex = await getConvexClient();
  if (nativeProjectWrites()) {
    // Native: template guard + patch + STATUS_CHANGE audit atomic in the mutation.
    await convex.mutation(api.projectWrites.updateStatusNative, {
      id,
      orgId: organizationId,
      // A status change always carries a concrete status (the field is optional only
      // in the shared form type).
      status: status as NonNullable<typeof status>,
      actor: { userId, userName },
      auditId: createId(),
      now: Date.now(),
    });
  } else {
    await convex.mutation(api.projects.patchProject, {
      id,
      set: { status, updatedAt: Date.now() },
    });
  }

  const updated = await getProjectByIdMapped(id, organizationId);
  if (!updated) throw new Error("Project status update failed");

  if (!nativeProjectWrites()) {
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
  }

  return serialize(updated);
}

export async function updateProjectNotes(
  id: string,
  field: "crewNotes" | "internalNotes" | "clientNotes",
  notes: string,
) {
  const { organizationId, userId, userName } = await requirePermission("project", "update");
  // project is Convex-only — patch the single whitelisted notes field (clear when
  // emptied, mirroring the old `notes || null`).
  const convex = await getConvexClient();
  if (nativeProjectWrites()) {
    await convex.mutation(api.projectWrites.updateNotesNative, {
      id,
      orgId: organizationId,
      field,
      notes: notes || null,
      actor: { userId, userName },
      auditId: createId(),
      now: Date.now(),
    });
  } else {
    await convex.mutation(api.projects.patchProject, {
      id,
      ...(notes ? { set: { [field]: notes, updatedAt: Date.now() } } : { set: { updatedAt: Date.now() }, clear: [field] }),
    });
  }
  const updated = await getProjectByIdMapped(id, organizationId);
  if (!updated) throw new Error("Project notes update failed");
  return serialize(updated);
}

export async function archiveProject(id: string) {
  const { organizationId, userId, userName } = await requirePermission("project", "update");
  // project is Convex-only — set status to CANCELLED.
  const convex = await getConvexClient();
  if (nativeProjectWrites()) {
    await convex.mutation(api.projectWrites.archiveNative, {
      id,
      orgId: organizationId,
      actor: { userId, userName },
      auditId: createId(),
      now: Date.now(),
    });
  } else {
    await convex.mutation(api.projects.patchProject, {
      id,
      set: { status: "CANCELLED", updatedAt: Date.now() },
    });
  }
  const updated = await getProjectByIdMapped(id, organizationId);
  if (!updated) throw new Error("Project archive failed");
  return serialize(updated);
}

export async function duplicateProject(sourceId: string, newProjectNumber: string, newName: string) {
  const { organizationId } = await requirePermission("project", "create");

  const client = await getConvexClient();
  // project is Convex-only — read the source scalars + its project managers from Convex.
  const source = await getProjectByIdMapped(sourceId, organizationId);
  if (!source) {
    throw new UserFacingError({
      code: "NOT_FOUND",
      title: "Project not found",
      message: "This project was deleted or moved. Refresh the page to see the latest state.",
    });
  }
  const sourceProjectManagers = await client.query(api.projectManagers.listByProject, {
    projectId: sourceId,
    orgId: organizationId,
  });

  // Read source categories/groups from Convex (Convex-only after write inversion).
  const [sourceCategories, sourceGroups] = await Promise.all([
    client.query(api.projectCategories.listByProject, { projectId: sourceId, orgId: organizationId }),
    client.query(api.projectGroups.listByProject, { projectId: sourceId, orgId: organizationId }),
  ]);
  const sortedSourceCategories = [...sourceCategories].sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));

  // Read all source line items from Convex (line items are Convex-only, Phase C).
  // Reconstruct the parent → childLineItems shape the copy loop expects.
  const allConvexLineItems = await client.query(api.projectLineItems.listByProject, {
    projectId: sourceId,
    orgId: organizationId,
  });
  type ConvexLineItem = (typeof allConvexLineItems)[number];
  type SourceLineItem = ConvexLineItem & { childLineItems: ConvexLineItem[] };
  const childrenByParentId = new Map<string, ConvexLineItem[]>();
  for (const li of allConvexLineItems) {
    if (li.isKitChild && li.parentLineItemId) {
      const arr = childrenByParentId.get(li.parentLineItemId) ?? [];
      arr.push(li);
      childrenByParentId.set(li.parentLineItemId, arr);
    }
  }
  const allSourceLineItems: SourceLineItem[] = allConvexLineItems
    .filter((li) => !li.isKitChild)
    .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0))
    .map((li) => ({
      ...li,
      childLineItems: (childrenByParentId.get(li.id) ?? []).sort(
        (a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0),
      ),
    }));

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
    // project is Convex-only — create the new project row FIRST (children below
    // reference its id). createWithUniqueNumber enforces the org+number unique
    // guard; a clash means the requested duplicate code is taken.
    const newProjectId = createId();
    const dupCreatedAt = Date.now();
    const created = await client.mutation(api.projects.createWithUniqueNumber, {
      id: newProjectId,
      organizationId,
      projectNumber: newProjectNumber,
      name: newName,
      status: "ENQUIRY",
      type: source.type,
      ...(source.clientId ? { clientId: source.clientId } : {}),
      ...(source.description ? { description: source.description } : {}),
      ...(source.locationId ? { locationId: source.locationId } : {}),
      ...(source.siteContactName ? { siteContactName: source.siteContactName } : {}),
      ...(source.siteContactPhone ? { siteContactPhone: source.siteContactPhone } : {}),
      ...(source.siteContactEmail ? { siteContactEmail: source.siteContactEmail } : {}),
      ...(source.crewNotes ? { crewNotes: source.crewNotes } : {}),
      ...(source.internalNotes ? { internalNotes: source.internalNotes } : {}),
      ...(source.clientNotes ? { clientNotes: source.clientNotes } : {}),
      ...(source.discountPercent != null ? { discountPercent: source.discountPercent } : {}),
      ...(source.depositPercent != null ? { depositPercent: source.depositPercent } : {}),
      ...(source.defaultRentalPeriod ? { defaultRentalPeriod: source.defaultRentalPeriod } : {}),
      ...(source.defaultRentalQuantity != null ? { defaultRentalQuantity: source.defaultRentalQuantity } : {}),
      ...(source.taxRate != null ? { taxRate: source.taxRate } : {}),
      tags: source.tags,
      isTemplate: false,
      createdAt: dupCreatedAt,
      updatedAt: dupCreatedAt,
    });
    if (!created.created) {
      throw new UserFacingError({
        code: "DUPLICATE_PROJECT_CODE",
        title: "Project code already in use",
        message: `A project with code "${newProjectNumber}" already exists.`,
        field: "projectNumber",
      });
    }
    const result = await getProjectByIdMapped(newProjectId, organizationId);
    if (!result) throw new Error("Project duplicate failed");

    // Create duplicated categories + groups + line items in Convex. Line items
    // are Convex-only (Phase C), so they're written here (outside the Prisma tx)
    // via the generated full-field create — parent first, then each child with
    // parentLineItemId set to the new parent's id. Dates→ms, Decimals→number.
    const dupNow = Date.now();

    // Helper to copy a line item and its children into Convex.
    async function copyLineItem(
      li: SourceLineItem,
      newProjectId: string,
      newCategoryId: string | null,
      newGroupId: string | null,
    ) {
      const parentId = createId();
      await client.mutation(api.projectLineItems.create, {
        id: parentId,
        organizationId,
        projectId: newProjectId,
        ...(newCategoryId ? { categoryId: newCategoryId } : {}),
        ...(newGroupId ? { groupId: newGroupId } : {}),
        ...(li.type ? { type: li.type } : {}),
        ...(li.modelId ? { modelId: li.modelId } : {}),
        ...(li.bulkAssetId ? { bulkAssetId: li.bulkAssetId } : {}),
        ...(li.kitId ? { kitId: li.kitId } : {}),
        ...(li.supplierId ? { supplierId: li.supplierId } : {}),
        ...(li.description != null ? { description: li.description } : {}),
        ...(li.quantity != null ? { quantity: li.quantity } : {}),
        ...(li.unitPrice != null ? { unitPrice: Number(li.unitPrice) } : {}),
        ...(li.pricingType ? { pricingType: li.pricingType } : {}),
        ...(li.duration != null ? { duration: Number(li.duration) } : {}),
        ...(li.discount != null ? { discount: Number(li.discount) } : {}),
        ...(li.lineTotal != null ? { lineTotal: Number(li.lineTotal) } : {}),
        ...(li.sortOrder != null ? { sortOrder: li.sortOrder } : {}),
        ...(li.groupName != null ? { groupName: li.groupName } : {}),
        ...(li.notes != null ? { notes: li.notes } : {}),
        ...(li.isOptional != null ? { isOptional: li.isOptional } : {}),
        ...(li.showSubhireOnDocs != null ? { showSubhireOnDocs: li.showSubhireOnDocs } : {}),
        ...(li.pricingMode ? { pricingMode: li.pricingMode } : {}),
        isKitChild: false,
        status: "QUOTED",
        createdAt: dupNow,
        updatedAt: dupNow,
      });

      for (const child of li.childLineItems ?? []) {
        await client.mutation(api.projectLineItems.create, {
          id: createId(),
          organizationId,
          projectId: newProjectId,
          ...(newCategoryId ? { categoryId: newCategoryId } : {}),
          ...(newGroupId ? { groupId: newGroupId } : {}),
          ...(child.type ? { type: child.type } : {}),
          ...(child.modelId ? { modelId: child.modelId } : {}),
          ...(child.bulkAssetId ? { bulkAssetId: child.bulkAssetId } : {}),
          ...(child.description != null ? { description: child.description } : {}),
          ...(child.quantity != null ? { quantity: child.quantity } : {}),
          ...(child.unitPrice != null ? { unitPrice: Number(child.unitPrice) } : {}),
          ...(child.pricingType ? { pricingType: child.pricingType } : {}),
          ...(child.duration != null ? { duration: Number(child.duration) } : {}),
          ...(child.discount != null ? { discount: Number(child.discount) } : {}),
          ...(child.lineTotal != null ? { lineTotal: Number(child.lineTotal) } : {}),
          ...(child.sortOrder != null ? { sortOrder: child.sortOrder } : {}),
          ...(child.groupName != null ? { groupName: child.groupName } : {}),
          ...(child.notes != null ? { notes: child.notes } : {}),
          ...(child.childKind ? { childKind: child.childKind } : {}),
          isKitChild: true,
          parentLineItemId: parentId,
          status: "QUOTED",
          createdAt: dupNow,
          updatedAt: dupNow,
        });
      }
    }
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

    // Copy line items (Convex-only) using the pre-generated category/group IDs.
    for (const cat of sortedSourceCategories) {
      const newCatId = catIdMap.get(cat.id)!;
      const catGroups = (groupsByCatId.get(cat.id) ?? [])
        .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));

      for (const group of catGroups) {
        const newGroupId = groupIdMap.get(group.id)!;
        for (const li of lineItemsByGroupId.get(group.id) ?? []) {
          await copyLineItem(li, result.id, newCatId, newGroupId);
        }
      }

      // Copy standalone line items in category (groupId=null)
      for (const li of lineItemsByCatId.get(cat.id) ?? []) {
        await copyLineItem(li, result.id, newCatId, null);
      }
    }

    // Copy uncategorized line items
    const uncategorizedLineItems = allSourceLineItems.filter((li) => !li.categoryId && !li.groupId);
    for (const li of uncategorizedLineItems) {
      await copyLineItem(li, result.id, null, null);
    }

    // Copy project managers directly to Convex (Convex-only after Phase B).
    for (const pm of sourceProjectManagers) {
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

  // project is Convex-only — read the source scalars from Convex.
  const source = await getProjectByIdMapped(projectId, organizationId);

  if (!source) {
    throw new UserFacingError({
      code: "NOT_FOUND",
      title: "Project not found",
      message: "This project was deleted or moved. Refresh the page to see the latest state.",
    });
  }

  // Line items are Convex-only — read flat + reconstruct the parent/children shape.
  const convexForTemplate = await getConvexClient();
  const flatSourceLines = await convexForTemplate.query(api.projectLineItems.listByProject, { projectId, orgId: organizationId });
  const sourceLineItems = flatSourceLines
    .filter((l) => !l.isKitChild)
    .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0))
    .map((parent) => ({
      ...parent,
      childLineItems: flatSourceLines
        .filter((c) => c.parentLineItemId === parent.id)
        .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0)),
    }));

  const templateNumber = await generateTemplateCode(organizationId);

  try {
    // project is Convex-only — create the template project row FIRST (lines below
    // reference its id). createWithUniqueNumber enforces the org+number guard.
    const templateId = createId();
    const templateCreatedAt = Date.now();
    const created = await convexForTemplate.mutation(api.projects.createWithUniqueNumber, {
      id: templateId,
      organizationId,
      projectNumber: templateNumber,
      name: templateName,
      status: "ENQUIRY",
      type: source.type,
      isTemplate: true,
      ...(source.clientId ? { clientId: source.clientId } : {}),
      ...(source.description ? { description: source.description } : {}),
      ...(source.locationId ? { locationId: source.locationId } : {}),
      ...(source.siteContactName ? { siteContactName: source.siteContactName } : {}),
      ...(source.siteContactPhone ? { siteContactPhone: source.siteContactPhone } : {}),
      ...(source.siteContactEmail ? { siteContactEmail: source.siteContactEmail } : {}),
      ...(source.crewNotes ? { crewNotes: source.crewNotes } : {}),
      ...(source.internalNotes ? { internalNotes: source.internalNotes } : {}),
      ...(source.clientNotes ? { clientNotes: source.clientNotes } : {}),
      ...(source.discountPercent != null ? { discountPercent: source.discountPercent } : {}),
      ...(source.depositPercent != null ? { depositPercent: source.depositPercent } : {}),
      tags: source.tags,
      createdAt: templateCreatedAt,
      updatedAt: templateCreatedAt,
    });
    if (!created.created) {
      throw new UserFacingError({
        code: "DUPLICATE_PROJECT_CODE",
        title: "Template code already in use",
        message: `A template with code "${templateNumber}" already exists.`,
        field: "projectNumber",
      });
    }
    const result = await getProjectByIdMapped(templateId, organizationId);
    if (!result) throw new Error("Template create failed");

    // Create the copied line items in Convex (project row is Prisma; lines Convex).
    const tNow = Date.now();
    for (const li of sourceLineItems) {
      const parentId = createId();
      await convexForTemplate.mutation(api.projectLineItems.create, {
        id: parentId, organizationId, projectId: result.id, type: li.type,
        modelId: li.modelId || undefined, bulkAssetId: li.bulkAssetId || undefined, kitId: li.kitId || undefined,
        supplierId: li.supplierId || undefined, description: li.description || undefined, quantity: li.quantity,
        unitPrice: li.unitPrice ?? undefined, pricingType: li.pricingType, duration: li.duration,
        discount: li.discount ?? undefined, lineTotal: li.lineTotal ?? undefined, sortOrder: li.sortOrder,
        groupName: li.groupName || undefined, notes: li.notes || undefined, isOptional: li.isOptional,
        showSubhireOnDocs: li.showSubhireOnDocs, isKitChild: false, pricingMode: li.pricingMode || undefined,
        status: "QUOTED", createdAt: tNow, updatedAt: tNow,
      });
      for (const child of li.childLineItems ?? []) {
        await convexForTemplate.mutation(api.projectLineItems.create, {
          id: createId(), organizationId, projectId: result.id, type: child.type,
          modelId: child.modelId || undefined, bulkAssetId: child.bulkAssetId || undefined,
          description: child.description || undefined, quantity: child.quantity, unitPrice: child.unitPrice ?? undefined,
          pricingType: child.pricingType, duration: child.duration, discount: child.discount ?? undefined,
          lineTotal: child.lineTotal ?? undefined, sortOrder: child.sortOrder, groupName: child.groupName || undefined,
          notes: child.notes || undefined, isKitChild: true, parentLineItemId: parentId, status: "QUOTED",
          createdAt: tNow, updatedAt: tNow,
        });
      }
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

export async function getTemplates() {
  const { organizationId } = await getOrgContext();

  // `project` is dual-written to Convex — read all org projects (Prisma-row-shaped),
  // keep only templates, order by updatedAt desc (NULLS FIRST, Postgres DESC).
  const templates = (await getProjectsByOrgMapped(organizationId))
    .filter((p) => p.isTemplate === true)
    .sort((a, b) => {
      const at = a.updatedAt?.getTime() ?? null;
      const bt = b.updatedAt?.getTime() ?? null;
      if (at === bt) return 0;
      if (at === null) return -1; // nulls first under DESC
      if (bt === null) return 1;
      return bt - at;
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

  // project is Convex-only — read the template scalars from Convex.
  const template = await getProjectByIdMapped(id, organizationId);
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

  // Delete the Convex-only sub-table rows (PM/tasks/services), then the project doc.
  // (No Prisma FK cascade remains — they're all explicit Convex cascades now.)
  const convexForDelete = await getConvexClient();
  const [pmRows, taskRows, serviceRows] = await Promise.all([
    convexForDelete.query(api.projectManagers.listByProject, { projectId: id, orgId: organizationId }),
    convexForDelete.query(api.projectTasks.listByProject, { projectId: id, orgId: organizationId }),
    convexForDelete.query(api.projectServices.listByProject, { projectId: id, orgId: organizationId }),
  ]);
  await Promise.all([
    ...pmRows.map((pm) => convexForDelete.mutation(api.projectManagers.remove, { id: pm.id })),
    ...taskRows.map((t) => convexForDelete.mutation(api.projectTasks.remove, { id: t.id })),
    ...serviceRows.map((s) => convexForDelete.mutation(api.projectServices.remove, { id: s.id })),
  ]);
  // Grouping (category/group/slot) + any template line items live in Convex only.
  await convexForDelete.mutation(api.projectCategories.deleteAllForProject, { projectId: id });
  const templateLineItems = await convexForDelete.query(api.projectLineItems.listByProject, {
    projectId: id,
    orgId: organizationId,
  });
  for (const li of templateLineItems) {
    if (li.parentLineItemId == null) {
      await convexForDelete.mutation(api.projectLineItems.removeLineItemCascade, { id: li.id });
    }
  }
  await convexForDelete.mutation(api.projects.remove, { id });
  return { success: true };
}

export async function deleteProject(id: string) {
  const { organizationId, userId, userName } = await requirePermission("project", "delete");

  // Only allow deleting cancelled projects. Project + line items are Convex-only
  // (Phase C) — read the project scalars from Convex.
  const project = await getProjectByIdMapped(id, organizationId);

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

  const convex = await getConvexClient();

  // Line items are Convex-only — read them to collect assets/kits to free and
  // to drive the explicit cascade removal (the dropped FK no longer cascades).
  const lineItems = await convex.query(api.projectLineItems.listByProject, {
    projectId: id,
    orgId: organizationId,
  });

  // Collect IDs to reset
  const checkedOutAssetIds: string[] = [];
  const checkedOutKitIds: string[] = [];

  for (const li of lineItems) {
    if (li.assetId && (li.status === "CHECKED_OUT" || li.status === "CONFIRMED")) {
      checkedOutAssetIds.push(li.assetId);
    }
    if (li.kitId && (li.status === "CHECKED_OUT" || li.status === "CONFIRMED")) {
      checkedOutKitIds.push(li.kitId);
    }
  }

  // Get org default location from Convex.
  const defaultLocation = await getDefaultLocation(organizationId);
  const now = Date.now();

  // The project's crew assignments (Convex-only) — captured so their cascade
  // (assignment → shifts + linked time-entries) can be deleted from Convex after
  // the project row goes (no Prisma FK cascade remains — dropped in #254).
  const crewAssignmentIds = (await getAssignmentsByProject(id, organizationId)).map((a) => a.id);

  // Reset checked-out assets to AVAILABLE (Convex). Clear locationId when there
  // is no default location.
  if (checkedOutAssetIds.length > 0) {
    await convex.mutation(api.assets.bulkUpdate, {
      organizationId,
      ids: checkedOutAssetIds,
      set: { status: "AVAILABLE", ...(defaultLocation?.id ? { locationId: defaultLocation.id } : {}), updatedAt: now },
      ...(defaultLocation?.id ? {} : { clear: ["locationId"] }),
    });
  }

  // Reset checked-out kits and their contents to AVAILABLE (Convex). Kits are
  // patched per-id (status AVAILABLE + location — NOT archived). Kit serialized
  // assets are reset via assets.bulkUpdate.
  const kitAssetIds: string[] = [];
  if (checkedOutKitIds.length > 0) {
    const allKitSerialized = await getKitSerializedItemsByOrg(organizationId);
    const checkedOutKitIdSet = new Set(checkedOutKitIds);
    await Promise.all(
      checkedOutKitIds.map((kitId) =>
        convex.mutation(api.kits.update, {
          id: kitId,
          patch: { status: "AVAILABLE", ...(defaultLocation?.id ? { locationId: defaultLocation.id } : {}), updatedAt: now },
        }),
      ),
    );
    for (const ks of allKitSerialized) {
      if (checkedOutKitIdSet.has(ks.kitId)) kitAssetIds.push(ks.assetId);
    }
  }
  if (kitAssetIds.length > 0) {
    await convex.mutation(api.assets.bulkUpdate, {
      organizationId,
      ids: kitAssetIds,
      set: { status: "AVAILABLE", ...(defaultLocation?.id ? { locationId: defaultLocation.id } : {}), updatedAt: now },
      ...(defaultLocation?.id ? {} : { clear: ["locationId"] }),
    });
  }

  // Remove the project's line items from Convex. The project↔line-item FK is
  // dropped, so prisma.project.delete no longer cascades — explicitly cascade
  // each top-level line (removeLineItemCascade handles its children + units).
  // Fire concurrently (each top-level line is independent) — was one sequential
  // Convex round-trip per line, so a 200-line project took 200 sequential calls.
  await Promise.all(
    lineItems
      .filter((li) => li.parentLineItemId == null)
      .map((li) => convex.mutation(api.projectLineItems.removeLineItemCascade, { id: li.id })),
  );

  // Tidy the remaining Convex sub-tables / crew cascade, then delete the project
  // doc. The project + all its sub-tables are Convex-only now (no Prisma FK
  // cascade remains — dropped in Phase C #254), so each is removed explicitly.
  await Promise.all(
    crewAssignmentIds.map((aid) => convex.mutation(api.crewAssignments.deleteCascade, { id: aid })),
  );
  // Delete Convex-only sub-table rows (PM/tasks/services).
  const [pmRows, taskRows, serviceRows] = await Promise.all([
    convex.query(api.projectManagers.listByProject, { projectId: id, orgId: organizationId }),
    convex.query(api.projectTasks.listByProject, { projectId: id, orgId: organizationId }),
    convex.query(api.projectServices.listByProject, { projectId: id, orgId: organizationId }),
  ]);
  await Promise.all([
    ...pmRows.map((pm) => convex.mutation(api.projectManagers.remove, { id: pm.id })),
    ...taskRows.map((t) => convex.mutation(api.projectTasks.remove, { id: t.id })),
    ...serviceRows.map((s) => convex.mutation(api.projectServices.remove, { id: s.id })),
  ]);
  // Grouping (category/group/slot) lives in Convex only; the Prisma FK cascade
  // that used to clean these up was dropped in Phase C #254, so purge them here.
  await convex.mutation(api.projectCategories.deleteAllForProject, { projectId: id });
  // Finally delete the project doc itself (Convex-only).
  if (nativeProjectWrites()) {
    // Native: final project-row delete + DELETE audit atomic (the cascade above ran
    // server-side; recalc N/A for a delete).
    await convex.mutation(api.projectWrites.deleteNative, {
      id,
      orgId: organizationId,
      freedAssets: checkedOutAssetIds.length,
      freedKits: checkedOutKitIds.length,
      actor: { userId, userName },
      auditId: createId(),
      now: Date.now(),
    });
  } else {
    await convex.mutation(api.projects.remove, { id });
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
