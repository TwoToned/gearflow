import { getConvexClient, withConvexReadRetry } from "@/lib/convex-client";
import { api } from "../../convex/_generated/api";
import type { Doc } from "../../convex/_generated/dataModel";
import type { ProjectStatus, ProjectType, RentalPeriod } from "@/generated/prisma/client";
import { getProjectWindow } from "@/lib/project-window";

export type ConvexProject = Doc<"projects">;
export type ConvexProjectService = Doc<"projectServices">;
export type ConvexCrewAssignment = Doc<"crewAssignments">;

export async function getProjectsByOrg(orgId: string): Promise<ConvexProject[]> {
  // Wrapped in withConvexReadRetry (like every other read domain): a transient
  // Convex blip — cold start, JWKS hiccup, service-token refresh boundary — must
  // not take down the projects list or reject an already-committed write via its
  // post-commit read-back. Reads are idempotent, so one retry absorbs the blip.
  return withConvexReadRetry(async () => (await getConvexClient()).query(api.projects.list, { orgId }));
}

export async function getProjectById(id: string): Promise<ConvexProject | null> {
  // See getProjectsByOrg — this is the read-back used by every project write
  // action (via getProjectByIdMapped); an unretried blip here is what surfaced as
  // the spurious "Server Components render" error after a successful create/update.
  return withConvexReadRetry(async () => (await getConvexClient()).query(api.projects.getById, { id }));
}

// ─── Prisma-row-shaped mapping (for consumers that read the project scalars) ─────
// epoch-ms → Date, Decimal → number, absent optional → null, Prisma defaults
// coerced non-null. Cross-domain joins (client/location/managers/services/lineItems)
// are composed by the caller from their own Convex reads.

const toDate = (v: number | undefined): Date | null => (typeof v === "number" ? new Date(v) : null);
const orNull = <T>(v: T | undefined): T | null => (v === undefined ? null : v);

export interface ProjectRow {
  id: string;
  organizationId: string;
  projectNumber: string;
  name: string;
  clientId: string | null;
  status: ProjectStatus;
  type: ProjectType;
  description: string | null;
  locationId: string | null;
  siteContactName: string | null;
  siteContactPhone: string | null;
  siteContactEmail: string | null;
  loadInDate: Date | null;
  loadInTime: string | null;
  eventStartDate: Date | null;
  eventStartTime: string | null;
  eventEndDate: Date | null;
  eventEndTime: string | null;
  loadOutDate: Date | null;
  loadOutTime: string | null;
  /** WS2 (#941) — the gear-committed window; falls back to rental* when unset.
   *  Use `getProjectWindow` to resolve, don't read these raw for availability. */
  projectStartDate: Date | null;
  projectStartTime: string | null;
  projectEndDate: Date | null;
  projectEndTime: string | null;
  rentalStartDate: Date | null;
  rentalEndDate: Date | null;
  projectManagerId: string | null;
  defaultRentalPeriod: RentalPeriod | null;
  defaultRentalQuantity: number | null;
  taxRate: number | null;
  equipmentRevenue: number | null;
  serviceCostTotal: number | null;
  labourCostTotal: number | null;
  subHireCostTotal: number | null;
  margin: number | null;
  crewNotes: string | null;
  internalNotes: string | null;
  clientNotes: string | null;
  subtotal: number | null;
  discountPercent: number | null;
  discountAmount: number | null;
  taxAmount: number | null;
  total: number | null;
  depositPercent: number | null;
  depositPaid: number | null;
  invoicedTotal: number | null;
  tags: string[];
  isTemplate: boolean;
  createdAt: Date | null;
  updatedAt: Date | null;
}

export function mapProject(d: ConvexProject): ProjectRow {
  return {
    id: d.id,
    organizationId: d.organizationId,
    projectNumber: d.projectNumber,
    name: d.name,
    clientId: orNull(d.clientId),
    status: (d.status ?? "ENQUIRY") as ProjectStatus,
    type: (d.type ?? "OTHER") as ProjectType,
    description: orNull(d.description),
    locationId: orNull(d.locationId),
    siteContactName: orNull(d.siteContactName),
    siteContactPhone: orNull(d.siteContactPhone),
    siteContactEmail: orNull(d.siteContactEmail),
    loadInDate: toDate(d.loadInDate),
    loadInTime: orNull(d.loadInTime),
    eventStartDate: toDate(d.eventStartDate),
    eventStartTime: orNull(d.eventStartTime),
    eventEndDate: toDate(d.eventEndDate),
    eventEndTime: orNull(d.eventEndTime),
    loadOutDate: toDate(d.loadOutDate),
    loadOutTime: orNull(d.loadOutTime),
    projectStartDate: toDate(d.projectStartDate),
    projectStartTime: orNull(d.projectStartTime),
    projectEndDate: toDate(d.projectEndDate),
    projectEndTime: orNull(d.projectEndTime),
    rentalStartDate: toDate(d.rentalStartDate),
    rentalEndDate: toDate(d.rentalEndDate),
    projectManagerId: orNull(d.projectManagerId),
    defaultRentalPeriod: orNull(d.defaultRentalPeriod) as RentalPeriod | null,
    defaultRentalQuantity: orNull(d.defaultRentalQuantity),
    taxRate: orNull(d.taxRate),
    equipmentRevenue: orNull(d.equipmentRevenue),
    serviceCostTotal: orNull(d.serviceCostTotal),
    labourCostTotal: orNull(d.labourCostTotal),
    subHireCostTotal: orNull(d.subHireCostTotal),
    margin: orNull(d.margin),
    crewNotes: orNull(d.crewNotes),
    internalNotes: orNull(d.internalNotes),
    clientNotes: orNull(d.clientNotes),
    subtotal: orNull(d.subtotal),
    discountPercent: orNull(d.discountPercent),
    discountAmount: orNull(d.discountAmount),
    taxAmount: orNull(d.taxAmount),
    total: orNull(d.total),
    depositPercent: orNull(d.depositPercent),
    depositPaid: orNull(d.depositPaid),
    invoicedTotal: orNull(d.invoicedTotal),
    tags: d.tags ?? [],
    isTemplate: d.isTemplate ?? false,
    createdAt: toDate(d.createdAt),
    updatedAt: toDate(d.updatedAt),
  };
}

