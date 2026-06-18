import { getConvexClient, withConvexReadRetry } from "@/lib/convex-client";
import { api } from "../../convex/_generated/api";
import type { Doc } from "../../convex/_generated/dataModel";
import type { CustomFieldEntity } from "@/lib/validations/custom-field";

/**
 * Server-side read helpers for the custom-field-definition domain (Phase A
 * read-rewiring of the Convex domain-only decommission).
 *
 * `customFieldDefinition` is dual-written (inline `api.customFieldDefinitions.*`
 * from src/server/custom-fields.ts) and backfilled
 * (scripts/convex-backfill-custom-fields.ts). These helpers read the Convex copy
 * and shape it back into the Prisma-row form the settings page + entity
 * create/edit forms expect.
 *
 * Convex stores most columns as `v.optional(...)` (the generated mirror schema),
 * but every Prisma row has a value for them (column defaults). The mapper coerces
 * those back to their Prisma-defaulted, non-null shape (entityType→ASSET,
 * fieldType→TEXT, options→[], required→false, sortOrder→0, isActive→true) so
 * consumers see the exact serialize(Prisma row) shape: epoch-ms → Date,
 * helpText absent → null.
 *
 * The Convex `list` query is org-scoped and returns ALL entity types + active and
 * inactive rows; the entityType / isActive filter + display ordering are applied
 * here in JS (pure, unit-tested) to match the Prisma `where`/`orderBy`.
 */

type RawDef = Doc<"customFieldDefinitions">;

const toDate = (v: number | undefined): Date | null => (typeof v === "number" ? new Date(v) : null);
const orNull = <T>(v: T | undefined): T | null => (v === undefined ? null : v);

/** The mapped row — mirrors serialize(prisma.customFieldDefinition row). */
export interface CustomFieldDefinitionRow {
  id: string;
  organizationId: string;
  entityType: CustomFieldEntity;
  label: string;
  fieldKey: string;
  fieldType: "TEXT" | "NUMBER" | "DATE" | "SELECT" | "BOOLEAN";
  options: string[];
  required: boolean;
  helpText: string | null;
  sortOrder: number;
  isActive: boolean;
  createdAt: Date | null;
  updatedAt: Date | null;
}

/**
 * Map a Convex `customFieldDefinitions` doc back to the Prisma row shape.
 * Coerces every column Convex stores as optional to its Prisma default so the
 * output is byte-compatible with serialize(prisma row).
 */
export function mapCustomFieldDefinition(d: RawDef): CustomFieldDefinitionRow {
  return {
    id: d.id,
    organizationId: d.organizationId,
    entityType: (d.entityType ?? "ASSET") as CustomFieldEntity,
    label: d.label,
    fieldKey: d.fieldKey,
    fieldType: (d.fieldType ?? "TEXT") as CustomFieldDefinitionRow["fieldType"],
    options: d.options ?? [],
    required: d.required ?? false,
    helpText: orNull(d.helpText),
    sortOrder: d.sortOrder ?? 0,
    isActive: d.isActive ?? true,
    createdAt: toDate(d.createdAt),
    updatedAt: toDate(d.updatedAt),
  };
}

/**
 * Replicate Prisma `orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }]`.
 * Both columns are non-null in the Prisma row (defaults), so no NULLS handling
 * is needed. A null createdAt (impossible for a real row) sorts as 0 — stable.
 */
export function sortCustomFieldDefinitions(
  defs: CustomFieldDefinitionRow[],
): CustomFieldDefinitionRow[] {
  return [...defs].sort(
    (a, b) =>
      a.sortOrder - b.sortOrder ||
      (a.createdAt?.getTime() ?? 0) - (b.createdAt?.getTime() ?? 0),
  );
}

/**
 * All definitions for an entity type, ordered for display. Includes inactive
 * ones — the settings page needs to show + toggle them.
 *
 * Replicates `where: { organizationId, entityType }`,
 * `orderBy: [{ sortOrder }, { createdAt }]`.
 */
export async function getCustomFieldDefinitionsForOrg(
  organizationId: string,
  entityType: CustomFieldEntity = "ASSET",
): Promise<CustomFieldDefinitionRow[]> {
  const rows = (await withConvexReadRetry(async () =>
    (await getConvexClient()).query(api.customFieldDefinitions.list, {
      orgId: organizationId,
    }),
  )) as RawDef[];
  const mapped = rows
    .map(mapCustomFieldDefinition)
    .filter((d) => d.entityType === entityType);
  return sortCustomFieldDefinitions(mapped);
}

/**
 * Active definitions only — what the entity create/edit form renders.
 *
 * Replicates `where: { organizationId, entityType, isActive: true }`,
 * `orderBy: [{ sortOrder }, { createdAt }]`.
 */
export async function getActiveCustomFieldsForOrg(
  organizationId: string,
  entityType: CustomFieldEntity = "ASSET",
): Promise<CustomFieldDefinitionRow[]> {
  const rows = (await withConvexReadRetry(async () =>
    (await getConvexClient()).query(api.customFieldDefinitions.list, {
      orgId: organizationId,
    }),
  )) as RawDef[];
  const mapped = rows
    .map(mapCustomFieldDefinition)
    .filter((d) => d.entityType === entityType && d.isActive);
  return sortCustomFieldDefinitions(mapped);
}
