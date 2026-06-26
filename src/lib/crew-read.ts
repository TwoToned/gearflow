import { getConvexClient } from "@/lib/convex-client";
import type { FilterValue } from "@/lib/table-utils";
import type {
  CrewMemberType,
  CrewMemberStatus,
  CrewRateType,
} from "@/generated/prisma/enums";
import { api } from "../../convex/_generated/api";
import type { Doc } from "../../convex/_generated/dataModel";

/**
 * Server-side read helpers for the crew roster (Phase 3 cutover + Phase A
 * read-rewiring).
 *
 * crew_member / crew_role / crew_skill are dual-written (Prisma FK anchor + Convex
 * reactive doc — see src/lib/crew-mirror.ts). Reads that want the Convex copy go
 * through these helpers; cross-domain joins onto crew (e.g. assignment → member,
 * which still live in Prisma) attach via the maps. The project-coupled crew
 * sub-tables (assignment / availability / time entry) stay Prisma-only for now,
 * as does the implicit `_CrewMemberToCrewSkill` m2m and the Better Auth member /
 * User join. See FEATUREDOCS/54.
 *
 * Mappers below reverse src/lib/convex-client.ts `toConvexDoc`: it stores
 * Date → epoch-ms, Decimal → number, and OMITS null/undefined Prisma fields.
 * So mappers convert epoch-ms → Date, coerce absent → null, and coerce
 * Prisma-defaulted columns (type/status/tags/icalEnabled/isActive/sortOrder/
 * createdAt/updatedAt) to their schema defaults. The output shape matches
 * `serialize(<prisma row>)` (which keeps Date instances).
 */
export type ConvexCrewMember = Doc<"crewMembers">;
export type ConvexCrewRole = Doc<"crewRoles">;
export type ConvexCrewSkill = Doc<"crewSkills">;

// ─── Fetchers (raw Convex docs) ──────────────────────────────────────────────

export async function getCrewMemberById(id: string): Promise<ConvexCrewMember | null> {
  return await (await getConvexClient()).query(api.crewMembers.getById, { id });
}

export async function getCrewMembersByOrg(orgId: string): Promise<ConvexCrewMember[]> {
  return await (await getConvexClient()).query(api.crewMembers.list, { orgId });
}

export async function getCrewRolesByOrg(orgId: string): Promise<ConvexCrewRole[]> {
  return await (await getConvexClient()).query(api.crewRoles.list, { orgId });
}

export async function getCrewRoleById(id: string): Promise<ConvexCrewRole | null> {
  return await (await getConvexClient()).query(api.crewRoles.getById, { id });
}

export async function getCrewSkillsByOrg(orgId: string): Promise<ConvexCrewSkill[]> {
  return await (await getConvexClient()).query(api.crewSkills.list, { orgId });
}

/** All of an org's crew members keyed by cuid `id`, for attaching to joined rows. */
export async function getCrewMemberMap(orgId: string): Promise<Map<string, ConvexCrewMember>> {
  const all = await getCrewMembersByOrg(orgId);
  return new Map(all.map((m) => [m.id, m]));
}

/** All of an org's crew roles keyed by cuid `id`. */
export async function getCrewRoleMap(orgId: string): Promise<Map<string, ConvexCrewRole>> {
  const all = await getCrewRolesByOrg(orgId);
  return new Map(all.map((r) => [r.id, r]));
}

// ─── Mapped row shapes (match serialize(<prisma row>)) ───────────────────────

const epochToDate = (ms: number | undefined, fallback: Date): Date =>
  ms == null ? fallback : new Date(ms);

export type CrewMemberRow = {
  id: string;
  organizationId: string;
  firstName: string;
  lastName: string;
  email: string | null;
  phone: string | null;
  image: string | null;
  userId: string | null;
  type: CrewMemberType;
  status: CrewMemberStatus;
  department: string | null;
  defaultDayRate: number | null;
  defaultHourlyRate: number | null;
  overtimeMultiplier: number | null;
  currency: string | null;
  address: string | null;
  addressLatitude: number | null;
  addressLongitude: number | null;
  emergencyContactName: string | null;
  emergencyContactPhone: string | null;
  dateOfBirth: Date | null;
  abnOrGst: string | null;
  notes: string | null;
  tags: string[];
  icalEnabled: boolean;
  icalToken: string | null;
  crewRoleId: string | null;
  createdAt: Date;
  updatedAt: Date;
  isActive: boolean;
};

