"use server";

import { createId } from "@paralleldrive/cuid2";
import { listDocumentTemplates } from "@/lib/document-template-read";
import { getConvexClient } from "@/lib/convex-client";
import { api } from "../../convex/_generated/api";
import { getOrgContext, requirePermission } from "@/lib/org-context";
import {
  getBrandTemplateForOrg,
  getBrandTemplateListForOrg,
} from "@/lib/brand-templates-read";
import { serialize } from "@/lib/serialize";
import { logActivity } from "@/lib/activity-log";
import {
  createBrandTemplateSchema,
  updateBrandTemplateSchema,
} from "@/lib/validations/template-section";

// Brand templates are CONVEX-ONLY (Phase B write inversion): every
// create/update/delete/default-toggle writes the Convex `brandTemplates` doc as
// the sole source of truth — no Prisma row, no mirror. The inbound FK
// (document_template.brandTemplateId → brand_template, SetNull) was dropped (see
// migration 20260617130100_drop_brand_template_fk_constraint), so brandTemplateId
// is now a plain string holding the Convex cuid.
//
// Invariants re-implemented in app code (Convex has no constraints/cascades):
//  - Single-default-per-org: setDefault / unsetDefault toggle isDefault across the
//    org's brand templates (unsetBrandDefaultsInConvex clears the others).
//  - delete-unlink: any document_template pointing at the deleted brand template is
//    unlinked in BOTH stores — the Prisma column (the PDF pipeline still reads
//    document_template from Prisma) AND the Convex documentTemplates mirror.
//  - Org-guard: reads the target via api.brandTemplates.getById and verifies
//    organizationId before any update/remove (matches the old Prisma
//    findFirst/where:{id,organizationId}).
//
// headerSettings/footerSettings are JSON-string columns, passed straight through.
// See FEATUREDOCS/54 + docs/designs/convex-decommission-RUNBOOK.md.

type ConvexBrandTemplate = {
  id: string;
  organizationId: string;
  name: string;
  headerSettings: string;
  footerSettings: string;
  accentColor?: string;
  isDefault?: boolean;
  createdAt?: number;
  updatedAt?: number;
};

/** Fetch the Convex brand-template doc, org-scoped. Returns null on miss/mismatch. */
async function getOwnedBrandTemplate(
  id: string,
  organizationId: string,
): Promise<ConvexBrandTemplate | null> {
  const doc = (await (await getConvexClient()).query(api.brandTemplates.getById, {
    id,
  })) as ConvexBrandTemplate | null;
  if (!doc || doc.organizationId !== organizationId) return null;
  return doc;
}

/**
 * Clear isDefault on the org's current default brand templates (Convex-only
 * re-implementation of the old Prisma `updateMany({ where: { organizationId,
 * isDefault: true, NOT: { id } }, data: { isDefault: false } })`). Reads the org's
 * brand templates from Convex and patches every default except `exceptId`.
 */
async function unsetBrandDefaultsInConvex(organizationId: string, exceptId?: string) {
  const convex = await getConvexClient();
  const brands = (await convex.query(api.brandTemplates.list, {
    orgId: organizationId,
  })) as ConvexBrandTemplate[];
  await Promise.all(
    brands
      .filter((b) => b.isDefault && b.id !== exceptId)
      .map((b) =>
        convex.mutation(api.brandTemplates.update, {
          id: b.id,
          patch: { isDefault: false, updatedAt: Date.now() },
        }),
      ),
  );
}

/**
 * List all brand templates for the current org.
 */
export async function getBrandTemplates() {
  const { organizationId } = await getOrgContext();

  const templates = await getBrandTemplateListForOrg(organizationId);

  return serialize(templates);
}

/**
 * Get a single brand template with full settings.
 */
export async function getBrandTemplate(id: string) {
  const { organizationId } = await getOrgContext();

  const template = await getBrandTemplateForOrg(id, organizationId);

  if (!template) throw new Error("Brand template not found");

  return serialize({
    ...template,
    headerSettings: JSON.parse(template.headerSettings),
    footerSettings: JSON.parse(template.footerSettings),
  });
}

/**
 * Create a new brand template.
 */
export async function createBrandTemplate(data: CreateBrandTemplateValues) {
  const { organizationId, userId, userName } = await requirePermission(
    "document",
    "manage_templates"
  );

  const validated = createBrandTemplateSchema.parse(data);

  const id = createId();
  const now = Date.now();
  const headerSettings = JSON.stringify(validated.headerSettings);
  const footerSettings = JSON.stringify(validated.footerSettings);
  const accentColor = validated.accentColor || undefined;

  await (await getConvexClient()).mutation(api.brandTemplates.create, {
    id,
    organizationId,
    name: validated.name,
    headerSettings,
    footerSettings,
    accentColor,
    isDefault: false,
    createdAt: now,
    updatedAt: now,
  });

  await logActivity({
    organizationId,
    userId,
    userName,
    action: "create",
    entityType: "brand_template",
    entityId: id,
    entityName: validated.name,
    summary: `Created brand template "${validated.name}"`,
  });

  // Return the same serialized Prisma-row shape consumers expect.
  return serialize({
    id,
    organizationId,
    name: validated.name,
    headerSettings,
    footerSettings,
    accentColor: validated.accentColor || null,
    isDefault: false,
    createdAt: new Date(now),
    updatedAt: new Date(now),
  });
}

/**
 * Update a brand template.
 */
