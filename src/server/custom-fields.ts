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

import { type FunctionArgs } from "convex/server";
import { prisma } from "@/lib/prisma";
import { getConvexClient, toConvexDoc } from "@/lib/convex-client";
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
import { translatePrismaError, UserFacingError } from "@/lib/errors";

// Custom field definitions are DUAL-WRITTEN: every create/update/delete/reorder
// writes the Prisma `custom_field_definition` row AND the Convex
// `customFieldDefinitions` doc (the reactive read source the settings page
// subscribes to). The actual field VALUES live in each entity's customFieldValues
// JSON column (unchanged, still Prisma). Prisma is written first; the Convex
// payload is derived from the written row via toConvexDoc. See FEATUREDOCS/54.

/** Mirror a freshly written Prisma custom-field row into Convex (create). */
async function mirrorCustomFieldToConvex(row: Record<string, unknown>) {
  await (await getConvexClient()).mutation(
    api.customFieldDefinitions.createIfMissing,
    toConvexDoc(row) as FunctionArgs<typeof api.customFieldDefinitions.createIfMissing>,
  );
}

/** Mirror an updated Prisma custom-field row into Convex (patch, id stripped). */
async function patchCustomFieldInConvex(id: string, row: Record<string, unknown>) {
  const { id: _id, ...patch } = toConvexDoc(row);
  await (await getConvexClient()).mutation(api.customFieldDefinitions.update, {
    id,
    patch: patch as FunctionArgs<typeof api.customFieldDefinitions.update>["patch"],
  });
}

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

  try {
    const def = await prisma.customFieldDefinition.create({
      data: {
        organizationId,
        entityType: parsed.entityType,
        label: parsed.label,
        fieldKey: parsed.fieldKey,
        fieldType: parsed.fieldType,
        options: parsed.fieldType === "SELECT" ? parsed.options : [],
        required: parsed.required,
        helpText: parsed.helpText || null,
        sortOrder: parsed.sortOrder,
        isActive: parsed.isActive,
      },
    });
    await mirrorCustomFieldToConvex(def);

    await logActivity({
      organizationId,
      userId,
      userName,
      action: "CREATE",
      entityType: "settings",
      entityId: def.id,
      entityName: def.label,
      summary: `Added custom field "${def.label}" (${def.entityType.toLowerCase()})`,
    });

    return serialize(def);
  } catch (e) {
    const translated = translatePrismaError(e);
    if (translated) throw translated;
    throw e;
  }
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

  const existing = await prisma.customFieldDefinition.findUnique({
    where: { id, organizationId },
    select: { label: true },
  });
  if (!existing) {
    throw new UserFacingError({
      code: "NOT_FOUND",
      title: "Custom field not found",
      message: "This field was deleted or moved. Refresh the page.",
    });
  }

  try {
    const def = await prisma.customFieldDefinition.update({
      where: { id, organizationId },
      data: {
        label: parsed.label,
        fieldType: parsed.fieldType,
        options: parsed.fieldType === "SELECT" ? parsed.options : [],
        required: parsed.required,
        helpText: parsed.helpText || null,
        sortOrder: parsed.sortOrder,
        isActive: parsed.isActive,
      },
    });
    await patchCustomFieldInConvex(id, def);

    await logActivity({
      organizationId,
      userId,
      userName,
      action: "UPDATE",
      entityType: "settings",
      entityId: def.id,
      entityName: def.label,
      summary: `Updated custom field "${def.label}"`,
    });

    return serialize(def);
  } catch (e) {
    const translated = translatePrismaError(e);
    if (translated) throw translated;
    throw e;
  }
}

/** Delete a definition. Values already stored in entity customFieldValues
 *  JSON are left as-is (orphaned keys are harmless — the form just stops
 *  rendering them). This keeps delete cheap and non-destructive. */
export async function deleteCustomFieldDefinition(id: string) {
  const { organizationId, userId, userName } = await requirePermission(
    "orgSettings",
    "update",
  );

  const existing = await prisma.customFieldDefinition.findUnique({
    where: { id, organizationId },
    select: { label: true },
  });
  if (!existing) {
    throw new UserFacingError({
      code: "NOT_FOUND",
      title: "Custom field not found",
      message: "This field was already deleted.",
    });
  }

  await prisma.customFieldDefinition.delete({ where: { id, organizationId } });
  await (await getConvexClient()).mutation(api.customFieldDefinitions.remove, { id });

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
  await prisma.$transaction(
    orderedIds.map((id, idx) =>
      prisma.customFieldDefinition.updateMany({
        where: { id, organizationId },
        data: { sortOrder: idx },
      }),
    ),
  );
  // Mirror the new sort order into Convex (the reactive read source).
  const convex = (await getConvexClient());
  for (let idx = 0; idx < orderedIds.length; idx++) {
    await convex.mutation(api.customFieldDefinitions.update, { id: orderedIds[idx], patch: { sortOrder: idx } });
  }
  return { ok: true };
}