/** All org projects, Prisma-row-shaped. */
export async function getProjectsByOrgMapped(orgId: string): Promise<ProjectRow[]> {
  return (await getProjectsByOrg(orgId)).map(mapProject);
}

/** One project, Prisma-row-shaped (null if missing / wrong org). */
export async function getProjectByIdMapped(id: string, orgId: string): Promise<ProjectRow | null> {
  const d = await getProjectById(id);
  return d && d.organizationId === orgId ? mapProject(d) : null;
}

/** Returns the set of projectIds where userId appears as a project manager. */
export async function getProjectIdsForManager(orgId: string, userId: string): Promise<Set<string>> {
  const entries = await withConvexReadRetry(async () =>
    (await getConvexClient()).query(api.projectManagers.listByUserId, { userId, orgId }),
  );
  return new Set(entries.map((e) => e.projectId));
}

/** Convert an optional epoch-ms field to a Date (serialize keeps Date), else null. */
function epochToDate(ms: number | undefined | null): Date | null {
  return ms == null ? null : new Date(ms);
}

/**
 * Project milestone dates used by the call-sheet date picker. Replaces the
 * scalar-only `prisma.project.findUnique(... select dates ...)` read — the
 * `project` row is dual-written to Convex, so these come from the Convex doc.
 * Epoch-ms is converted back to `Date` because `serialize()` round-trips Dates.
 *
 * WS2 (#941) — collapsed from the four load/event moments to WINDOW (the
 * resolved project window via `getProjectWindow` — falls back to rental when
 * unset) + RENTAL (the raw chargeable dates, kept as a distinct fallback so a
 * project whose only dates are rental ones still offers those days).
 */
export type CallSheetMilestoneDates = {
  windowStart: Date | null;
  windowEnd: Date | null;
  rentalStartDate: Date | null;
  rentalEndDate: Date | null;
};

export function mapCallSheetMilestoneDates(project: ConvexProject): CallSheetMilestoneDates {
  const window = getProjectWindow(project);
  return {
    windowStart: epochToDate(window.start ?? undefined),
    windowEnd: epochToDate(window.end ?? undefined),
    rentalStartDate: epochToDate(project.rentalStartDate),
    rentalEndDate: epochToDate(project.rentalEndDate),
  };
}

export type CallSheetServiceDate = { date: Date; crewCount: number };

/**
 * Pure replacement for the Prisma `projectService.findMany({ where: status !=
 * CANCELLED, select: { date, _count: { crewAssignments } }, orderBy: date asc })`
 * read, plus its dropped-null filter at the call site. Replicates exactly:
 *   - drop services whose `status === "CANCELLED"` (Prisma `where`)
 *   - drop services with no `date` (the call site's `.filter(s => s.date != null)`)
 *   - `crewCount` = number of crew assignments whose `serviceId` matches the
 *     service (Prisma `_count: { crewAssignments }`, the per-service relation count)
 *   - order ascending by `date` (Prisma `orderBy: { date: "asc" }`)
 * Epoch-ms `date` is converted back to a `Date`.
 */
export function buildCallSheetServiceDates(
  services: ConvexProjectService[],
  assignments: ConvexCrewAssignment[],
): CallSheetServiceDate[] {
  const countByServiceId = new Map<string, number>();
  for (const a of assignments) {
    if (a.serviceId == null) continue;
    countByServiceId.set(a.serviceId, (countByServiceId.get(a.serviceId) ?? 0) + 1);
  }
  return services
    .filter((s) => s.status !== "CANCELLED" && s.date != null)
    .sort((a, b) => (a.date ?? 0) - (b.date ?? 0))
    .map((s) => ({
      date: new Date(s.date as number),
      crewCount: countByServiceId.get(s.id) ?? 0,
    }));
}

/**
 * Convex fetchers for the call-sheet date picker: the project milestone dates +
 * its (non-cancelled, dated) services with per-service crew counts. Mirrors the
 * old `getCallSheetDates` Prisma reads. Returns `null` when the project is
 * missing (no Prisma fallback — a miss means the row isn't mirrored / was
 * deleted, exactly like a join against a deleted row).
 */
export async function getCallSheetData(
  orgId: string,
  projectId: string,
): Promise<{ milestones: CallSheetMilestoneDates; serviceDates: CallSheetServiceDate[] } | null> {
  const [project, services, assignments] = await withConvexReadRetry(async () => {
    const client = await getConvexClient();
    return Promise.all([
      client.query(api.projects.getById, { id: projectId }),
      client.query(api.projectServices.listByProject, { projectId, orgId }),
      client.query(api.crewAssignments.listByProject, { projectId, orgId }),
    ]);
  });
  if (!project || project.organizationId !== orgId) return null;
  return {
    milestones: mapCallSheetMilestoneDates(project),
    serviceDates: buildCallSheetServiceDates(services, assignments),
  };
}
