"use server";

import { getOrgContext } from "@/lib/org-context";
import { serialize } from "@/lib/serialize";
import {
  listDocumentTemplates,
  getDocumentTemplateById,
  listBrandTemplates,
  getBrandTemplateById,
  compareDocumentTemplatesForList,
  compareDocumentTemplatesForDropdown,
} from "@/lib/document-template-read";
import {
  DOCUMENT_TYPES,
  DOCUMENT_TYPE_LABELS,
} from "@/lib/validations/document-template";
import { getTemplateBuilder } from "@/lib/pdfme/templates";
import { getDefaultSections } from "@/lib/pdfme/section-types";
import type { DocumentType } from "@/lib/pdfme/types";

/**
 * List all document templates for the current org, plus virtual system defaults.
 */
export async function getDocumentTemplates() {
  const { organizationId } = await getOrgContext();

  const [rows, brandRows] = await Promise.all([
    listDocumentTemplates(organizationId),
    listBrandTemplates(organizationId),
  ]);
  const brandMap = new Map(brandRows.map((b) => [b.id, { id: b.id, name: b.name }]));
  const templates = rows
    .slice()
    .sort(compareDocumentTemplatesForList)
    .map((t) => ({
      ...t,
      brandTemplate: t.brandTemplateId ? brandMap.get(t.brandTemplateId) ?? null : null,
    }));

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

  const rows = await listDocumentTemplates(organizationId);
  const templates = rows
    .filter((t) => t.isDraft === false)
    .sort(compareDocumentTemplatesForDropdown)
    .map((t) => ({
      id: t.id,
      name: t.name,
      type: t.type,
      isDefault: t.isDefault,
    }));

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

  const row = await getDocumentTemplateById(id);
  if (!row || row.organizationId !== organizationId) {
    throw new Error("Template not found");
  }

  const brandTemplate = row.brandTemplateId
    ? await getBrandTemplateById(row.brandTemplateId)
    : null;
  const template = { ...row, brandTemplate };

  return serialize(template);
}
