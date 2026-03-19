"use server";

import { prisma } from "@/lib/prisma";
import { getOrgContext, requirePermission } from "@/lib/org-context";
import { serialize } from "@/lib/serialize";
import { logActivity } from "@/lib/activity-log";
import {
  createDocumentTemplateSchema,
  updateDocumentTemplateSchema,
  DOCUMENT_TYPES,
  DOCUMENT_TYPE_LABELS,
} from "@/lib/validations/document-template";
import {
  saveTemplateSectionsSchema,
  saveTemplateBlocksSchema,
  templateImportSchema,
} from "@/lib/validations/template-section";
import type { SaveTemplateSectionsValues, SaveTemplateBlocksValues, TemplateImportData } from "@/lib/validations/template-section";
import { flattenBlocks } from "@/lib/pdfme/block-utils";
import type { TemplateBlock } from "@/lib/pdfme/section-types";
import { getTemplateBuilder } from "@/lib/pdfme/templates";
import { getDefaultSections } from "@/lib/pdfme/section-types";
import type { DocumentType } from "@/lib/pdfme/types";
import type { TemplateSettings } from "@/lib/pdfme/template-settings";
import { getDefaultSettings } from "@/lib/pdfme/template-settings";

/**
 * List all document templates for the current org, plus virtual system defaults.
 */
export async function getDocumentTemplates() {
  const { organizationId } = await getOrgContext();

  const templates = await prisma.documentTemplate.findMany({
    where: { organizationId },
    orderBy: [{ type: "asc" }, { isDefault: "desc" }, { updatedAt: "desc" }],
    include: { brandTemplate: { select: { id: true, name: true } } },
  });

  // Build virtual system default entries for each doc type
  const systemDefaults = DOCUMENT_TYPES.map((type) => ({
    id: `system-${type}`,
    organizationId,
    name: `${DOCUMENT_TYPE_LABELS[type]} — System Default`,
    type,
    isDefault: false,
    isSystemDefault: true,
    isDraft: false,
    version: 1,
    thumbnailUrl: null,
    publishedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  }));

  // For each type, check if any custom template is marked default
  // If not, the system default is effectively the active one
  const customByType = new Map<string, typeof templates>();
  for (const t of templates) {
    if (!customByType.has(t.type)) customByType.set(t.type, []);
    customByType.get(t.type)!.push(t);
  }

  const result = systemDefaults.map((sd) => {
    const customs = customByType.get(sd.type) || [];
    const hasCustomDefault = customs.some((c) => c.isDefault);
    return {
      ...sd,
      isDefault: !hasCustomDefault, // system default is active if no custom is
    };
  });

  // Merge: system defaults + custom templates (without basePdf/schemas for list view)
  const customsWithoutPayload = templates.map((t) => ({
    id: t.id,
    organizationId: t.organizationId,
    name: t.name,
    type: t.type,
    isDefault: t.isDefault,
    isSystemDefault: false,
    isSectionBased: !!t.sections,
    isDraft: t.isDraft,
    version: t.version,
    thumbnailUrl: t.thumbnailUrl,
    thumbnailData: t.thumbnailData,
    brandTemplate: t.brandTemplate,
    publishedAt: t.publishedAt,
    createdAt: t.createdAt,
    updatedAt: t.updatedAt,
  }));

  return serialize([...result, ...customsWithoutPayload]);
}

/**
 * Get published templates grouped by doc type for the document generation dropdown.
 * Returns only published (non-draft) custom templates, plus flags for which types have customs.
 */
export async function getPublishedTemplatesForDropdown() {
  const { organizationId } = await getOrgContext();

  const templates = await prisma.documentTemplate.findMany({
    where: {
      organizationId,
      isDraft: false,
    },
    select: {
      id: true,
      name: true,
      type: true,
      isDefault: true,
    },
    orderBy: [{ type: "asc" }, { isDefault: "desc" }, { name: "asc" }],
  });

  return serialize(templates);
}

/**
 * Get a single template with full schema data for the designer.
 */
