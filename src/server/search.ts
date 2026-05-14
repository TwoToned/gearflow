"use server";

import { prisma } from "@/lib/prisma";
import { getOrgContext } from "@/lib/org-context";
import { serialize } from "@/lib/serialize";

export type SearchResultType =
  | "model"
  | "kit"
  | "asset"
  | "bulk-asset"
  | "project"
  | "client"
  | "supplier"
  | "location"
  | "category"
  | "maintenance"
  | "crew"
  | "check-item"
  | "group-template"
  | "sub-hire";

export type SearchResult = {
  id: string;
  type: SearchResultType;
  title: string;
  subtitle: string | null;
  href: string;
  relevance: number;
  isChild?: boolean;
  /** Status field for projects (used by warehouse filtering) */
  status?: string;
};

function normalize(s: string): string {
  return s.replace(/[^a-zA-Z0-9]/g, "").toLowerCase();
}

// ─── Row types ─────────────────────────────────────────────────────

type ModelRow = { id: string; name: string; manufacturer: string | null; modelNumber: string | null; categoryName: string | null; match_quality: number };
type KitRow = { id: string; assetTag: string; name: string; description: string | null; caseType: string | null; match_quality: number };
type AssetRow = { id: string; assetTag: string; serialNumber: string | null; customName: string | null; modelName: string; match_quality: number };
type BulkAssetRow = { id: string; assetTag: string; totalQuantity: number; modelId: string; modelName: string; match_quality: number };
type ProjectRow = { id: string; projectNumber: string; name: string; status: string; clientName: string | null; match_quality: number };
type ClientRow = { id: string; name: string; contactName: string | null; contactEmail: string | null; match_quality: number };
type LocationRow = { id: string; name: string; address: string | null; match_quality: number };
type CategoryRow = { id: string; name: string; description: string | null; modelCount: number; match_quality: number };
type SupplierRow = { id: string; name: string; contactName: string | null; accountNumber: string | null; match_quality: number };
type MaintenanceRow = { id: string; title: string; status: string; match_quality: number };
type CrewRow = { id: string; firstName: string; lastName: string; email: string | null; department: string | null; roleName: string | null; match_quality: number };
type CheckItemRow = { id: string; label: string; type: string; category: string | null; match_quality: number };
type GroupTemplateRow = { id: string; name: string; description: string | null; itemCount: number; match_quality: number };
type SubHireRow = { id: string; orderNumber: string; status: string; supplierName: string; supplierReference: string | null; projectId: string | null; match_quality: number };

// Child row types
type ChildAssetRow = { id: string; assetTag: string; serialNumber: string | null; customName: string | null; modelId: string; status: string };
type ChildBulkAssetRow = { id: string; assetTag: string; totalQuantity: number; modelId: string };
type KitItemRow = { assetTag: string; name: string; assetId: string | null; kitId: string };
type ClientProjectRow = { id: string; projectNumber: string; name: string; status: string; clientId: string };
type LocationChildAssetRow = { id: string; assetTag: string; customName: string | null; modelName: string; locationId: string };
type LocationChildKitRow = { id: string; assetTag: string; name: string; locationId: string };
type ChildLocationRow = { id: string; name: string; address: string | null; parentId: string };
type CategoryModelRow = { id: string; name: string; modelNumber: string | null; manufacturer: string | null; categoryId: string };
type ChildCategoryRow = { id: string; name: string; parentId: string };

