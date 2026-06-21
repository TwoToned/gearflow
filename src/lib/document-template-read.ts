import { getConvexClient } from "@/lib/convex-client";
import { api } from "../../convex/_generated/api";
import type { Doc } from "../../convex/_generated/dataModel";

/**
 * Server-side read helpers for the document-template domain (Phase A read-rewiring
 * of the Convex domain-only decommission). `documentTemplate` and `brandTemplate`
 * are dual-written infra (mirror helpers in src/lib/template-mirror.ts +
 * src/server/brand-templates.ts, backfill heal path in
 * scripts/convex-backfill-templates.ts, Convex modules convex/documentTemplates.ts
 * + convex/brandTemplates.ts). After the PDF template-builder removal (#227) the
 * document-template *write* surface is gone — these rows are now read-only from the
 * app's perspective, served out of the dual-written Convex copy. These helpers read
 * the Convex copy and shape it back into the Prisma-row form the document-template
 * server actions expect (epoch-ms → Date, absent optionals → null, Prisma-defaulted
 * columns coerced).
 *
 * ONLY the real-DB-row reads convert. The "virtual system-default template"
 * synthesis (ids starting with "system-") stays byte-for-byte in the server actions
 * and simply operates on the converted rows.
 */

type RawDocumentTemplate = Doc<"documentTemplates">;
type RawBrandTemplate = Doc<"brandTemplates">;

const toDate = (v: number | undefined): Date | null => (typeof v === "number" ? new Date(v) : null);
const orNull = <T>(v: T | undefined): T | null => (v === undefined ? null : v);
const req = <T>(v: T | undefined): T => v as T;
/**
 * createdAt/updatedAt are non-null Prisma columns (@default(now()) / @updatedAt) —
 * the Prisma reads always handed consumers a Date. Coerce the (always-present)
 * epoch-ms to a non-null Date so the row shape matches the original.
 */
const reqDate = (v: number | undefined): Date => new Date(req(v));

/** Prisma-row shape for DocumentTemplate (matches prisma.documentTemplate). */
export interface DocumentTemplateRow {
  id: string;
  organizationId: string;
  name: string;
  type: string;
  basePdf: string | null;
  schemas: string | null;
  settings: string | null;
  sections: string | null;
  brandTemplateId: string | null;
  thumbnailData: string | null;
  isDefault: boolean;
  isDraft: boolean;
  version: number;
  thumbnailUrl: string | null;
  publishedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

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

export function mapDocumentTemplate(d: RawDocumentTemplate): DocumentTemplateRow {
  return {
    id: req(d.id),
    organizationId: req(d.organizationId),
    name: req(d.name),
    type: req(d.type),
    isDefault: d.isDefault ?? false,
    isDraft: d.isDraft ?? false,
    version: d.version ?? 1,
    sections: orNull(d.sections),
    basePdf: orNull(d.basePdf),
    schemas: orNull(d.schemas),
    settings: orNull(d.settings),
    thumbnailData: orNull(d.thumbnailData),
    thumbnailUrl: orNull(d.thumbnailUrl),
    brandTemplateId: orNull(d.brandTemplateId),
    publishedAt: toDate(d.publishedAt),
    createdAt: reqDate(d.createdAt),
    updatedAt: reqDate(d.updatedAt),
  };
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

// ─── Pure sort comparators (replicate Prisma orderBy) ────────────────────────

/**
 * orderBy [{ type: "asc" }, { isDefault: "desc" }, { updatedAt: "desc" }].
 * `type` is a free String column (NOT an enum) → plain lexicographic compare.
 * Mirrors getDocumentTemplates.
 */
export function compareDocumentTemplatesForList(
  a: DocumentTemplateRow,
  b: DocumentTemplateRow,
): number {
  if (a.type !== b.type) return a.type < b.type ? -1 : 1;
  const byDefault = (b.isDefault ? 1 : 0) - (a.isDefault ? 1 : 0);
  if (byDefault !== 0) return byDefault;
  return b.updatedAt.getTime() - a.updatedAt.getTime();
}

/**
 * orderBy [{ type: "asc" }, { isDefault: "desc" }, { name: "asc" }].
 * `type` + `name` are plain String columns → lexicographic compare.
 * Mirrors getPublishedTemplatesForDropdown.
 */
export function compareDocumentTemplatesForDropdown(
  a: Pick<DocumentTemplateRow, "type" | "isDefault" | "name">,
  b: Pick<DocumentTemplateRow, "type" | "isDefault" | "name">,
): number {
  if (a.type !== b.type) return a.type < b.type ? -1 : 1;
  const byDefault = (b.isDefault ? 1 : 0) - (a.isDefault ? 1 : 0);
  if (byDefault !== 0) return byDefault;
  if (a.name !== b.name) return a.name < b.name ? -1 : 1;
  return 0;
}

// ─── Fetchers ────────────────────────────────────────────────────────────────

/** All document templates for an org, mapped (unsorted). */
export async function listDocumentTemplates(orgId: string): Promise<DocumentTemplateRow[]> {
  const rows = (await (await getConvexClient()).query(api.documentTemplates.list, {
    orgId,
  })) as RawDocumentTemplate[];
  return rows.map(mapDocumentTemplate);
}

/**
 * Single document template by cuid, mapped. NOT org-scoped on the Convex side —
 * the caller MUST re-check organizationId.
 */
export async function getDocumentTemplateById(id: string): Promise<DocumentTemplateRow | null> {
  const row = (await (await getConvexClient()).query(api.documentTemplates.getById, {
    id,
  })) as RawDocumentTemplate | null;
  return row ? mapDocumentTemplate(row) : null;
}

/** All brand templates for an org, mapped. */
export async function listBrandTemplates(orgId: string): Promise<BrandTemplateRow[]> {
  const rows = (await (await getConvexClient()).query(api.brandTemplates.list, {
    orgId,
  })) as RawBrandTemplate[];
  return rows.map(mapBrandTemplate);
}

/** Single brand template by cuid, mapped. */
export async function getBrandTemplateById(id: string): Promise<BrandTemplateRow | null> {
  const row = (await (await getConvexClient()).query(api.brandTemplates.getById, {
    id,
  })) as RawBrandTemplate | null;
  return row ? mapBrandTemplate(row) : null;
}
