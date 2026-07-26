import { getConvexClient } from "@/lib/convex-client";
import { api } from "../../convex/_generated/api";
import type { Doc } from "../../convex/_generated/dataModel";
import { getCrewRoleMap, getCrewMemberMap } from "@/lib/crew-read";
import { resolveRate } from "../../convex/lib/crewRate";

/**
 * Server-side read helpers for the project-services domain (Phase A read-rewiring
 * of the Convex domain-only decommission). `projectService` is dual-written via
 * `syncProjectServicesToConvex` (src/lib/project-subtable-mirror.ts); `serviceTemplate`
 * via src/lib/template-mirror.ts. These helpers read the Convex copy and reshape it
 * into the Prisma-row form the services UI expects (epoch-ms → Date, absent
 * optionals → null, Prisma-defaulted columns coerced).
 *
 * Cross-domain crew joins (crewRole, crewMember) attach via the crew-read maps;
 * crew assignment summaries come from crewAssignments.listByServiceIds (one round
 * trip). No Prisma fallback on a Convex miss → null/empty. See FEATUREDOCS/54.
 */

type RawService = Doc<"projectServices">;
type RawTemplate = Doc<"serviceTemplates">;
type RawAssignment = Doc<"crewAssignments">;

const toDate = (v: number | undefined): Date | null => (typeof v === "number" ? new Date(v) : null);
const orNull = <T>(v: T | undefined): T | null => (v === undefined ? null : v);
const req = <T>(v: T | undefined): T => v as T;

// ─── Row shapes (mirror the Prisma include shapes the UI consumes) ───────────

export interface ServiceCrewRole {
  id: string;
  name: string;
  color: string | null;
}

export interface ServiceCrewMember {
  id: string;
  firstName: string;
  lastName: string;
  image: string | null;
}

export interface ServiceCrewAssignment {
  id: string;
  status: string | null;
  /** Present in getProjectServices, absent (always null) in getProjectServiceById. */
  estimatedCost: number | null;
  crewMember: ServiceCrewMember | null;
  /** Rate-cascade inputs (issue #796 per-crew rate table) — the row's own override,
   *  if set, plus the resolved rate/type the SAME cascade (convex/lib/crewRate.ts)
   *  would produce, so the UI can show "$X/day (from role default)" without
   *  re-implementing the cascade. */
  rateOverride: number | null;
  rateType: string | null;
  estimatedHours: number | null;
  resolvedRate: number;
  resolvedRateType: string;
}

export interface ProjectServiceRow {
  id: string;
  organizationId: string;
  projectId: string;
  type: string;
  title: string;
  description: string | null;
  notes: string | null;
  date: Date | null;
  endDate: Date | null;
  startTime: string | null;
  endTime: string | null;
  scheduledTime: string | null;
  estimatedDuration: number | null;
  address: string | null;
  latitude: number | null;
  longitude: number | null;
  status: string;
  showOnDocuments: boolean;
  billableToClient: boolean;
  unitPrice: number | null;
  quantity: number;
  pricingType: string | null;
  duration: number | null;
  discount: number | null;
  lineTotal: number | null;
  costTotal: number | null;
  /** Per-service override of the crew charge-rate cascade (WS10 #949) — see
   *  convex/schema.ts's projectServices.chargeRateOverride comment. */
  chargeRateOverride: number | null;
  /** Auto-computed sum of the resolved crew charge rate (pre-discount) — feeds
   *  `lineTotal` when `unitPrice` is unset. null = no charge rate configured
   *  anywhere for this service's crew (margin hidden, not a fake 0%). */
  crewChargeTotal: number | null;
  taxable: boolean;
  lineItemId: string | null;
  vehicleDescription: string | null;
  numberOfTrips: number | null;
  crewCountRequired: number | null;
  crewRoleId: string | null;
  sortOrder: number;
  createdAt: Date | null;
  updatedAt: Date | null;
  crewRole: ServiceCrewRole | null;
  crewAssignments: ServiceCrewAssignment[];
}

export interface ServiceTemplateRow {
  id: string;
  organizationId: string;
  type: string;
  title: string;
  description: string | null;
  defaultCrewCount: number | null;
  defaultVehicle: string | null;
  defaultPricingType: string | null;
  defaultUnitPrice: number | null;
  showOnDocuments: boolean;
  isAutoAdded: boolean;
  isActive: boolean;
  sortOrder: number;
  createdAt: Date | null;
  updatedAt: Date | null;
}

export interface ProjectServicesSummary {
  chargeTotal: number;
  costTotal: number;
  serviceCount: number;
}

// ─── Mappers ─────────────────────────────────────────────────────────────────

