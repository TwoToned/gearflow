/**
 * Translate Prisma errors into UserFacingError so toast.error shows
 * something meaningful instead of "Unique constraint failed on the fields:
 * (`assetTag`)" — which is what 340 toast.error callsites currently surface.
 *
 * Catches:
 *   - P2002: unique constraint violation → "Duplicate <field>"
 *   - P2003: FK constraint violation → "Cannot delete — X is still used by Y"
 *   - P2025: record not found → "X not found"
 *   - P2014: required relation violation → "Cannot remove — X still references Y"
 *
 * Non-Prisma errors pass through unchanged.
 */

import { Prisma } from "@/generated/prisma/client";
import { UserFacingError } from "./user-facing-error";

/**
 * Field-name → friendly-label map. Add entries here as new unique constraints
 * surface. The fallback (humanize) handles unknown fields acceptably.
 */
const FIELD_LABELS: Record<string, string> = {
  assetTag: "asset tag",
  serialNumber: "serial number",
  projectNumber: "project number",
  email: "email address",
  slug: "URL slug",
  name: "name",
  code: "code",
  sku: "SKU",
};

function humanize(field: string): string {
  return FIELD_LABELS[field] ?? field.replace(/([A-Z])/g, " $1").trim().toLowerCase();
}

/**
 * If the input is a Prisma known error, return a translated UserFacingError.
 * Otherwise return null — the caller decides whether to rethrow, log, or
 * wrap in a generic "Something went wrong" UserFacingError.
 */
export function translatePrismaError(e: unknown): UserFacingError | null {
  if (!(e instanceof Prisma.PrismaClientKnownRequestError)) return null;

  switch (e.code) {
    case "P2002": {
      // Unique constraint. meta.target is usually string[] of field names.
      const target = (e.meta?.target as string[] | undefined) ?? [];
      const fields = target.map(humanize).join(" + ");
      const fieldLabel = fields || "value";
      return new UserFacingError({
        code: "DUPLICATE",
        title: `Duplicate ${fieldLabel}`,
        message: `That ${fieldLabel} is already used. Pick a different value or update the existing record.`,
        field: target[0],
      });
    }

    case "P2003": {
      // Foreign key constraint failure.
      const fieldName = (e.meta?.field_name as string | undefined) ?? "related record";
      return new UserFacingError({
        code: "FK_CONSTRAINT",
        title: "Cannot complete this change",
        message: `Another record still references this ${humanize(fieldName.replace(/_/g, " "))}. Remove the references first, then try again.`,
      });
    }

    case "P2025": {
      // Record not found (e.g. update/delete where the row no longer exists).
      const cause = (e.meta?.cause as string | undefined) ?? "Record not found";
      return new UserFacingError({
        code: "NOT_FOUND",
        title: "Record not found",
        message: cause === "Record to update not found." || cause === "Record to delete does not exist."
          ? "This record was deleted or moved. Refresh the page to see the latest state."
          : cause,
      });
    }

    case "P2014": {
      // Relation violation — child still references parent.
      return new UserFacingError({
        code: "RELATION_VIOLATION",
        title: "Cannot remove",
        message: "Another record still depends on this one. Remove the dependents first.",
      });
    }

    default:
      return null;
  }
}