export type CrewRoleRow = {
  id: string;
  organizationId: string;
  name: string;
  description: string | null;
  department: string | null;
  color: string | null;
  defaultRate: number | null;
  rateType: CrewRateType | null;
  sortOrder: number;
  isActive: boolean;
};

export type CrewSkillRow = {
  id: string;
  organizationId: string;
  name: string;
  category: string | null;
};

/**
 * Map a raw Convex crewMembers doc to the Prisma-shaped row. Strips `_id` /
 * `_creationTime`; epoch-ms → Date; absent → null; Prisma-defaulted columns
 * (type/status/tags/icalEnabled/isActive/createdAt/updatedAt) coerced non-null.
 */
export function mapCrewMember(d: ConvexCrewMember): CrewMemberRow {
  return {
    id: d.id,
    organizationId: d.organizationId,
    firstName: d.firstName,
    lastName: d.lastName,
    email: d.email ?? null,
    phone: d.phone ?? null,
    image: d.image ?? null,
    userId: d.userId ?? null,
    type: d.type ?? "FREELANCER",
    status: d.status ?? "ACTIVE",
    department: d.department ?? null,
    defaultDayRate: d.defaultDayRate ?? null,
    defaultHourlyRate: d.defaultHourlyRate ?? null,
    overtimeMultiplier: d.overtimeMultiplier ?? null,
    currency: d.currency ?? null,
    address: d.address ?? null,
    addressLatitude: d.addressLatitude ?? null,
    addressLongitude: d.addressLongitude ?? null,
    emergencyContactName: d.emergencyContactName ?? null,
    emergencyContactPhone: d.emergencyContactPhone ?? null,
    dateOfBirth: d.dateOfBirth == null ? null : new Date(d.dateOfBirth),
    abnOrGst: d.abnOrGst ?? null,
    notes: d.notes ?? null,
    tags: d.tags ?? [],
    icalEnabled: d.icalEnabled ?? false,
    icalToken: d.icalToken ?? null,
    crewRoleId: d.crewRoleId ?? null,
    createdAt: epochToDate(d.createdAt, new Date(d._creationTime)),
    updatedAt: epochToDate(d.updatedAt, new Date(d._creationTime)),
    isActive: d.isActive ?? true,
  };
}

export function mapCrewRole(d: ConvexCrewRole): CrewRoleRow {
  return {
    id: d.id,
    organizationId: d.organizationId,
    name: d.name,
    description: d.description ?? null,
    department: d.department ?? null,
    color: d.color ?? null,
    defaultRate: d.defaultRate ?? null,
    rateType: d.rateType ?? null,
    sortOrder: d.sortOrder ?? 0,
    isActive: d.isActive ?? true,
  };
}

export function mapCrewSkill(d: ConvexCrewSkill): CrewSkillRow {
  return {
    id: d.id,
    organizationId: d.organizationId,
    name: d.name,
    category: d.category ?? null,
  };
}

// ─── Pure filter / sort / paginate (replicate Prisma where/orderBy) ──────────

/**
 * CrewMemberStatus / CrewMemberType / CrewRateType have no inherent JS ordering;
 * the roster sorts/filters on plain string columns only (lastName etc.), so no
 * enum rank map is needed here. (Departments are free-text strings.)
 */

/** Enum `{ field: { in: [...] } }` filter, replicating buildFilterWhere for the
 *  roster's three enum columns (type / status / department). */