export async function globalSearch(query: string) {
  const { organizationId } = await getOrgContext();

  if (!query || query.trim().length < 2) return { results: [] };

  const q = query.trim();
  const ql = q.toLowerCase();
  const nq = normalize(q);
  const ilikePattern = `%${ql}%`;
  const nqPattern = `%${nq}%`;
  const trigramThreshold = 0.15;

  if (nq.length < 1) return { results: [] };

  const [models, kits, assets, bulkAssets, projects, clients, suppliers, locations, categories, maintenance, crew, checkItems, groupTemplates, subHires] =
    await Promise.all([
      prisma.$queryRaw<ModelRow[]>`
        SELECT m.id, m.name, m.manufacturer, m."modelNumber",
               c.name AS "categoryName",
               GREATEST(
                 similarity(lower(m.name), ${ql}),
                 similarity(lower(COALESCE(m.manufacturer, '')), ${ql}),
                 similarity(lower(COALESCE(m."modelNumber", '')), ${ql})
               ) AS match_quality
        FROM "public"."model" m
        LEFT JOIN "public"."category" c ON m."categoryId" = c.id
        WHERE m."organizationId" = ${organizationId}
          AND m."isActive" = true
          AND (
            m.name ILIKE ${ilikePattern}
            OR COALESCE(m.manufacturer, '') ILIKE ${ilikePattern}
            OR COALESCE(m."modelNumber", '') ILIKE ${ilikePattern}
            OR COALESCE(m.description, '') ILIKE ${ilikePattern}
            OR lower(regexp_replace(m.name, '[^a-zA-Z0-9]', '', 'g')) LIKE ${nqPattern}
            OR lower(regexp_replace(COALESCE(m.manufacturer, ''), '[^a-zA-Z0-9]', '', 'g')) LIKE ${nqPattern}
            OR lower(regexp_replace(COALESCE(m."modelNumber", ''), '[^a-zA-Z0-9]', '', 'g')) LIKE ${nqPattern}
            OR lower(regexp_replace(COALESCE(m.description, ''), '[^a-zA-Z0-9]', '', 'g')) LIKE ${nqPattern}
            OR similarity(m.name, ${q}) > ${trigramThreshold}
            OR similarity(COALESCE(m.manufacturer, ''), ${q}) > ${trigramThreshold}
            OR similarity(COALESCE(m."modelNumber", ''), ${q}) > ${trigramThreshold}
            OR EXISTS(SELECT 1 FROM unnest(m.tags) t WHERE t ILIKE ${ilikePattern})
          )
        ORDER BY match_quality DESC, m.name ASC
        LIMIT 15
      `,

      prisma.$queryRaw<KitRow[]>`
        SELECT id, "assetTag", name, description, "caseType",
               GREATEST(similarity(lower(name), ${ql}), similarity(lower("assetTag"), ${ql})) AS match_quality
        FROM "public"."kit"
        WHERE "organizationId" = ${organizationId} AND "isActive" = true
          AND (
            name ILIKE ${ilikePattern} OR "assetTag" ILIKE ${ilikePattern}
            OR COALESCE(description, '') ILIKE ${ilikePattern} OR COALESCE("caseType", '') ILIKE ${ilikePattern}
            OR lower(regexp_replace(name, '[^a-zA-Z0-9]', '', 'g')) LIKE ${nqPattern}
            OR lower(regexp_replace("assetTag", '[^a-zA-Z0-9]', '', 'g')) LIKE ${nqPattern}
            OR similarity(name, ${q}) > ${trigramThreshold} OR similarity("assetTag", ${q}) > ${trigramThreshold}
            OR EXISTS(SELECT 1 FROM unnest(tags) t WHERE t ILIKE ${ilikePattern})
          )
        ORDER BY match_quality DESC, name ASC LIMIT 10
      `,

      prisma.$queryRaw<AssetRow[]>`
        SELECT a.id, a."assetTag", a."serialNumber", a."customName", m.name AS "modelName",
               GREATEST(
                 similarity(lower(a."assetTag"), ${ql}),
                 similarity(lower(COALESCE(a."serialNumber", '')), ${ql}),
                 similarity(lower(COALESCE(a."customName", '')), ${ql}),
                 similarity(lower(m.name), ${ql})
               ) AS match_quality
        FROM "public"."asset" a JOIN "public"."model" m ON a."modelId" = m.id
        WHERE a."organizationId" = ${organizationId} AND a."isActive" = true
          AND (
            a."assetTag" ILIKE ${ilikePattern} OR COALESCE(a."serialNumber", '') ILIKE ${ilikePattern}
            OR COALESCE(a."customName", '') ILIKE ${ilikePattern} OR m.name ILIKE ${ilikePattern}
            OR lower(regexp_replace(a."assetTag", '[^a-zA-Z0-9]', '', 'g')) LIKE ${nqPattern}
            OR lower(regexp_replace(COALESCE(a."serialNumber", ''), '[^a-zA-Z0-9]', '', 'g')) LIKE ${nqPattern}
            OR lower(regexp_replace(COALESCE(a."customName", ''), '[^a-zA-Z0-9]', '', 'g')) LIKE ${nqPattern}
            OR lower(regexp_replace(m.name, '[^a-zA-Z0-9]', '', 'g')) LIKE ${nqPattern}
            OR similarity(a."assetTag", ${q}) > ${trigramThreshold} OR similarity(m.name, ${q}) > ${trigramThreshold}
            OR similarity(COALESCE(a."customName", ''), ${q}) > ${trigramThreshold}
            OR EXISTS(SELECT 1 FROM unnest(a.tags) t WHERE t ILIKE ${ilikePattern})
          )
        ORDER BY match_quality DESC, a."assetTag" ASC LIMIT 10
      `,

      prisma.$queryRaw<BulkAssetRow[]>`
        SELECT b.id, b."assetTag", b."totalQuantity", b."modelId" AS "modelId", m.name AS "modelName",
               GREATEST(similarity(lower(b."assetTag"), ${ql}), similarity(lower(m.name), ${ql})) AS match_quality
        FROM "public"."bulk_asset" b JOIN "public"."model" m ON b."modelId" = m.id
        WHERE b."organizationId" = ${organizationId} AND b."isActive" = true
          AND (
            b."assetTag" ILIKE ${ilikePattern} OR m.name ILIKE ${ilikePattern}
            OR lower(regexp_replace(b."assetTag", '[^a-zA-Z0-9]', '', 'g')) LIKE ${nqPattern}
            OR lower(regexp_replace(m.name, '[^a-zA-Z0-9]', '', 'g')) LIKE ${nqPattern}
            OR similarity(b."assetTag", ${q}) > ${trigramThreshold} OR similarity(m.name, ${q}) > ${trigramThreshold}
            OR EXISTS(SELECT 1 FROM unnest(b.tags) t WHERE t ILIKE ${ilikePattern})
          )
        ORDER BY match_quality DESC, b."assetTag" ASC LIMIT 10
      `,

      prisma.$queryRaw<ProjectRow[]>`
        SELECT p.id, p."projectNumber", p.name, p.status, c.name AS "clientName",
               GREATEST(
                 similarity(lower(p.name), ${ql}),
                 similarity(lower(p."projectNumber"), ${ql}),
                 similarity(lower(COALESCE(c.name, '')), ${ql})
               ) AS match_quality
        FROM "public"."project" p LEFT JOIN "public"."client" c ON p."clientId" = c.id
        WHERE p."organizationId" = ${organizationId} AND p."isTemplate" = false
          AND (
            p.name ILIKE ${ilikePattern} OR p."projectNumber" ILIKE ${ilikePattern}
            OR COALESCE(p.description, '') ILIKE ${ilikePattern} OR COALESCE(c.name, '') ILIKE ${ilikePattern}
            OR lower(regexp_replace(p.name, '[^a-zA-Z0-9]', '', 'g')) LIKE ${nqPattern}
            OR lower(regexp_replace(p."projectNumber", '[^a-zA-Z0-9]', '', 'g')) LIKE ${nqPattern}
            OR similarity(p.name, ${q}) > ${trigramThreshold} OR similarity(p."projectNumber", ${q}) > ${trigramThreshold}
            OR EXISTS(SELECT 1 FROM unnest(p.tags) t WHERE t ILIKE ${ilikePattern})
          )
        ORDER BY match_quality DESC, p.name ASC LIMIT 10
      `,

      prisma.$queryRaw<ClientRow[]>`
        SELECT id, name, "contactName", "contactEmail",
               GREATEST(similarity(lower(name), ${ql}), similarity(lower(COALESCE("contactName", '')), ${ql})) AS match_quality
        FROM "public"."client"
        WHERE "organizationId" = ${organizationId} AND "isActive" = true
          AND (
            name ILIKE ${ilikePattern} OR COALESCE("contactName", '') ILIKE ${ilikePattern}
            OR COALESCE("contactEmail", '') ILIKE ${ilikePattern}
            OR lower(regexp_replace(name, '[^a-zA-Z0-9]', '', 'g')) LIKE ${nqPattern}
            OR similarity(name, ${q}) > ${trigramThreshold} OR similarity(COALESCE("contactName", ''), ${q}) > ${trigramThreshold}
            OR EXISTS(SELECT 1 FROM unnest(tags) t WHERE t ILIKE ${ilikePattern})
          )
        ORDER BY match_quality DESC, name ASC LIMIT 10
      `,

      prisma.$queryRaw<SupplierRow[]>`
        SELECT id, name, "contactName", "accountNumber",
               GREATEST(similarity(lower(name), ${ql}), similarity(lower(COALESCE("contactName", '')), ${ql})) AS match_quality
        FROM "public"."supplier"
        WHERE "organizationId" = ${organizationId} AND "isActive" = true
          AND (
            name ILIKE ${ilikePattern} OR COALESCE("contactName", '') ILIKE ${ilikePattern}
            OR COALESCE("accountNumber", '') ILIKE ${ilikePattern}
            OR COALESCE(email, '') ILIKE ${ilikePattern}
            OR lower(regexp_replace(name, '[^a-zA-Z0-9]', '', 'g')) LIKE ${nqPattern}
            OR similarity(name, ${q}) > ${trigramThreshold} OR similarity(COALESCE("contactName", ''), ${q}) > ${trigramThreshold}
            OR EXISTS(SELECT 1 FROM unnest(tags) t WHERE t ILIKE ${ilikePattern})
          )
        ORDER BY match_quality DESC, name ASC LIMIT 10
      `,

      prisma.$queryRaw<LocationRow[]>`
        SELECT id, name, address,
               similarity(lower(name), ${ql}) AS match_quality
        FROM "public"."location"
        WHERE "organizationId" = ${organizationId}
          AND (
            name ILIKE ${ilikePattern} OR COALESCE(address, '') ILIKE ${ilikePattern}
            OR lower(regexp_replace(name, '[^a-zA-Z0-9]', '', 'g')) LIKE ${nqPattern}
            OR similarity(name, ${q}) > ${trigramThreshold}
            OR EXISTS(SELECT 1 FROM unnest(tags) t WHERE t ILIKE ${ilikePattern})
          )
        ORDER BY match_quality DESC, name ASC LIMIT 5
      `,

      prisma.$queryRaw<CategoryRow[]>`
        SELECT c.id, c.name, c.description,
               (SELECT COUNT(*)::int FROM "public"."model" m WHERE m."categoryId" = c.id AND m."isActive" = true) AS "modelCount",
               similarity(lower(c.name), ${ql}) AS match_quality
        FROM "public"."category" c
        WHERE c."organizationId" = ${organizationId}
          AND (
            c.name ILIKE ${ilikePattern}
            OR COALESCE(c.description, '') ILIKE ${ilikePattern}
            OR lower(regexp_replace(c.name, '[^a-zA-Z0-9]', '', 'g')) LIKE ${nqPattern}
            OR similarity(c.name, ${q}) > ${trigramThreshold}
            OR EXISTS(SELECT 1 FROM unnest(c.tags) t WHERE t ILIKE ${ilikePattern})
          )
        ORDER BY match_quality DESC, c.name ASC LIMIT 5
      `,

      prisma.$queryRaw<MaintenanceRow[]>`
        SELECT id, title, status,
               similarity(lower(title), ${ql}) AS match_quality
        FROM "public"."maintenance_record"
        WHERE "organizationId" = ${organizationId}
          AND (
            title ILIKE ${ilikePattern} OR COALESCE(description, '') ILIKE ${ilikePattern}
            OR lower(regexp_replace(title, '[^a-zA-Z0-9]', '', 'g')) LIKE ${nqPattern}
            OR similarity(title, ${q}) > ${trigramThreshold}
            OR EXISTS(SELECT 1 FROM unnest(tags) t WHERE t ILIKE ${ilikePattern})
          )
        ORDER BY match_quality DESC, title ASC LIMIT 3
      `,

      prisma.$queryRaw<CrewRow[]>`
        SELECT cm.id, cm."firstName", cm."lastName", cm.email, cm.department,
               cr.name AS "roleName",
               GREATEST(
                 similarity(lower(cm."firstName"), ${ql}),
                 similarity(lower(cm."lastName"), ${ql}),
                 similarity(lower(cm."firstName" || ' ' || cm."lastName"), ${ql}),
                 similarity(lower(COALESCE(cm.email, '')), ${ql})
               ) AS match_quality
        FROM "public"."crew_member" cm
        LEFT JOIN "public"."crew_role" cr ON cm."crewRoleId" = cr.id
        WHERE cm."organizationId" = ${organizationId} AND cm."status" != 'ARCHIVED'
          AND (
            cm."firstName" ILIKE ${ilikePattern} OR cm."lastName" ILIKE ${ilikePattern}
            OR (cm."firstName" || ' ' || cm."lastName") ILIKE ${ilikePattern}
            OR COALESCE(cm.email, '') ILIKE ${ilikePattern}
            OR COALESCE(cm.phone, '') ILIKE ${ilikePattern}
            OR COALESCE(cm.department, '') ILIKE ${ilikePattern}
            OR COALESCE(cr.name, '') ILIKE ${ilikePattern}
            OR lower(regexp_replace(cm."firstName" || cm."lastName", '[^a-zA-Z0-9]', '', 'g')) LIKE ${nqPattern}
            OR similarity(cm."firstName" || ' ' || cm."lastName", ${q}) > ${trigramThreshold}
            OR EXISTS(SELECT 1 FROM unnest(cm.tags) t WHERE t ILIKE ${ilikePattern})
          )
        ORDER BY match_quality DESC, cm."lastName" ASC LIMIT 10
      `,
      prisma.$queryRaw<CheckItemRow[]>`
        SELECT ci.id, ci.label, ci.type, ci.category,
               GREATEST(
                 similarity(lower(ci.label), ${ql}),
                 similarity(lower(COALESCE(ci.category, '')), ${ql})
               ) AS match_quality
        FROM "public"."check_item" ci
        WHERE ci."organizationId" = ${organizationId}
          AND (
            ci.label ILIKE ${ilikePattern}
            OR COALESCE(ci.category, '') ILIKE ${ilikePattern}
            OR COALESCE(ci.description, '') ILIKE ${ilikePattern}
            OR lower(regexp_replace(ci.label, '[^a-zA-Z0-9]', '', 'g')) LIKE ${nqPattern}
            OR similarity(ci.label, ${q}) > ${trigramThreshold}
          )
        ORDER BY match_quality DESC, ci.label ASC LIMIT 10
      `,

      prisma.$queryRaw<GroupTemplateRow[]>`
        SELECT gt.id, gt.name, gt.description,
               (SELECT COUNT(*)::int FROM "public"."group_template_item" gti WHERE gti."templateId" = gt.id) AS "itemCount",
               GREATEST(
                 similarity(lower(gt.name), ${ql}),
                 similarity(lower(COALESCE(gt.description, '')), ${ql})
               ) AS match_quality
        FROM "public"."group_template" gt
        WHERE gt."organizationId" = ${organizationId}
          AND (
            gt.name ILIKE ${ilikePattern}
            OR COALESCE(gt.description, '') ILIKE ${ilikePattern}
            OR lower(regexp_replace(gt.name, '[^a-zA-Z0-9]', '', 'g')) LIKE ${nqPattern}
            OR similarity(gt.name, ${q}) > ${trigramThreshold}
          )
        ORDER BY match_quality DESC, gt.name ASC LIMIT 10
      `,

      prisma.$queryRaw<SubHireRow[]>`
        SELECT sh.id, sh."orderNumber", sh.status, s.name AS "supplierName", sh."supplierReference", sh."projectId",
               GREATEST(
                 similarity(lower(sh."orderNumber"), ${ql}),
                 similarity(lower(s.name), ${ql}),
                 similarity(lower(COALESCE(sh."supplierReference", '')), ${ql})
               ) AS match_quality
        FROM "public"."sub_hire" sh
        JOIN "public"."supplier" s ON sh."supplierId" = s.id
        WHERE sh."organizationId" = ${organizationId}
          AND (
            sh."orderNumber" ILIKE ${ilikePattern}
            OR s.name ILIKE ${ilikePattern}
            OR COALESCE(sh."supplierReference", '') ILIKE ${ilikePattern}
            OR COALESCE(sh.notes, '') ILIKE ${ilikePattern}
            OR lower(regexp_replace(sh."orderNumber", '[^a-zA-Z0-9]', '', 'g')) LIKE ${nqPattern}
            OR lower(regexp_replace(s.name, '[^a-zA-Z0-9]', '', 'g')) LIKE ${nqPattern}
            OR similarity(sh."orderNumber", ${q}) > ${trigramThreshold}
            OR similarity(s.name, ${q}) > ${trigramThreshold}
            OR EXISTS(
              SELECT 1 FROM "public"."sub_hire_item" shi
              WHERE shi."subHireId" = sh.id AND shi.description ILIKE ${ilikePattern}
            )
          )
        ORDER BY match_quality DESC, sh."orderNumber" ASC LIMIT 10
      `,
    ]);

  // ─── Fetch children for parent results ─────────────────────────

  const modelIds = models.map((m) => m.id);
  const kitIds = kits.map((k) => k.id);
  const clientIds = clients.map((c) => c.id);
  const locationIds = locations.map((l) => l.id);
  const categoryIds = categories.map((c) => c.id);

  const [childAssets, childBulkAssets, kitItems, clientProjects, locationAssets, locationKits, childLocations, categoryModels, childCategories] =
    await Promise.all([
      modelIds.length > 0
        ? prisma.$queryRaw<ChildAssetRow[]>`
            SELECT a.id, a."assetTag", a."serialNumber", a."customName", a."modelId", a.status
            FROM "public"."asset" a
            WHERE a."modelId" = ANY(${modelIds}) AND a."isActive" = true
            ORDER BY a."modelId", a."assetTag" ASC
          `
        : ([] as ChildAssetRow[]),

      modelIds.length > 0
        ? prisma.$queryRaw<ChildBulkAssetRow[]>`
            SELECT b.id, b."assetTag", b."totalQuantity", b."modelId"
            FROM "public"."bulk_asset" b
            WHERE b."modelId" = ANY(${modelIds}) AND b."isActive" = true
            ORDER BY b."assetTag" ASC
          `
        : ([] as ChildBulkAssetRow[]),

      kitIds.length > 0
        ? prisma.$queryRaw<KitItemRow[]>`
            SELECT a."assetTag", m.name, ksi."assetId", ksi."kitId"
            FROM "public"."kit_serialized_item" ksi
            JOIN "public"."asset" a ON ksi."assetId" = a.id
            JOIN "public"."model" m ON a."modelId" = m.id
            WHERE ksi."kitId" = ANY(${kitIds})
            ORDER BY ksi."sortOrder" ASC, a."assetTag" ASC
          `
        : ([] as KitItemRow[]),

      clientIds.length > 0
        ? prisma.$queryRaw<ClientProjectRow[]>`
            SELECT p.id, p."projectNumber", p.name, p.status, p."clientId"
            FROM "public"."project" p
            WHERE p."clientId" = ANY(${clientIds}) AND p."isTemplate" = false
            ORDER BY p."clientId", p."createdAt" DESC
          `
        : ([] as ClientProjectRow[]),

      locationIds.length > 0
        ? prisma.$queryRaw<LocationChildAssetRow[]>`
            SELECT a.id, a."assetTag", a."customName", m.name AS "modelName", a."locationId"
            FROM "public"."asset" a
            JOIN "public"."model" m ON a."modelId" = m.id
            WHERE a."locationId" = ANY(${locationIds}) AND a."isActive" = true
            ORDER BY a."locationId", a."assetTag" ASC
          `
        : ([] as LocationChildAssetRow[]),

      locationIds.length > 0
        ? prisma.$queryRaw<LocationChildKitRow[]>`
            SELECT k.id, k."assetTag", k.name, k."locationId"
            FROM "public"."kit" k
            WHERE k."locationId" = ANY(${locationIds}) AND k."isActive" = true
            ORDER BY k."locationId", k."assetTag" ASC
          `
        : ([] as LocationChildKitRow[]),

      // Child locations (sub-locations of matched locations)
      locationIds.length > 0
        ? prisma.$queryRaw<ChildLocationRow[]>`
            SELECT id, name, address, "parentId"
            FROM "public"."location"
            WHERE "parentId" = ANY(${locationIds})
            ORDER BY "parentId", name ASC
          `
        : ([] as ChildLocationRow[]),

      categoryIds.length > 0
        ? prisma.$queryRaw<CategoryModelRow[]>`
            SELECT m.id, m.name, m."modelNumber", m.manufacturer, m."categoryId"
            FROM "public"."model" m
            WHERE m."categoryId" = ANY(${categoryIds}) AND m."isActive" = true
            ORDER BY m."categoryId", m.name ASC
          `
        : ([] as CategoryModelRow[]),

      // Child categories (sub-categories of matched categories)
      categoryIds.length > 0
        ? prisma.$queryRaw<ChildCategoryRow[]>`
            SELECT id, name, "parentId"
            FROM "public"."category"
            WHERE "parentId" = ANY(${categoryIds})
            ORDER BY "parentId", name ASC
          `
        : ([] as ChildCategoryRow[]),
    ]);

  // ─── Group children by parent ID ─────────────────────────────

  function groupBy<T>(items: T[], keyFn: (item: T) => string): Map<string, T[]> {
    const map = new Map<string, T[]>();
    for (const item of items) {
      const key = keyFn(item);
      const list = map.get(key) || [];
      list.push(item);
      map.set(key, list);
    }
    return map;
  }

  const assetsByModel = groupBy(childAssets, (a) => a.modelId);
  const bulkByModel = groupBy(childBulkAssets, (b) => b.modelId);
  const itemsByKit = groupBy(kitItems, (ki) => ki.kitId);
  const projectsByClient = groupBy(clientProjects, (p) => p.clientId);
  const assetsByLocation = groupBy(locationAssets, (a) => a.locationId);
  const kitsByLocation = groupBy(locationKits, (k) => k.locationId);
  const subLocationsByParent = groupBy(childLocations, (l) => l.parentId);
  const modelsByCategory = groupBy(categoryModels, (m) => m.categoryId);
  const subCategoriesByParent = groupBy(childCategories, (c) => c.parentId);

  // Track which items appear as children under a parent, so standalone section can skip them
  const shownAsChildAssetIds = new Set<string>();
  const shownAsChildBulkIds = new Set<string>();
  const shownAsChildModelIds = new Set<string>();

  // ─── Build results with children ─────────────────────────────

  const results: SearchResult[] = [];

  // Models + child assets
  for (const m of models) {
    results.push({
      id: m.id, type: "model",
      title: m.name + (m.modelNumber ? ` (${m.modelNumber})` : ""),
      subtitle: [m.manufacturer, m.categoryName].filter(Boolean).join(" · ") || null,
      href: `/assets/models/${m.id}`,
      relevance: Number(m.match_quality) || 0,
    });
    const modelAssets = assetsByModel.get(m.id) || [];
    for (const a of modelAssets) {
      shownAsChildAssetIds.add(a.id);
      results.push({
        id: a.id, type: "asset", isChild: true,
        title: a.assetTag + (a.customName ? ` — ${a.customName}` : ""),
        subtitle: a.status + (a.serialNumber ? ` · SN: ${a.serialNumber}` : ""),
        href: `/assets/registry/${a.id}`, relevance: 0,
      });
    }
    const modelBulk = bulkByModel.get(m.id) || [];
    for (const b of modelBulk) {
      shownAsChildBulkIds.add(b.id);
      results.push({
        id: b.id, type: "bulk-asset", isChild: true,
        title: b.assetTag, subtitle: `${b.totalQuantity} units`,
        href: `/assets/models/${m.id}`, relevance: 0,
      });
    }
  }

  // Kits + contents
  for (const k of kits) {
    results.push({
      id: k.id, type: "kit",
      title: `${k.assetTag} — ${k.name}`,
      subtitle: k.caseType || k.description || null,
      href: `/kits/${k.id}`, relevance: Number(k.match_quality) || 0,
    });
    for (const ki of (itemsByKit.get(k.id) || [])) {
      if (ki.assetId) shownAsChildAssetIds.add(ki.assetId);
      results.push({
        id: ki.assetId || k.id, type: "asset", isChild: true,
        title: ki.assetTag, subtitle: ki.name,
        href: `/assets/registry/${ki.assetId}`, relevance: 0,
      });
    }
  }

  // Standalone assets (skip if already shown as child of a model/kit)
  for (const a of assets) {
    if (shownAsChildAssetIds.has(a.id)) continue;
    results.push({
      id: a.id, type: "asset",
      title: a.assetTag + (a.customName ? ` — ${a.customName}` : ""),
      subtitle: a.modelName + (a.serialNumber ? ` · SN: ${a.serialNumber}` : ""),
      href: `/assets/registry/${a.id}`, relevance: Number(a.match_quality) || 0,
    });
  }

  // Standalone bulk assets (skip if already shown as child of a model)
  for (const b of bulkAssets) {
    if (shownAsChildBulkIds.has(b.id)) continue;
    results.push({
      id: b.id, type: "bulk-asset",
      title: b.assetTag, subtitle: `${b.modelName} (${b.totalQuantity} units)`,
      href: `/assets/models/${b.modelId}`, relevance: Number(b.match_quality) || 0,
    });
  }

  // Clients + child projects (build first so we can track shown project IDs)
  const shownAsChildProjectIds = new Set<string>();
  for (const c of clients) {
    results.push({
      id: c.id, type: "client",
      title: c.name, subtitle: c.contactName || c.contactEmail || null,
      href: `/clients/${c.id}`, relevance: Number(c.match_quality) || 0,
    });
    const cProjects = projectsByClient.get(c.id) || [];
    for (const p of cProjects) {
      shownAsChildProjectIds.add(p.id);
      results.push({
        id: p.id, type: "project", isChild: true,
        title: `${p.projectNumber} — ${p.name}`, subtitle: p.status,
        href: `/projects/${p.id}`, relevance: 0,
        status: p.status,
      });
    }
  }

  // Standalone projects (skip if already shown as child of a client)
  for (const p of projects) {
    if (shownAsChildProjectIds.has(p.id)) continue;
    results.push({
      id: p.id, type: "project",
      title: `${p.projectNumber} — ${p.name}`, subtitle: p.clientName || p.status,
      href: `/projects/${p.id}`, relevance: Number(p.match_quality) || 0,
      status: p.status,
    });
  }

  // Suppliers
  for (const s of suppliers) {
    results.push({
      id: s.id, type: "supplier",
      title: s.name, subtitle: [s.contactName, s.accountNumber ? `Acct: ${s.accountNumber}` : null].filter(Boolean).join(" · ") || null,
      href: `/suppliers/${s.id}`, relevance: Number(s.match_quality) || 0,
    });
  }

  // Locations + child locations + child assets/kits
  for (const l of locations) {
    results.push({
      id: l.id, type: "location",
      title: l.name, subtitle: l.address || null,
      href: `/locations/${l.id}`, relevance: Number(l.match_quality) || 0,
    });
    // Sub-locations
    for (const sub of (subLocationsByParent.get(l.id) || [])) {
      results.push({
        id: sub.id, type: "location", isChild: true,
        title: sub.name, subtitle: sub.address || null,
        href: `/locations/${sub.id}`, relevance: 0,
      });
    }
    // Assets at this location
    const locAssets = assetsByLocation.get(l.id) || [];
    for (const a of locAssets) {
      shownAsChildAssetIds.add(a.id);
      results.push({
        id: a.id, type: "asset", isChild: true,
        title: a.assetTag + (a.customName ? ` — ${a.customName}` : ""),
        subtitle: a.modelName,
        href: `/assets/registry/${a.id}`, relevance: 0,
      });
    }
    // Kits at this location
    for (const k of (kitsByLocation.get(l.id) || [])) {
      results.push({
        id: k.id, type: "kit", isChild: true,
        title: `${k.assetTag} — ${k.name}`, subtitle: null,
        href: `/kits/${k.id}`, relevance: 0,
      });
    }
  }

  // Categories + child categories + child models
  for (const cat of categories) {
    results.push({
      id: cat.id, type: "category",
      title: cat.name, subtitle: `${cat.modelCount} model${cat.modelCount !== 1 ? "s" : ""}`,
      href: `/assets/categories/${cat.id}`, relevance: Number(cat.match_quality) || 0,
    });
    // Sub-categories
    for (const sub of (subCategoriesByParent.get(cat.id) || [])) {
      results.push({
        id: sub.id, type: "category", isChild: true,
        title: sub.name, subtitle: null,
        href: `/assets/categories/${sub.id}`, relevance: 0,
      });
    }
    // Models in this category
    const catModels = modelsByCategory.get(cat.id) || [];
    for (const m of catModels) {
      shownAsChildModelIds.add(m.id);
      results.push({
        id: m.id, type: "model", isChild: true,
        title: m.name + (m.modelNumber ? ` (${m.modelNumber})` : ""),
        subtitle: m.manufacturer || null,
        href: `/assets/models/${m.id}`, relevance: 0,
      });
    }
  }

  // Maintenance
  for (const mr of maintenance) {
    results.push({
      id: mr.id, type: "maintenance",
      title: mr.title, subtitle: mr.status,
      href: `/maintenance/${mr.id}`, relevance: Number(mr.match_quality) || 0,
    });
  }

  // Crew members
  for (const c of crew) {
    results.push({
      id: c.id, type: "crew",
      title: `${c.firstName} ${c.lastName}`,
      subtitle: [c.roleName, c.department].filter(Boolean).join(" · ") || c.email || null,
      href: `/crew/${c.id}`, relevance: Number(c.match_quality) || 0,
    });
  }

  // Check items
  for (const ci of checkItems) {
    const typeLabel = ci.type === "PASS_FAIL" ? "Pass/Fail" : ci.type === "NOTES" ? "Notes" : ci.type === "MEASUREMENT" ? "Measurement" : "Dropdown";
    results.push({
      id: ci.id, type: "check-item",
      title: ci.label,
      subtitle: [typeLabel, ci.category].filter(Boolean).join(" · "),
      href: `/settings/check-items`, relevance: Number(ci.match_quality) || 0,
    });
  }

  // Group templates
  for (const gt of groupTemplates) {
    results.push({
      id: gt.id, type: "group-template",
      title: gt.name,
      subtitle: gt.description ?? `${gt.itemCount} item${gt.itemCount !== 1 ? "s" : ""}`,
      href: `/settings/group-templates`, relevance: Number(gt.match_quality) || 0,
    });
  }

  // Sub-hires (managed via project equipment tab — link to the project, falling
  // back to the global suppliers page when the sub-hire isn't tied to a project)
  for (const sh of subHires) {
    const href = sh.projectId
      ? `/projects/${sh.projectId}?tab=equipment&subHireId=${sh.id}`
      : `/suppliers`;
    results.push({
      id: sh.id, type: "sub-hire",
      title: `${sh.orderNumber} — ${sh.supplierName}`,
      subtitle: [sh.status, sh.supplierReference].filter(Boolean).join(" · ") || null,
      href, relevance: Number(sh.match_quality) || 0,
    });
  }

  // ─── Sort by relevance, keeping parent-child groups together ───
  // Split results into groups: each parent + its trailing children
  type ResultGroup = { parent: SearchResult; children: SearchResult[] };
  const groups: ResultGroup[] = [];
  for (const r of results) {
    if (r.isChild && groups.length > 0) {
      groups[groups.length - 1].children.push(r);
    } else {
      groups.push({ parent: r, children: [] });
    }
  }

  // Small type boost so models sort above assets/bulk-assets at similar relevance
  const typeBoost: Record<string, number> = {
    model: 0.05,
    category: 0.02,
    kit: 0.01,
  };

  groups.sort((a, b) => {
    const aScore = a.parent.relevance + (typeBoost[a.parent.type] || 0);
    const bScore = b.parent.relevance + (typeBoost[b.parent.type] || 0);
    return bScore - aScore; // Higher = better
  });

  // Flatten back
  const sorted: SearchResult[] = [];
  for (const g of groups) {
    sorted.push(g.parent);
    sorted.push(...g.children);
  }

  return serialize({ results: sorted });
}
