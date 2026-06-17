import { getConvexClient } from "@/lib/convex-client";
import { api } from "../../convex/_generated/api";
import type { Doc } from "../../convex/_generated/dataModel";

/**
 * Server-side read helpers for the brand-template domain (Phase A read-rewiring of
 * the Convex domain-only decommission). `brandTemplate` is dual-written (see
 * src/server/brand-templates.ts + convex/brandTemplates.ts) and backfilled
 * (scripts/convex-backfill-brand-templates.ts). These helpers read the Convex copy
 * and shape it back into the Prisma-row form the branding pages expect (epoch-ms →
 * Date, absent optionals → null, Prisma-defaulted columns coerced).
 *
 * headerSettings/footerSettings are JSON-string columns — passed straight through
 * (the caller JSON.parses them, exactly as the Prisma path did).
 *
 * `getById` is cuid-only in Convex (no org arg) → org-scope is re-applied in JS to
 * match Prisma `findFirst({ where: { id, organizationId } })`. See FEATUREDOCS/54.
 */

type RawBrandTemplate = Doc<"brandTemplates">;
type RawDocumentTemplate = Doc<"documentTemplates">;

const orNull = <T>(v: T | undefined): T | null => (v === undefined ? null : v);
const req = <T>(v: T | undefined): T => v as T;
/** createdAt/updatedAt are non-null Prisma columns → coerce to a non-null Date. */
const reqDate = (v: number | undefined): Date => new Date(req(v));

/** Prisma-row shape for BrandTemplate (matches prisma.brandTemplate). */
export interface BrandTemplateRow {
  id: string;
  organizationId: string;
  name: string;
  headerSettings: string;
  footerSettings: string;
  accentColor: string | null;
  isDefault: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export function mapBrandTemplate(d: RawBrandTemplate): BrandTemplateRow {
  return {
    id: req(d.id),
    organizationId: req(d.organizationId),
    name: req(d.name),
    headerSettings: req(d.headerSettings),
    footerSettings: req(d.footerSettings),
    accentColor: orNull(d.accentColor),
    isDefault: d.isDefault ?? false,
    createdAt: reqDate(d.createdAt),
    updatedAt: reqDate(d.updatedAt),
  };
}

// ─── Pure sort + filter (replicate Prisma where/orderBy) ─────────────────────

/**
 * orderBy [{ isDefault: "desc" }, { name: "asc" }].
 * isDefault desc → defaults (true) first; name asc → plain lexicographic compare
 * (matches Postgres default text collation for the seeded fixtures here).
 */
export function compareBrandTemplatesForList(a: BrandTemplateRow, b: BrandTemplateRow): number {
  if (a.isDefault !== b.isDefault) return a.isDefault ? -1 : 1;
  return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
}

/** Re-apply Prisma `findFirst({ where: { id, organizationId } })` org-scope in JS. */
export function matchesOrg(row: BrandTemplateRow, organizationId: string): boolean {
  return row.organizationId === organizationId;
}

// ─── Convex fetchers ─────────────────────────────────────────────────────────

/** List-view projection row (mirrors the Prisma `select` in getBrandTemplates). */
export interface BrandTemplateListRow {
  id: string;
  name: string;
  accentColor: string | null;
  isDefault: boolean;
  createdAt: Date;
  updatedAt: Date;
  _count: { documentTemplates: number };
}

/**
 * List brand templates for an org with per-template document-template counts,
 * sorted [isDefault desc, name asc]. Replicates getBrandTemplates' Prisma read
 * (findMany + _count.documentTemplates) by counting the org's documentTemplates
 * by brandTemplateId in JS (one extra round trip, both reads org-scoped).
 */
export async function getBrandTemplateListForOrg(orgId: string): Promise<BrandTemplateListRow[]> {
  const convex = await getConvexClient();
  const [brands, docTemplates] = await Promise.all([
    convex.query(api.brandTemplates.list, { orgId }) as Promise<RawBrandTemplate[]>,
    convex.query(api.documentTemplates.list, { orgId }) as Promise<RawDocumentTemplate[]>,
  ]);

  const counts = new Map<string, number>();
  for (const dt of docTemplates) {
    if (dt.brandTemplateId == null) continue;
    counts.set(dt.brandTemplateId, (counts.get(dt.brandTemplateId) ?? 0) + 1);
  }

  return brands
    .map(mapBrandTemplate)
    .sort(compareBrandTemplatesForList)
    .map((b) => ({
      id: b.id,
      name: b.name,
      accentColor: b.accentColor,
      isDefault: b.isDefault,
      createdAt: b.createdAt,
      updatedAt: b.updatedAt,
      _count: { documentTemplates: counts.get(b.id) ?? 0 },
    }));
}

/**
 * Single brand template by cuid, org-scoped in JS (returns null on org mismatch or
 * miss — caller throws). Full row; caller JSON.parses headerSettings/footerSettings.
 */
export async function getBrandTemplateForOrg(
  id: string,
  organizationId: string,
): Promise<BrandTemplateRow | null> {
  const row = (await (await getConvexClient()).query(api.brandTemplates.getById, {
    id,
  })) as RawBrandTemplate | null;
  if (!row) return null;
  const mapped = mapBrandTemplate(row);
  return matchesOrg(mapped, organizationId) ? mapped : null;
}