/** Maps a Convex projectServices doc to the base service row (no crew joins). */
export function mapProjectServiceBase(
  d: RawService,
): Omit<ProjectServiceRow, "crewRole" | "crewAssignments"> {
  return {
    id: d.id,
    organizationId: req(d.organizationId),
    projectId: req(d.projectId),
    type: req(d.type),
    title: req(d.title),
    description: orNull(d.description),
    notes: orNull(d.notes),
    date: toDate(d.date),
    endDate: toDate(d.endDate),
    startTime: orNull(d.startTime),
    endTime: orNull(d.endTime),
    scheduledTime: orNull(d.scheduledTime),
    estimatedDuration: orNull(d.estimatedDuration),
    address: orNull(d.address),
    latitude: orNull(d.latitude),
    longitude: orNull(d.longitude),
    status: d.status ?? "PLANNED",
    showOnDocuments: d.showOnDocuments ?? false,
    billableToClient: d.billableToClient ?? false,
    unitPrice: orNull(d.unitPrice),
    quantity: d.quantity ?? 1,
    pricingType: orNull(d.pricingType),
    duration: orNull(d.duration),
    discount: orNull(d.discount),
    lineTotal: orNull(d.lineTotal),
    costTotal: orNull(d.costTotal),
    chargeRateOverride: orNull(d.chargeRateOverride),
    crewChargeTotal: orNull(d.crewChargeTotal),
    taxable: d.taxable ?? true,
    lineItemId: orNull(d.lineItemId),
    vehicleDescription: orNull(d.vehicleDescription),
    numberOfTrips: orNull(d.numberOfTrips),
    crewCountRequired: orNull(d.crewCountRequired),
    crewRoleId: orNull(d.crewRoleId),
    sortOrder: d.sortOrder ?? 0,
    createdAt: toDate(d.createdAt),
    updatedAt: toDate(d.updatedAt),
  };
}

export function mapServiceTemplate(d: RawTemplate): ServiceTemplateRow {
  return {
    id: d.id,
    organizationId: req(d.organizationId),
    type: req(d.type),
    title: req(d.title),
    description: orNull(d.description),
    defaultCrewCount: orNull(d.defaultCrewCount),
    defaultVehicle: orNull(d.defaultVehicle),
    defaultPricingType: orNull(d.defaultPricingType),
    defaultUnitPrice: orNull(d.defaultUnitPrice),
    showOnDocuments: d.showOnDocuments ?? false,
    isAutoAdded: d.isAutoAdded ?? false,
    isActive: d.isActive ?? true,
    sortOrder: d.sortOrder ?? 0,
    createdAt: toDate(d.createdAt),
    updatedAt: toDate(d.updatedAt),
  };
}

// ─── Pure filter / sort / attach (unit-tested) ───────────────────────────────

/**
 * Postgres `ORDER BY date ASC, sortOrder ASC` — ASC puts NULLs LAST. Tie-break by
 * sortOrder (Prisma-defaulted to 0, so never null in practice). Pure + stable.
 */
export function compareServiceByDateThenSort(
  a: { date: Date | null; sortOrder: number },
  b: { date: Date | null; sortOrder: number },
): number {
  const at = a.date ? a.date.getTime() : null;
  const bt = b.date ? b.date.getTime() : null;
  if (at !== bt) {
    if (at === null) return 1; // NULLS LAST
    if (bt === null) return -1;
    return at - bt;
  }
  return (a.sortOrder ?? 0) - (b.sortOrder ?? 0);
}

/** getProjectServicesSummary scope: services whose status is not CANCELLED. */
export function isNotCancelled(s: { status: string }): boolean {
  return (s.status ?? "PLANNED") !== "CANCELLED";
}

/**
 * Attach crewRole (from the role map) + crewAssignments (grouped from the flat
 * listByServiceIds result) onto a base service row.
 *
 * @param withEstimatedCost — getProjectServices includes estimatedCost on each
 *   assignment; getProjectServiceById does not (always null there).
 */
export function attachServiceCrew(
  base: Omit<ProjectServiceRow, "crewRole" | "crewAssignments">,
  assignments: RawAssignment[],
  roleMap: Map<string, Doc<"crewRoles">>,
  memberMap: Map<string, Doc<"crewMembers">>,
  withEstimatedCost: boolean,
): ProjectServiceRow {
  const role = base.crewRoleId ? roleMap.get(base.crewRoleId) : undefined;
  const crewRole: ServiceCrewRole | null = role
    ? { id: role.id, name: role.name, color: orNull(role.color) }
    : null;

  const crewAssignments: ServiceCrewAssignment[] = assignments.map((a) => {
    const member = memberMap.get(a.crewMemberId);
    const assignmentRole = (a.crewRoleId ? roleMap.get(a.crewRoleId) : undefined) ?? role;
    const { rate, rateType } = resolveRate(
      a.rateOverride,
      a.rateType ?? null,
      { defaultDayRate: member?.defaultDayRate, defaultHourlyRate: member?.defaultHourlyRate },
      assignmentRole ? { defaultRate: assignmentRole.defaultRate, rateType: assignmentRole.rateType } : null,
    );
    return {
      id: a.id,
      status: orNull(a.status),
      estimatedCost: withEstimatedCost ? orNull(a.estimatedCost) : null,
      crewMember: member
        ? {
            id: member.id,
            firstName: member.firstName,
            lastName: member.lastName,
            image: orNull(member.image),
          }
        : null,
      rateOverride: orNull(a.rateOverride),
      rateType: orNull(a.rateType),
      estimatedHours: orNull(a.estimatedHours),
      resolvedRate: rate,
      resolvedRateType: rateType,
    };
  });

  return { ...base, crewRole, crewAssignments };
}

