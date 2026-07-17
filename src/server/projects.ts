"use server";

import { prisma } from "@/lib/prisma";
import { getOrgContext, requirePermission } from "@/lib/org-context";
import { getClientById, getClientMap, attachClient } from "@/lib/clients-read";
import { buildProjectEquipmentTree } from "@/lib/project-line-item-read";
import { resolvePrimaryDateRange } from "@/lib/project-dates";
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
import { getConvexClient, withConvexReadRetry } from "@/lib/convex-client";
import { getProjectMediaFromConvex, withResolvedFile } from "@/lib/media-read";
import { api } from "../../convex/_generated/api";
import { type FilterValue } from "@/lib/table-utils";
import { UserFacingError } from "@/lib/errors";
import { getDefaultLocation, getLocationMap, getMappedLocationsByOrg, mapLocation } from "@/lib/locations-read";
import { createId } from "@paralleldrive/cuid2";
import { readOrgDefaultTaxRate } from "@/lib/org-settings-read";
import { ConvexError } from "convex/values";
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
    // One resolved answer to "when is this job", so a caller never has to guess
    // among six nullable date fields. See src/lib/project-dates.ts.
    primaryDateRange: resolvePrimaryDateRange(p),
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

  // Line items carry a `categoryId` but the flat list left `category` null, so a
  // caller grouping gear by category had to resolve every id itself. The names are
  // already in `categories` (the tree) — attach them here, no extra query.
  const categoryById = new Map(categories.map((c) => [c.id, { id: c.id, name: c.name }]));
  const attachCategory = <T extends { categoryId: string | null }>(row: T) => {
    const category = row.categoryId ? categoryById.get(row.categoryId) ?? null : null;
    return { category, categoryName: category?.name ?? null };
  };

  const enrichedLineItems = topLineItems.map((li) => {
    const info = overbookedMap.get(li.id);
    return {
      ...li,
      ...attachCategory(li),
      isOverbooked: !!info,
      overbookedInfo: info ?? null,
      childLineItems: li.childLineItems?.map((child) => {
        const childInfo = overbookedMap.get(child.id);
        return {
          ...child,
          ...attachCategory(child),
          isOverbooked: !!childInfo,
          overbookedInfo: childInfo ?? null,
        };
      }),
    };
  });

  // `client` fetched in wave 1 (Convex), attached here.
  return serialize({
    ...project,
    primaryDateRange: resolvePrimaryDateRange(project),
    categories,
    client,
    lineItems: enrichedLineItems,
  });
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

  // The auto-number allocation loop is folded INTO createNative (scopeKey →
  // reserve sequence → render → clash-guard → retry, all in one transaction), so a
  // single call suffices. Auto numbering passes the resolved config + date parts
  // (computed here in the org timezone); manual/template pass the code directly.
  created = await convex.mutation(api.projectWrites.createNative, {
    ...baseArgs,
    ...(useAutoNumber
      ? {
          autoNumber: {
            format: autoConfig!.format,
            reset: autoConfig!.reset,
            padding: autoConfig!.padding,
            parts: datePartsInTimezone(now, autoConfig!.timezone),
          },
        }
      : { projectNumber: templateNumber ?? parsed.projectNumber! }),
    actor: { userId, userName },
    auditId: projectAuditId,
  });
  // A manual/template number clash is a hard duplicate (auto retries in-mutation).
  if (!created.created) {
    throw new UserFacingError({
      code: "DUPLICATE_PROJECT_CODE",
      title: "Project code already in use",
      message: `A ${isTemplate ? "template" : "project"} with code "${templateNumber ?? parsed.projectNumber}" already exists.`,
      field: "projectNumber",
    });
  }

  const result = await getProjectByIdMapped(id, organizationId);
  if (!result) throw new Error("Project create failed");

  // The CREATE audit was written atomically in the mutation.

  return serialize(result);
}

/**
 * Return-value availability check for a project code (the
 * `@@unique([organizationId, projectNumber])` guard). The create/edit wizard calls
 * this before submit to show an INLINE error on the projectNumber field.
 *
 * Why a RETURN value and not the thrown `DUPLICATE_PROJECT_CODE` UserFacingError:
 * Next masks a thrown server-action error in production to the generic
 * "An error occurred in the Server Components render" string — its `message`/`field`
 * never reach the client. A returned value serializes intact. The create/update
 * throws remain the authoritative integrity backstop (and the API-envelope path).
 */