export async function getDocumentTemplate(id: string) {
  const { organizationId } = await getOrgContext();

  // Handle system default virtual IDs
  if (id.startsWith("system-")) {
    const type = id.replace("system-", "") as DocumentType;
    const builder = getTemplateBuilder(type);
    const template = builder.buildTemplate();
    const defaultSections = getDefaultSections(type);
    return serialize({
      id,
      organizationId,
      name: `${DOCUMENT_TYPE_LABELS[type]} — System Default`,
      type,
      basePdf: JSON.stringify(template.basePdf),
      schemas: JSON.stringify(template.schemas),
      sections: JSON.stringify(defaultSections),
      isDefault: true,
      isSystemDefault: true,
      isDraft: false,
      version: 1,
      thumbnailUrl: null,
      brandTemplateId: null,
      publishedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
  }

  const template = await prisma.documentTemplate.findFirst({
    where: { id, organizationId },
    include: { brandTemplate: true },
  });

  if (!template) {
    throw new Error("Template not found");
  }

  return serialize(template);
}

/**
 * Create a new document template.
 */
export async function createDocumentTemplate(
  data: { name: string; type: string; basePdf: string; schemas: string }
) {
  const { organizationId, userId, userName } = await requirePermission(
    "document",
    "manage_templates"
  );

  const validated = createDocumentTemplateSchema.parse(data);

  const template = await prisma.documentTemplate.create({
    data: {
      ...validated,
      organizationId,
    },
  });

  await logActivity({
    organizationId,
    userId,
    userName,
    action: "create",
    entityType: "document_template",
    entityId: template.id,
    entityName: template.name,
    summary: `Created document template "${template.name}"`,
  });

  return serialize(template);
}

/**
 * Update an existing document template (save from designer).
 */
export async function updateDocumentTemplate(
  data: { id: string; name?: string; basePdf?: string; schemas?: string }
) {
  const { organizationId, userId, userName } = await requirePermission(
    "document",
    "manage_templates"
  );

  const validated = updateDocumentTemplateSchema.parse(data);
  const { id, ...updateData } = validated;

  const template = await prisma.documentTemplate.update({
    where: { id, organizationId },
    data: {
      ...updateData,
      version: { increment: 1 },
    },
  });

  await logActivity({
    organizationId,
    userId,
    userName,
    action: "update",
    entityType: "document_template",
    entityId: template.id,
    entityName: template.name,
    summary: `Updated document template "${template.name}"`,
  });

  return serialize(template);
}

/**
 * Publish a draft template (makes it available for use).
 */
export async function publishDocumentTemplate(id: string) {
  const { organizationId, userId, userName } = await requirePermission(
    "document",
    "manage_templates"
  );

  const template = await prisma.documentTemplate.update({
    where: { id, organizationId },
    data: {
      isDraft: false,
      publishedAt: new Date(),
    },
  });

  await logActivity({
    organizationId,
    userId,
    userName,
    action: "publish",
    entityType: "document_template",
    entityId: template.id,
    entityName: template.name,
    summary: `Published document template "${template.name}"`,
  });

  return serialize(template);
}

/**
 * Set a template as the default for its document type.
 * Unsets any previously default template of the same type.
 */
export async function setDefaultTemplate(id: string) {
  const { organizationId, userId, userName } = await requirePermission(
    "document",
    "manage_templates"
  );

  const template = await prisma.documentTemplate.findFirst({
    where: { id, organizationId },
  });

  if (!template) throw new Error("Template not found");
  if (template.isDraft) throw new Error("Cannot set a draft template as default");

  await prisma.$transaction([
    // Unset all defaults for this type
    prisma.documentTemplate.updateMany({
      where: { organizationId, type: template.type, isDefault: true },
      data: { isDefault: false },
    }),
    // Set new default
    prisma.documentTemplate.update({
      where: { id },
      data: { isDefault: true },
    }),
  ]);

  await logActivity({
    organizationId,
    userId,
    userName,
    action: "set_default",
    entityType: "document_template",
    entityId: template.id,
    entityName: template.name,
    summary: `Set "${template.name}" as default ${DOCUMENT_TYPE_LABELS[template.type]} template`,
  });

  return serialize({ success: true });
}

/**
 * Remove a template's default status (reverts to system default).
 */
export async function unsetDefaultTemplate(id: string) {
  const { organizationId, userId, userName } = await requirePermission(
    "document",
    "manage_templates"
  );

  const template = await prisma.documentTemplate.update({
    where: { id, organizationId },
    data: { isDefault: false },
  });

  await logActivity({
    organizationId,
    userId,
    userName,
    action: "unset_default",
    entityType: "document_template",
    entityId: template.id,
    entityName: template.name,
    summary: `Removed "${template.name}" as default template`,
  });

  return serialize({ success: true });
}

/**
 * Delete a document template.
 */
export async function deleteDocumentTemplate(id: string) {
  const { organizationId, userId, userName } = await requirePermission(
    "document",
    "manage_templates"
  );

  const template = await prisma.documentTemplate.findFirst({
    where: { id, organizationId },
  });

  if (!template) throw new Error("Template not found");

  await prisma.documentTemplate.delete({
    where: { id },
  });

  await logActivity({
    organizationId,
    userId,
    userName,
    action: "delete",
    entityType: "document_template",
    entityId: template.id,
    entityName: template.name,
    summary: `Deleted document template "${template.name}"`,
  });

  return serialize({ success: true });
}

/**
 * Duplicate a system default template into an org-owned custom template.
 * Returns the new template's id so the UI can navigate to the designer.
 */
export async function duplicateSystemDefault(type: string) {
  const { organizationId, userId, userName } = await requirePermission(
    "document",
    "manage_templates"
  );

  const docType = type as DocumentType;
  const builder = getTemplateBuilder(docType);
  const defaultSettings = getDefaultSettings(docType);
  const systemTemplate = builder.buildTemplate(defaultSettings);

  const template = await prisma.documentTemplate.create({
    data: {
      organizationId,
      name: `${DOCUMENT_TYPE_LABELS[type]} — Custom`,
      type: docType,
      basePdf: JSON.stringify(systemTemplate.basePdf),
      schemas: JSON.stringify(systemTemplate.schemas),
      settings: JSON.stringify(defaultSettings),
      isDraft: true,
    },
  });

  await logActivity({
    organizationId,
    userId,
    userName,
    action: "duplicate",
    entityType: "document_template",
    entityId: template.id,
    entityName: template.name,
    summary: `Customised system default ${DOCUMENT_TYPE_LABELS[type]} template`,
  });

  return serialize({ id: template.id });
}

/**
 * Save template settings (the high-level config, not pdfme schemas).
 */
export async function saveTemplateSettings(
  id: string,
  settings: TemplateSettings,
  name?: string
) {
  const { organizationId, userId, userName } = await requirePermission(
    "document",
    "manage_templates"
  );

  // Build pdfme template from settings so basePdf/schemas stay in sync
  const template = await prisma.documentTemplate.findFirst({
    where: { id, organizationId },
  });
  if (!template) throw new Error("Template not found");

  const builder = getTemplateBuilder(template.type as DocumentType);
  const pdfmeTemplate = builder.buildTemplate(settings);

  const updateData: Record<string, unknown> = {
    settings: JSON.stringify(settings),
    basePdf: JSON.stringify(pdfmeTemplate.basePdf),
    schemas: JSON.stringify(pdfmeTemplate.schemas),
    version: { increment: 1 },
  };
  if (name) updateData.name = name;

  const updated = await prisma.documentTemplate.update({
    where: { id, organizationId },
    data: updateData,
  });

  await logActivity({
    organizationId,
    userId,
    userName,
    action: "update",
    entityType: "document_template",
    entityId: updated.id,
    entityName: updated.name,
    summary: `Updated template settings for "${updated.name}"`,
  });

  return serialize({ success: true });
}

/**
 * Get template settings for the editor.
 * Returns settings + template metadata.
 */
export async function getTemplateForEditor(id: string) {
  const { organizationId } = await getOrgContext();

  // Handle system default virtual IDs — return default sections for the builder
  if (id.startsWith("system-")) {
    const type = id.replace("system-", "") as DocumentType;
    const defaultSections = getDefaultSections(type);
    return serialize({
      id,
      name: `${DOCUMENT_TYPE_LABELS[type]} — System Default`,
      type,
      isDraft: false,
      isDefault: true,
      isSystemDefault: true,
      version: 1,
      publishedAt: null,
      brandTemplateId: null,
      sections: defaultSections,
      settings: getDefaultSettings(type),
    });
  }

  const template = await prisma.documentTemplate.findFirst({
    where: { id, organizationId },
    include: { brandTemplate: true },
  });
  if (!template) throw new Error("Template not found");

  const settings: TemplateSettings = template.settings
    ? JSON.parse(template.settings)
    : getDefaultSettings(template.type as DocumentType);

  const sections = template.sections
    ? JSON.parse(template.sections)
    : null;

  return serialize({
    id: template.id,
    name: template.name,
    type: template.type,
    isDraft: template.isDraft,
    isDefault: template.isDefault,
    isSystemDefault: false,
    version: template.version,
    publishedAt: template.publishedAt,
    brandTemplateId: template.brandTemplateId,
    brandTemplate: template.brandTemplate
      ? {
          id: template.brandTemplate.id,
          name: template.brandTemplate.name,
          accentColor: template.brandTemplate.accentColor,
        }
      : null,
    sections,
    settings,
  });
}

/**
 * Duplicate an existing custom template.
 */
export async function duplicateDocumentTemplate(id: string) {
  const { organizationId, userId, userName } = await requirePermission(
    "document",
    "manage_templates"
  );

  const source = await prisma.documentTemplate.findFirst({
    where: { id, organizationId },
  });

  if (!source) throw new Error("Template not found");

  const template = await prisma.documentTemplate.create({
    data: {
      organizationId,
      name: `${source.name} (Copy)`,
      type: source.type,
      basePdf: source.basePdf,
      schemas: source.schemas,
      sections: source.sections,
      settings: source.settings,
      brandTemplateId: source.brandTemplateId,
      isDraft: true,
    },
  });

  await logActivity({
    organizationId,
    userId,
    userName,
    action: "duplicate",
    entityType: "document_template",
    entityId: template.id,
    entityName: template.name,
    summary: `Duplicated template "${source.name}"`,
  });

  return serialize({ id: template.id });
}

// ─── Section-Based Template Actions ──────────────────────────────────────────

/**
 * Save sections for a document template (section-based builder).
 * Supports optimistic locking via optional version field.
 */
export async function saveTemplateSections(data: SaveTemplateSectionsValues) {
  const { organizationId, userId, userName } = await requirePermission(
    "document",
    "manage_templates"
  );

  const validated = saveTemplateSectionsSchema.parse(data);

  // Optimistic locking in a transaction to prevent TOCTOU race
  const template = await prisma.$transaction(async (tx) => {
    if (validated.version != null) {
      const current = await tx.documentTemplate.findFirst({
        where: { id: validated.id, organizationId },
        select: { version: true },
      });
      if (current && current.version !== validated.version) {
        throw new Error(
          "Template was modified by another user. Please refresh and try again."
        );
      }
    }
    return tx.documentTemplate.update({
      where: { id: validated.id, organizationId },
      data: {
        sections: JSON.stringify(validated.sections),
        brandTemplateId: validated.brandTemplateId ?? null,
        version: { increment: 1 },
      },
    });
  });

  await logActivity({
    organizationId,
    userId,
    userName,
    action: "update",
    entityType: "document_template",
    entityId: template.id,
    entityName: template.name,
    summary: `Updated sections for template "${template.name}"`,
  });

  return serialize({ success: true, version: template.version });
}

/**
 * Save blocks for a document template (block editor).
 * Converts blocks to flat sections with layoutHint for storage.
 * Supports optimistic locking via optional version field.
 */
export async function saveTemplateBlocks(data: SaveTemplateBlocksValues) {
  const { organizationId, userId, userName } = await requirePermission(
    "document",
    "manage_templates"
  );

  const validated = saveTemplateBlocksSchema.parse(data);

  // Flatten blocks to sections for storage
  const sections = flattenBlocks(validated.blocks as TemplateBlock[]);

  // Optimistic locking in a transaction to prevent TOCTOU race
  const template = await prisma.$transaction(async (tx) => {
    if (validated.version != null) {
      const current = await tx.documentTemplate.findFirst({
        where: { id: validated.id, organizationId },
        select: { version: true },
      });
      if (current && current.version !== validated.version) {
        throw new Error(
          "Template was modified by another user. Please refresh and try again."
        );
      }
    }
    return tx.documentTemplate.update({
      where: { id: validated.id, organizationId },
      data: {
        sections: JSON.stringify(sections),
        settings: validated.documentSettings ? JSON.stringify(validated.documentSettings) : undefined,
        brandTemplateId: validated.brandTemplateId ?? null,
        version: { increment: 1 },
      },
    });
  });

  await logActivity({
    organizationId,
    userId,
    userName,
    action: "update",
    entityType: "document_template",
    entityId: template.id,
    entityName: template.name,
    summary: `Updated block layout for template "${template.name}"`,
  });

  return serialize({ success: true, version: template.version });
}

/**
 * Duplicate a system default into a section-based template.
 * Uses getDefaultSections() to populate the initial section list.
 */
export async function duplicateSystemDefaultWithSections(type: string) {
  const { organizationId, userId, userName } = await requirePermission(
    "document",
    "manage_templates"
  );

  const docType = type as DocumentType;
  const sections = getDefaultSections(docType);

  const template = await prisma.documentTemplate.create({
    data: {
      organizationId,
      name: `${DOCUMENT_TYPE_LABELS[type]} — Custom`,
      type: docType,
      sections: JSON.stringify(sections),
      isDraft: true,
    },
  });

  await logActivity({
    organizationId,
    userId,
    userName,
    action: "duplicate",
    entityType: "document_template",
    entityId: template.id,
    entityName: template.name,
    summary: `Created custom ${DOCUMENT_TYPE_LABELS[type]} template from system default`,
  });

  return serialize({ id: template.id });
}

/**
 * Export a template as a portable JSON object.
 * Strips org-specific data (IDs, brand template references).
 */
export async function exportTemplate(id: string) {
  const { organizationId } = await getOrgContext();

  let sections: unknown[];
  let type: string;
  let name: string;

  if (id.startsWith("system-")) {
    type = id.replace("system-", "");
    name = `${DOCUMENT_TYPE_LABELS[type]} — System Default`;
    sections = getDefaultSections(type as DocumentType);
  } else {
    const template = await prisma.documentTemplate.findFirst({
      where: { id, organizationId },
    });
    if (!template) throw new Error("Template not found");
    if (!template.sections) throw new Error("Template has no sections to export");

    sections = JSON.parse(template.sections);
    type = template.type;
    name = template.name;
  }

  const exportData = {
    version: 1 as const,
    type,
    name,
    sections,
    exportedAt: new Date().toISOString(),
  };

  return serialize(exportData);
}

/**
 * Import a template from a portable JSON export.
 * Creates a new draft template with the imported sections.
 */
export async function importTemplate(data: TemplateImportData) {
  const { organizationId, userId, userName } = await requirePermission(
    "document",
    "manage_templates"
  );

  const validated = templateImportSchema.parse(data);

  const template = await prisma.documentTemplate.create({
    data: {
      organizationId,
      name: `${validated.name} (Imported)`,
      type: validated.type,
      sections: JSON.stringify(validated.sections),
      isDraft: true,
    },
  });

  await logActivity({
    organizationId,
    userId,
    userName,
    action: "import",
    entityType: "document_template",
    entityId: template.id,
    entityName: template.name,
    summary: `Imported template "${validated.name}"`,
  });

  return serialize({ id: template.id });
}

/**
 * Save a template's thumbnail data (base64-encoded PNG).
 * Called by the preview renderer after generating a thumbnail.
 */
export async function saveTemplateThumbnail(id: string, thumbnailData: string) {
  const { organizationId } = await requirePermission(
    "document",
    "manage_templates"
  );

  if (thumbnailData.length > 2_000_000) {
    throw new Error("Thumbnail data exceeds maximum size");
  }

  await prisma.documentTemplate.update({
    where: { id, organizationId },
    data: { thumbnailData },
  });

  return serialize({ success: true });
}