// ─── Fetchers ────────────────────────────────────────────────────────────────

/**
 * Project services for a project (org-scoped), with crewRole + crewAssignments
 * attached, ordered by [date asc NULLS LAST, sortOrder asc].
 */
export async function getProjectServicesFromConvex(
  orgId: string,
  projectId: string,
): Promise<ProjectServiceRow[]> {
  const client = await getConvexClient();
  const raw = (await client.query(api.projectServices.listByProject, {
    projectId,
    orgId,
  })) as RawService[];

  const serviceIds = raw.map((s) => s.id);
  const [assignments, roleMap, memberMap] = await Promise.all([
    serviceIds.length > 0
      ? (client.query(api.crewAssignments.listByServiceIds, {
          serviceIds,
          orgId,
        }) as Promise<RawAssignment[]>)
      : Promise.resolve([] as RawAssignment[]),
    getCrewRoleMap(orgId),
    getCrewMemberMap(orgId),
  ]);

  const byService = groupAssignmentsByService(assignments);

  const rows = raw.map((d) =>
    attachServiceCrew(
      mapProjectServiceBase(d),
      byService.get(d.id) ?? [],
      roleMap,
      memberMap,
      true,
    ),
  );
  rows.sort(compareServiceByDateThenSort);
  return rows;
}

/** Group a flat listByServiceIds result by serviceId. */
export function groupAssignmentsByService(
  assignments: RawAssignment[],
): Map<string, RawAssignment[]> {
  const map = new Map<string, RawAssignment[]>();
  for (const a of assignments) {
    if (a.serviceId == null) continue;
    const arr = map.get(a.serviceId);
    if (arr) arr.push(a);
    else map.set(a.serviceId, [a]);
  }
  return map;
}

/**
 * One project service by id, org-checked in JS. Throws "Service not found" if the
 * doc is absent or belongs to another org. crewAssignments here have no
 * estimatedCost (always null), mirroring the Prisma select.
 */
export async function getProjectServiceByIdFromConvex(
  orgId: string,
  id: string,
): Promise<ProjectServiceRow> {
  const client = await getConvexClient();
  const doc = (await client.query(api.projectServices.getById, {
    id,
  })) as RawService | null;
  if (!doc || doc.organizationId !== orgId) throw new Error("Service not found");

  const [assignments, roleMap, memberMap] = await Promise.all([
    client.query(api.crewAssignments.listByServiceIds, {
      serviceIds: [id],
      orgId,
    }) as Promise<RawAssignment[]>,
    getCrewRoleMap(orgId),
    getCrewMemberMap(orgId),
  ]);

  return attachServiceCrew(
    mapProjectServiceBase(doc),
    assignments,
    roleMap,
    memberMap,
    false,
  );
}

/** Service templates for an org, ordered by sortOrder asc. */
export async function getServiceTemplatesFromConvex(
  orgId: string,
): Promise<ServiceTemplateRow[]> {
  const client = await getConvexClient();
  const raw = (await client.query(api.serviceTemplates.list, {
    orgId,
  })) as RawTemplate[];
  return raw.map(mapServiceTemplate).sort((a, b) => a.sortOrder - b.sortOrder);
}

/**
 * Financial summary over a project's non-CANCELLED services. Mirrors the Prisma
 * findMany(status != CANCELLED) → sum(lineTotal)/sum(costTotal)/count.
 */
export async function getProjectServicesSummaryFromConvex(
  orgId: string,
  projectId: string,
): Promise<ProjectServicesSummary> {
  const client = await getConvexClient();
  const raw = (await client.query(api.projectServices.listByProject, {
    projectId,
    orgId,
  })) as RawService[];

  const active = raw.map(mapProjectServiceBase).filter(isNotCancelled);

  let chargeTotal = 0;
  let costTotal = 0;
  for (const s of active) {
    chargeTotal += s.lineTotal ? Number(s.lineTotal) : 0;
    costTotal += s.costTotal ? Number(s.costTotal) : 0;
  }

  return { chargeTotal, costTotal, serviceCount: active.length };
}