export async function checkProjectNumberAvailable(
  projectNumber: string,
  excludeProjectId?: string,
): Promise<{ available: boolean }> {
  const { organizationId } = await getOrgContext();
  const trimmed = projectNumber.trim();
  if (!trimmed) return { available: true };
  const convex = await getConvexClient();
  const clash = await withConvexReadRetry(() =>
    convex.query(api.projects.getByOrgAndNumber, { organizationId, projectNumber: trimmed }),
  );
  return { available: !clash || clash.id === excludeProjectId };
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

  // Duplicate-code integrity guard. createProject enforces the
  // @@unique([organizationId, projectNumber]) invariant at insert, but the edit
  // path patched projectNumber blindly — editing a code to one a sibling already
  // uses silently produced two projects sharing a number. Only check when the
  // number actually changes. (The wizard also checks availability up-front via
  // checkProjectNumberAvailable for an inline field error; this catches the edit
  // race and any non-wizard caller, and feeds the API error envelope.)
  if (parsed.projectNumber && before && parsed.projectNumber !== before.projectNumber) {
    const dupCheck = await getConvexClient();
    const clash = await withConvexReadRetry(() =>
      dupCheck.query(api.projects.getByOrgAndNumber, {
        organizationId,
        projectNumber: parsed.projectNumber!,
      }),
    );
    if (clash && clash.id !== id) {
      throw new UserFacingError({
        code: "DUPLICATE_PROJECT_CODE",
        title: "Project code already in use",
        message: `A ${before.isTemplate ? "template" : "project"} with code "${parsed.projectNumber}" already exists.`,
        field: "projectNumber",
      });
    }
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
  // RBAC + patch/clear + UPDATE audit atomic. Zod validation stays above;
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

  // Recalculate totals if tax rate changed. Best-effort: the project patch already
  // committed, so a transient recalc failure must not reject an otherwise-successful
  // update (that surfaced as the spurious "Server Components render" error). Totals
  // are derived and self-heal on the next line-item write / recalc.
  if (parsed.taxRate !== undefined) {
    try {
      await recalculateProjectTotals(id);
    } catch (e) {
      console.error("post-update recalc failed (non-fatal):", e);
    }
  }

  const updated = await getProjectByIdMapped(id, organizationId);
  if (!updated) throw new Error("Project update failed");

  return serialize(updated);
}

/**
 * Map a ConvexError thrown by duplicateNative / saveAsTemplateNative back to the
 * rich UserFacingError the legacy server path threw, so the toast UX is identical.
 * Handles the NOT_FOUND (source gone) + DUPLICATE_PROJECT_CODE (number clash) codes.
 */
function mapProjectCopyError(e: unknown, isTemplate: boolean): unknown {
  if (
    e instanceof ConvexError &&
    e.data &&
    typeof e.data === "object" &&
    "code" in e.data &&
    typeof (e.data as { code: unknown }).code === "string"
  ) {
    const code = (e.data as { code: string }).code;
    const message =
      typeof (e.data as { message?: unknown }).message === "string"
        ? (e.data as { message: string }).message
        : undefined;
    if (code === "NOT_FOUND") {
      return new UserFacingError({
        code: "NOT_FOUND",
        title: "Project not found",
        message: "This project was deleted or moved. Refresh the page to see the latest state.",
      });
    }
    if (code === "DUPLICATE_PROJECT_CODE") {
      return new UserFacingError({
        code,
        title: isTemplate ? "Template code already in use" : "Project code already in use",
        message: message ?? `A ${isTemplate ? "template" : "project"} with that code already exists.`,
        field: "projectNumber",
      });
    }
  }
  return e;
}

export async function duplicateProject(sourceId: string, newProjectNumber: string, newName: string) {
  const { organizationId, userId, userName } = await requirePermission("project", "create");

  const client = await getConvexClient();

  // The entire deep-copy (categories → groups → line items → PMs → recalc)
  // runs in ONE atomic mutation instead of N sequential server→Convex round-trips.
  const newProjectId = createId();
  const orgDefaultTaxRate = await readOrgDefaultTaxRate(organizationId);
  try {
    await client.mutation(api.projectWrites.duplicateNative, {
      sourceId,
      newId: newProjectId,
      newProjectNumber,
      newName,
      orgId: organizationId,
      orgDefaultTaxRate,
      now: Date.now(),
      actor: { userId, userName },
      auditId: createId(),
    });
  } catch (e) {
    throw mapProjectCopyError(e, false);
  }
  const nativeResult = await getProjectByIdMapped(newProjectId, organizationId);
  if (!nativeResult) throw new Error("Project duplicate failed");
  return serialize(nativeResult);
}

export async function saveAsTemplate(projectId: string, templateName: string) {
  const { organizationId, userId, userName } = await requirePermission("project", "create");

  // Create the template + copy its line items (grouping OMITTED) + recalc in
  // ONE atomic mutation. generateTemplateCode stays server-side (Convex-mirror count).
  const templateId = createId();
  const templateNumber = await generateTemplateCode(organizationId);
  const orgDefaultTaxRate = await readOrgDefaultTaxRate(organizationId);
  const client = await getConvexClient();
  try {
    await client.mutation(api.projectWrites.saveAsTemplateNative, {
      sourceId: projectId,
      newId: templateId,
      templateNumber,
      templateName,
      orgId: organizationId,
      orgDefaultTaxRate,
      now: Date.now(),
      actor: { userId, userName },
    });
  } catch (e) {
    throw mapProjectCopyError(e, true);
  }
  const nativeResult = await getProjectByIdMapped(templateId, organizationId);
  if (!nativeResult) throw new Error("Template create failed");
  return serialize(nativeResult);
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

  // The full delete cascade runs atomically INSIDE Convex (deleteNative): it frees
  // checked-out assets/kits (+ kit-serialized members) through the counter-safe
  // path, cascades every line item + its units, deletes crew assignments (→ shifts
  // + time entries), managers/tasks/services, grouping, the projectModelRevenues
  // rollup, then the project row + DELETE audit — in ONE round-trip, no orphan
  // window. The CANCELLED + non-template guards are re-checked there. We only
  // resolve the org default location to pass through (mirrors getDefaultLocation).
  const defaultLocation = await getDefaultLocation(organizationId);
  await convex.mutation(api.projectWrites.deleteNative, {
    id,
    orgId: organizationId,
    defaultLocationId: defaultLocation?.id ?? null,
    actor: { userId, userName },
    auditId: createId(),
    now: Date.now(),
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
