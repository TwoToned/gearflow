"use server";

/**
 * Custom field definition CRUD (Wave 3).
 *
 * Definitions are org-scoped and entity-typed. The matching values live in
 * each entity's `customFieldValues` JSON column — see
 * `validateCustomFieldValues` in the validation module, which the entity
 * create/update actions call before persisting.
 *
 * Permission: gates on `orgSettings` — defining custom fields is an
 * org-configuration task, same surface as Assets / Test & Tag settings.
 */

import { createId } from "@paralleldrive/cuid2";
import { getConvexClient } from "@/lib/convex-client";
import {
  getActiveCustomFieldsForOrg,
  getCustomFieldDefinitionsForOrg,
} from "@/lib/custom-fields-read";
import { api } from "../../convex/_generated/api";
import { getOrgContext, requirePermission } from "@/lib/org-context";
import { serialize } from "@/lib/serialize";
import { logActivity } from "@/lib/activity-log";
import {
  customFieldDefinitionSchema,
  customFieldDefinitionUpdateSchema,
  type CustomFieldDefinitionInput,
  type CustomFieldDefinitionUpdateInput,
  type CustomFieldEntity,
} from "@/lib/validations/custom-field";
import { UserFacingError } from "@/lib/errors";

// Custom field definitions are CONVEX-ONLY (Phase B write inversion): every
// create/update/delete/reorder writes the Convex `customFieldDefinitions` doc as
// the sole source of truth — no Prisma row, no mirror. The table has NO inbound
// Prisma FK (field VALUES live in each entity's `customFieldValues` JSON), so no
// FK-drop migration is needed; the Prisma `custom_field_definition` table is just
// left unwritten until Phase C drops it. The `@@unique([organizationId,
// entityType, fieldKey])` DB constraint is re-implemented in app code below
// (Convex has no unique index). See FEATUREDOCS/54 + the decommission runbook.

/** All definitions for an entity type, ordered for display. Includes
 *  inactive ones — the settings page needs to show + toggle them. */
export async function getCustomFieldDefinitions(entityType: CustomFieldEntity = "ASSET") {
  const { organizationId } = await requirePermission("orgSettings", "read");
  // Convex-only read (Phase A): customFieldDefinition is dual-written + backfilled,
  // so read the Convex copy and apply the entityType filter + display ordering in JS.
  const defs = await getCustomFieldDefinitionsForOrg(organizationId, entityType);
  return serialize(defs);
}

/** Active definitions only — what the entity create/edit form renders.
 *  Cheap read gated on entity visibility, not org settings, so a member
 *  who can edit an asset can see its custom-field inputs. */
export async function getActiveCustomFields(entityType: CustomFieldEntity = "ASSET") {
  const { organizationId } = await getOrgContext();
  // Convex-only read (Phase A): active-only definitions, entityType-filtered +
  // ordered in JS over the dual-written + backfilled Convex copy.
  const defs = await getActiveCustomFieldsForOrg(organizationId, entityType);
  return serialize(defs);
}

export async function createCustomFieldDefinition(input: CustomFieldDefinitionInput) {
  const { organizationId, userId, userName } = await requirePermission(
    "orgSettings",
    "update",
  );
  const parsed = customFieldDefinitionSchema.parse(input);

  // Re-implement the @@unique([organizationId, entityType, fieldKey]) DB guard
  // (Convex has no unique index): reject a duplicate fieldKey for this org+entity.
  const existingForEntity = await getCustomFieldDefinitionsForOrg(
    organizationId,
    parsed.entityType,
  );
  if (existingForEntity.some((d) => d.fieldKey === parsed.fieldKey)) {
    throw new UserFacingError({
      code: "CONFLICT",
      title: "Duplicate field key",
      message: `A custom field with key "${parsed.fieldKey}" already exists for ${parsed.entityType.toLowerCase()}s.`,
    });
  }

  const id = createId();
  const now = Date.now();
  const options = parsed.fieldType === "SELECT" ? parsed.options : [];

  await (await getConvexClient()).mutation(api.customFieldDefinitions.create, {
    id,
    organizationId,
    entityType: parsed.entityType,
    label: parsed.label,
    fieldKey: parsed.fieldKey,
    fieldType: parsed.fieldType,
    options,
    required: parsed.required,
    helpText: parsed.helpText || undefined,
    sortOrder: parsed.sortOrder,
    isActive: parsed.isActive,
    createdAt: now,
    updatedAt: now,
  });

  await logActivity({
    organizationId,
    userId,
    userName,
    action: "CREATE",
    entityType: "settings",
    entityId: id,
    entityName: parsed.label,
    summary: `Added custom field "${parsed.label}" (${parsed.entityType.toLowerCase()})`,
  });

  // Return the same serialized shape the consumers expect (Date timestamps).
  return serialize({
    id,
    organizationId,
    entityType: parsed.entityType,
    label: parsed.label,
    fieldKey: parsed.fieldKey,
    fieldType: parsed.fieldType,
    options,
    required: parsed.required,
    helpText: parsed.helpText || null,
    sortOrder: parsed.sortOrder,
    isActive: parsed.isActive,
    createdAt: new Date(now),
    updatedAt: new Date(now),
  });
}