export async function updateBrandTemplate(data: UpdateBrandTemplateValues) {
  const { organizationId, userId, userName } = await requirePermission(
    "document",
    "manage_templates"
  );

  const validated = updateBrandTemplateSchema.parse(data);
  const { id, ...updateFields } = validated;

  const existing = await getOwnedBrandTemplate(id, organizationId);
  if (!existing) throw new Error("Brand template not found");

  const patch: {
    name?: string;
    headerSettings?: string;
    footerSettings?: string;
    accentColor?: string;
    updatedAt: number;
  } = { updatedAt: Date.now() };
  if (updateFields.name !== undefined) patch.name = updateFields.name;
  if (updateFields.headerSettings !== undefined) {
    patch.headerSettings = JSON.stringify(updateFields.headerSettings);
  }
  if (updateFields.footerSettings !== undefined) {
    patch.footerSettings = JSON.stringify(updateFields.footerSettings);
  }
  if (updateFields.accentColor !== undefined) {
    // Convex patch can't set a field to null; pass undefined to clear (the read
    // mapper coerces absent → null, matching the old Prisma `accentColor || null`).
    patch.accentColor = updateFields.accentColor || undefined;
  }

  await (await getConvexClient()).mutation(api.brandTemplates.update, { id, patch });

  const name = patch.name ?? existing.name;

  await logActivity({
    organizationId,
    userId,
    userName,
    action: "update",
    entityType: "brand_template",
    entityId: id,
    entityName: name,
    summary: `Updated brand template "${name}"`,
  });

  // Return the merged Prisma-row shape (immutable fields carried from existing).
  return serialize({
    id,
    organizationId,
    name,
    headerSettings: patch.headerSettings ?? existing.headerSettings,
    footerSettings: patch.footerSettings ?? existing.footerSettings,
    accentColor:
      updateFields.accentColor !== undefined
        ? updateFields.accentColor || null
        : existing.accentColor ?? null,
    isDefault: existing.isDefault ?? false,
    createdAt: existing.createdAt ? new Date(existing.createdAt) : new Date(),
    updatedAt: new Date(patch.updatedAt),
  });
}

/**
 * Delete a brand template. Unlinks any document templates using it.
 */
export async function deleteBrandTemplate(id: string) {
  const { organizationId, userId, userName } = await requirePermission(
    "document",
    "manage_templates"
  );

  const template = await getOwnedBrandTemplate(id, organizationId);
  if (!template) throw new Error("Brand template not found");

  // Unlink any document templates pointing at this brand template. document_template
  // is Convex-only now — find the affected rows (org's templates filtered to this
  // brandTemplateId) and clear `brandTemplateId` on each via the Convex mutation.
  const linked = (await listDocumentTemplates(organizationId)).filter(
    (dt) => dt.brandTemplateId === id,
  );
  if (linked.length > 0) {
    const convex = await getConvexClient();
    for (const dt of linked) {
      // Clear brandTemplateId in Convex (matches the dropped FK's SetNull). The
      // shared mirror helper (toConvexDoc) drops null keys, so it can't clear a
      // field — call the mutation directly with an explicit `undefined`, which
      // Convex `db.patch` treats as field removal.
      await convex.mutation(api.documentTemplates.update, {
        id: dt.id,
        patch: { brandTemplateId: undefined, updatedAt: Date.now() },
      });
    }
  }

  await (await getConvexClient()).mutation(api.brandTemplates.remove, { id });

  await logActivity({
    organizationId,
    userId,
    userName,
    action: "delete",
    entityType: "brand_template",
    entityId: id,
    entityName: template.name,
    summary: `Deleted brand template "${template.name}"`,
  });

  return serialize({ success: true });
}

/**
 * Set a brand template as the org default.
 * Unsets any previous default.
 */
export async function setDefaultBrandTemplate(id: string) {
  const { organizationId, userId, userName } = await requirePermission(
    "document",
    "manage_templates"
  );

  const template = await getOwnedBrandTemplate(id, organizationId);
  if (!template) throw new Error("Brand template not found");

  // Single-default-per-org: clear every other default in the org, then set this one.
  await unsetBrandDefaultsInConvex(organizationId, id);
  await (await getConvexClient()).mutation(api.brandTemplates.update, {
    id,
    patch: { isDefault: true, updatedAt: Date.now() },
  });

  await logActivity({
    organizationId,
    userId,
    userName,
    action: "set_default",
    entityType: "brand_template",
    entityId: id,
    entityName: template.name,
    summary: `Set "${template.name}" as default brand template`,
  });

  return serialize({ success: true });
}

/**
 * Remove a brand template's default status.
 */
export async function unsetDefaultBrandTemplate(id: string) {
  const { organizationId, userId, userName } = await requirePermission(
    "document",
    "manage_templates"
  );

  const template = await getOwnedBrandTemplate(id, organizationId);
  if (!template) throw new Error("Brand template not found");

  await (await getConvexClient()).mutation(api.brandTemplates.update, {
    id,
    patch: { isDefault: false, updatedAt: Date.now() },
  });

  await logActivity({
    organizationId,
    userId,
    userName,
    action: "unset_default",
    entityType: "brand_template",
    entityId: id,
    entityName: template.name,
    summary: `Removed "${template.name}" as default brand template`,
  });

  return serialize({ success: true });
}

import type {
  CreateBrandTemplateValues,
  UpdateBrandTemplateValues,
} from "@/lib/validations/template-section";
