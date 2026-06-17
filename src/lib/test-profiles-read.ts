import { getConvexClient, withConvexReadRetry } from "@/lib/convex-client";
import { api } from "../../convex/_generated/api";
import type { Doc } from "../../convex/_generated/dataModel";

/**
 * Server-side read helpers for the test-profile domain (Phase A read-rewiring of
 * the Convex domain-only decommission). `testProfile` is dual-written (inline
 * `api.testProfiles.*` from src/server/test-tag-profiles.ts) and backfilled
 * (scripts/convex-backfill-test-profiles.ts). These helpers read the Convex copy
 * and shape it back into the Prisma-row form the test-profile consumers expect
 * (epoch-ms → Date, absent optionals → null, Prisma-defaulted columns coerced to
 * non-null). The visualChecks/electricalTests/thresholds Json fields are stored as
 * Convex `v.any()` and pass straight through unchanged.
 *
 * Filtering/sorting is replicated in JS (pure, unit-tested) to match the original
 * Prisma `where`/`orderBy`. See FEATUREDOCS/54.
 */

type RawProfile = Doc<"testProfiles">;

const toDate = (v: number | undefined): Date | null =>
  typeof v === "number" ? new Date(v) : null;

/**
 * Prisma-row shape of a TestProfile. Dates are `Date` (serialize() preserves Date),
 * the three Json columns are `unknown` (passed through from Convex `v.any()`), and
 * the Prisma-defaulted scalar columns are non-null.
 */
export interface TestProfileRow {
  id: string;
  organizationId: string;
  name: string;
  equipmentClass: string;
  applianceType: string;
  visualChecks: unknown;
  electricalTests: unknown;
  thresholds: unknown;
  requiresSubTests: boolean;
  defaultSubTestCount: number;
  subTestLabel: string;
  isDefault: boolean;
  isActive: boolean;
  createdAt: Date | null;
  updatedAt: Date | null;
}

/** Map a Convex testProfiles doc to the Prisma TestProfile row shape. */
export function mapTestProfile(d: RawProfile): TestProfileRow {
  return {
    id: d.id,
    organizationId: d.organizationId,
    name: d.name,
    // Prisma defaults: equipmentClass=CLASS_I, applianceType=APPLIANCE.
    equipmentClass: d.equipmentClass ?? "CLASS_I",
    applianceType: d.applianceType ?? "APPLIANCE",
    visualChecks: d.visualChecks,
    electricalTests: d.electricalTests,
    thresholds: d.thresholds,
    // Prisma defaults: false / 1 / "Outlet" / false / true.
    requiresSubTests: d.requiresSubTests ?? false,
    defaultSubTestCount: d.defaultSubTestCount ?? 1,
    subTestLabel: d.subTestLabel ?? "Outlet",
    isDefault: d.isDefault ?? false,
    isActive: d.isActive ?? true,
    createdAt: toDate(d.createdAt),
    updatedAt: toDate(d.updatedAt),
  };
}

export interface TestProfileFilters {
  isActive?: boolean;
  equipmentClass?: string;
  applianceType?: string;
}

/**
 * Pure replica of the Prisma `getTestProfiles` where + orderBy: filter by
 * isActive (default true), optional equipmentClass, optional applianceType; sort
 * by name asc. The org filter is already applied by the Convex `list` query.
 */
export function filterAndSortTestProfiles(
  profiles: TestProfileRow[],
  params?: TestProfileFilters,
): TestProfileRow[] {
  const { isActive = true, equipmentClass, applianceType } = params ?? {};
  return profiles
    .filter((p) => {
      if (isActive !== undefined && p.isActive !== isActive) return false;
      if (equipmentClass && p.equipmentClass !== equipmentClass) return false;
      if (applianceType && p.applianceType !== applianceType) return false;
      return true;
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** Read all test profiles for an org, filtered + sorted (replaces Prisma findMany). */
export async function getTestProfilesFromConvex(
  orgId: string,
  params?: TestProfileFilters,
): Promise<TestProfileRow[]> {
  const rows = await withConvexReadRetry(
    async () =>
      (await (await getConvexClient()).query(api.testProfiles.list, {
        orgId,
      })) as RawProfile[],
  );
  return filterAndSortTestProfiles(rows.map(mapTestProfile), params);
}

/**
 * Read one test profile by cuid, re-applying the Prisma `{ id, organizationId }`
 * org-scope in JS (Convex `getById` is cuid-only). Returns null when the row is
 * missing or belongs to another org — caller decides whether to throw.
 */
export async function getTestProfileFromConvex(
  id: string,
  orgId: string,
): Promise<TestProfileRow | null> {
  const row = await withConvexReadRetry(
    async () =>
      (await (await getConvexClient()).query(api.testProfiles.getById, {
        id,
      })) as RawProfile | null,
  );
  if (!row || row.organizationId !== orgId) return null;
  return mapTestProfile(row);
}