export async function updateCustomFieldDefinition(
  id: string,
  input: CustomFieldDefinitionUpdateInput,
) {
  const { organizationId, userId, userName } = await requirePermission(
    "orgSettings",
    "update",
  );
  const parsed = customFieldDefinitionUpdateSchema.parse(input);

  const convex = await getConvexClient();
  const existing = await convex.query(api.customFieldDefinitions.getById, { id });
  if (!existing || existing.organizationId !== organizationId) {
    throw new UserFacingError({
      code: "NOT_FOUND",
      title: "Custom field not found",
      message: "This field was deleted or moved. Refresh the page.",
    });
  }

  const options = parsed.fieldType === "SELECT" ? parsed.options : [];
  const now = Date.now();
  await convex.mutation(api.customFieldDefinitions.update, {
    id,
    patch: {
      label: parsed.label,
      fieldType: parsed.fieldType,
      options,
      required: parsed.required,
      helpText: parsed.helpText || undefined,
      sortOrder: parsed.sortOrder,
      isActive: parsed.isActive,
      updatedAt: now,
    },
  });

  await logActivity({
    organizationId,
    userId,
    userName,
    action: "UPDATE",
    entityType: "settings",
    entityId: id,
    entityName: parsed.label,
    summary: `Updated custom field "${parsed.label}"`,
  });

  // `fieldKey`/`entityType`/`createdAt` are immutable on update — carry them from
  // the existing Convex doc so the returned shape matches the old Prisma row.
  return serialize({
    id,
    organizationId,
    entityType: (existing.entityType ?? "ASSET") as CustomFieldEntity,
    label: parsed.label,
    fieldKey: existing.fieldKey,
    fieldType: parsed.fieldType,
    options,
    required: parsed.required,
    helpText: parsed.helpText || null,
    sortOrder: parsed.sortOrder,
    isActive: parsed.isActive,
    createdAt: existing.createdAt ? new Date(existing.createdAt) : new Date(now),
    updatedAt: new Date(now),
  });
}

/** Delete a definition. Values already stored in entity customFieldValues
 *  JSON are left as-is (orphaned keys are harmless — the form just stops
 *  rendering them). This keeps delete cheap and non-destructive. */
export async function deleteCustomFieldDefinition(id: string) {
  const { organizationId, userId, userName } = await requirePermission(
    "orgSettings",
    "update",
  );

  const convex = await getConvexClient();
  const existing = await convex.query(api.customFieldDefinitions.getById, { id });
  if (!existing || existing.organizationId !== organizationId) {
    throw new UserFacingError({
      code: "NOT_FOUND",
      title: "Custom field not found",
      message: "This field was already deleted.",
    });
  }

  await convex.mutation(api.customFieldDefinitions.remove, { id });

  await logActivity({
    organizationId,
    userId,
    userName,
    action: "DELETE",
    entityType: "settings",
    entityId: id,
    entityName: existing.label,
    summary: `Removed custom field "${existing.label}"`,
  });

  return { ok: true };
}

/** Persist a new sort order in one shot (drag-reorder on the settings page). */
export async function reorderCustomFieldDefinitions(orderedIds: string[]) {
  const { organizationId } = await requirePermission("orgSettings", "update");
  const convex = await getConvexClient();
  const now = Date.now();
  // Convex-only: patch each definition's sortOrder. The old Prisma `updateMany`
  // `where: { id, organizationId }` silently skipped foreign ids; replicate that
  // org-guard by verifying ownership per id (the reorder list is small) so a
  // stray/foreign id is a no-op rather than touching another org's row.
  for (let idx = 0; idx < orderedIds.length; idx++) {
    const id = orderedIds[idx];
    const doc = await convex.query(api.customFieldDefinitions.getById, { id });
    if (!doc || doc.organizationId !== organizationId) continue;
    await convex.mutation(api.customFieldDefinitions.update, {
      id,
      patch: { sortOrder: idx, updatedAt: now },
    });
  }
  return { ok: true };
}