export function applyCrewMemberFilters(
  rows: CrewMemberRow[],
  filters: Record<string, FilterValue> | undefined,
): CrewMemberRow[] {
  if (!filters) return rows;
  const enumCols: Array<keyof CrewMemberRow> = ["type", "status", "department"];
  let out = rows;
  for (const col of enumCols) {
    const value = filters[col as string];
    if (Array.isArray(value) && value.length > 0) {
      const allowed = new Set(value as string[]);
      out = out.filter((r) => {
        const fv = r[col];
        return typeof fv === "string" && allowed.has(fv);
      });
    }
  }
  return out;
}

/** Case-insensitive `contains` OR across firstName/lastName/email/phone/
 *  department + `tags hasSome [search.toLowerCase()]`, replicating getCrewMembers. */
export function applyCrewMemberSearch(rows: CrewMemberRow[], search: string | undefined): CrewMemberRow[] {
  if (!search) return rows;
  const needle = search.toLowerCase();
  const inField = (v: string | null) => v != null && v.toLowerCase().includes(needle);
  return rows.filter(
    (r) =>
      inField(r.firstName) ||
      inField(r.lastName) ||
      inField(r.email) ||
      inField(r.phone) ||
      inField(r.department) ||
      r.tags.some((t) => t === needle),
  );
}

/**
 * Sort by a string/Date/number column. Postgres default ASC = NULLS LAST,
 * DESC = NULLS FIRST. The roster only ever sorts on `lastName` (string) but we
 * support the generic shape the action exposes.
 */
export function sortCrewMembers(
  rows: CrewMemberRow[],
  sortBy: string,
  sortOrder: "asc" | "desc",
): CrewMemberRow[] {
  const dir = sortOrder === "desc" ? -1 : 1;
  const key = sortBy as keyof CrewMemberRow;
  return [...rows].sort((a, b) => {
    const av = a[key] as unknown;
    const bv = b[key] as unknown;
    const aNull = av == null;
    const bNull = bv == null;
    if (aNull && bNull) return 0;
    // ASC → nulls last; DESC → nulls first.
    if (aNull) return sortOrder === "desc" ? -1 : 1;
    if (bNull) return sortOrder === "desc" ? 1 : -1;
    let cmp: number;
    if (av instanceof Date && bv instanceof Date) cmp = av.getTime() - bv.getTime();
    else if (typeof av === "number" && typeof bv === "number") cmp = av - bv;
    else cmp = String(av).localeCompare(String(bv));
    return cmp * dir;
  });
}

/** Slice for 1-based pagination (page/pageSize), matching Prisma skip/take. */
export function paginate<T>(rows: T[], page: number, pageSize: number): T[] {
  const start = (page - 1) * pageSize;
  return rows.slice(start, start + pageSize);
}

/** Distinct non-null departments, ASC (case-sensitive, matching Postgres text
 *  collation closely enough for filter options). */
export function distinctDepartments(rows: CrewMemberRow[]): string[] {
  const set = new Set<string>();
  for (const r of rows) if (r.department) set.add(r.department);
  return [...set].sort((a, b) => a.localeCompare(b));
}

/** Active roles, ordered by [sortOrder asc, name asc] — replicates getCrewRoles /
 *  getCrewRoleOptions orderBy. */
export function activeRolesSorted(rows: CrewRoleRow[]): CrewRoleRow[] {
  return rows
    .filter((r) => r.isActive)
    .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));
}

/** Skills ordered by name asc — replicates getCrewSkills / getCrewSkillOptions. */
export function skillsSorted(rows: CrewSkillRow[]): CrewSkillRow[] {
  return [...rows].sort((a, b) => a.name.localeCompare(b.name));
}

/** Count of members per crewRoleId, replicating crewRole._count.crewMembers. */
export function countMembersByRole(members: CrewMemberRow[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const m of members) {
    if (m.crewRoleId) counts[m.crewRoleId] = (counts[m.crewRoleId] ?? 0) + 1;
  }
  return counts;
}

/**
 * Count of ACTIVE crew members (dashboard stat). Operates on the raw Convex docs
 * from getCrewMembersByOrg. Replicates Prisma
 * `crewMember.count({ where: { status: "ACTIVE" } })`.
 */
export function countActiveCrew(members: ConvexCrewMember[]): number {
  return members.filter((m) => m.status === "ACTIVE").length;
}
