/* eslint-disable @typescript-eslint/no-explicit-any */
import { prisma } from "@/lib/prisma";
import { uploadToS3, ensureBucket } from "@/lib/storage";
import { getConvexClient } from "@/lib/convex-client";
import { api } from "../../convex/_generated/api";
import { MANIFEST_VERSION, type OrgExportManifest } from "./org-transfer-types";
import { createId } from "@paralleldrive/cuid2";
import unzipper from "unzipper";

type Rec = Record<string, any>;

/** Parse a date value safely, falling back to now() for invalid values */
function safeDate(value: unknown): Date {
  if (!value) return new Date();
  const d = new Date(value as string);
  return isNaN(d.getTime()) ? new Date() : d;
}

/** Parse an optional date value, returning undefined for missing/invalid */
function safeDateOpt(value: unknown): Date | undefined {
  if (!value) return undefined;
  const d = new Date(value as string);
  return isNaN(d.getTime()) ? undefined : d;
}

/**
 * Import an organization from a zip archive buffer.
 * Creates a brand-new org with all data and media re-uploaded to S3.
 */
export async function importOrganization(
  zipBuffer: Buffer,
  options: { newOrgName?: string; newOrgSlug?: string; importedByUserId?: string } = {}
) {
  // ── Extract manifest and files from zip ──────────────────────────
  let manifest: OrgExportManifest | null = null;
  const files = new Map<string, Buffer>();

  const MAX_TOTAL_DECOMPRESSED = 500 * 1024 * 1024; // 500MB
  const MAX_SINGLE_ENTRY = 100 * 1024 * 1024; // 100MB per file
  let totalDecompressed = 0;

  const directory = await unzipper.Open.buffer(zipBuffer);
  for (const entry of directory.files) {
    // ZIP Slip protection: reject path traversal and absolute paths
    if (entry.path.includes("..") || entry.path.startsWith("/") || entry.path.includes("\0")) {
      throw new Error(`Invalid entry path in archive: ${entry.path}`);
    }

    const buf = await entry.buffer();

    // Decompression bomb protection
    if (buf.length > MAX_SINGLE_ENTRY) {
      throw new Error(`Entry exceeds size limit: ${entry.path} (${buf.length} bytes)`);
    }
    totalDecompressed += buf.length;
    if (totalDecompressed > MAX_TOTAL_DECOMPRESSED) {
      throw new Error(`Total decompressed size exceeds limit (${MAX_TOTAL_DECOMPRESSED} bytes)`);
    }

    if (entry.path === "manifest.json") {
      manifest = JSON.parse(buf.toString("utf-8")) as OrgExportManifest;
    } else if (entry.path.startsWith("files/")) {
      const safeKey = entry.path.replace("files/", "");
      if (safeKey.includes("..")) {
        throw new Error(`Invalid file path in archive: ${safeKey}`);
      }
      files.set(safeKey, buf);
    }
  }

  if (!manifest) throw new Error("Invalid export: manifest.json not found");
  if (manifest.version !== MANIFEST_VERSION) {
    throw new Error(`Unsupported manifest version: ${manifest.version}`);
  }

  // ── ID remapping helpers ─────────────────────────────────────────
  const idMaps: Record<string, Map<string, string>> = {};
  function getMap(entity: string) {
    if (!idMaps[entity]) idMaps[entity] = new Map();
    return idMaps[entity];
  }
  function remap(entity: string, oldId: string | null | undefined): string | null | undefined {
    if (!oldId) return undefined;
    return getMap(entity).get(oldId) ?? undefined;
  }
  function newId(entity: string, oldId: string): string {
    const id = createId();
    getMap(entity).set(oldId, id);
    return id;
  }

  // Resolve user IDs by email
  const userEmailMap = manifest.userEmailMap;
  const userIdMap = new Map<string, string>();
  const allEmails = Object.values(userEmailMap);
  if (allEmails.length > 0) {
    const existingUsers = await prisma.user.findMany({
      where: { email: { in: allEmails } },
      select: { id: true, email: true },
    });
    const emailToNewId = new Map(existingUsers.map((u) => [u.email, u.id]));
    for (const [oldUserId, email] of Object.entries(userEmailMap)) {
      const newUserId = emailToNewId.get(email);
      if (newUserId) userIdMap.set(oldUserId, newUserId);
    }
  }
  function remapUser(oldId: string | null | undefined): string | undefined {
    if (!oldId) return undefined;
    return userIdMap.get(oldId) ?? undefined;
  }
  /** For required user FK fields — falls back to the importing admin */
  function remapUserRequired(oldId: string | null | undefined): string {
    return remapUser(oldId) ?? options.importedByUserId ?? Object.values(Object.fromEntries(userIdMap))[0] ?? "";
  }

  // ── Create the new organization ──────────────────────────────────
  const srcOrg = manifest.organization as Rec;
  const newOrgId = createId();
  const orgName = options.newOrgName || `${srcOrg.name} (Import)`;
  const orgSlug =
    options.newOrgSlug ||
    `${srcOrg.slug}-import-${Date.now().toString(36)}`;

  await prisma.organization.create({
    data: {
      id: newOrgId,
      name: orgName,
      slug: orgSlug,
      logo: srcOrg.logo || null,
      metadata: srcOrg.metadata ?? {},
      createdAt: new Date(),
    },
  });

  // ── Helper: strip relation/computed fields, keep scalar data ─────
  function stripRelations(rec: Rec, exclude: string[] = []): Rec {
    const skip = new Set([
      "id", "organizationId",
      // Common relation fields that get serialized
      "organization", "model", "asset", "bulkAsset", "kit", "category",
      "location", "supplier", "client", "project", "user",
      "members", "assets", "children", "parent",
      "lineItems", "scanLogs", "media", "files",
      "maintenanceRecord", "testTagAsset", "testedBy",
      "reportedBy", "assignedTo", "projectManager",
      "scannedBy", "checkedOutBy", "returnedBy",
      "addedBy", "uploadedBy", "file",
      ...exclude,
    ]);
    const result: Rec = {};
    for (const [key, value] of Object.entries(rec)) {
      if (skip.has(key)) continue;
      // Skip nested objects (relations) but keep arrays of primitives and JSON
      if (value && typeof value === "object" && !Array.isArray(value) && !(value instanceof Date)) {
        // Could be a JSON field — include it if it looks like a plain object/config
        // Relations typically have an 'id' field
        if ("id" in value) continue; // relation object
        result[key] = value; // JSON field
      } else {
        result[key] = value;
      }
    }
    return result;
  }

  // ── Helper: insert records with hierarchy (topological sort) ─────
  async function insertWithHierarchy(
    entity: string,
    records: Rec[],
    createFn: (rec: Rec, mappedId: string) => Promise<void>
  ) {
    const children = new Map<string, Rec[]>();
    const roots: Rec[] = [];

    for (const r of records) {
      const pid = r.parentId as string | null;
      if (!pid) {
        roots.push(r);
      } else {
        if (!children.has(pid)) children.set(pid, []);
        children.get(pid)!.push(r);
      }
    }

    const queue = [...roots];
    while (queue.length > 0) {
      const rec = queue.shift()!;
      const oldId = rec.id as string;
      const mappedId = newId(entity, oldId);
      await createFn(rec, mappedId);
      const kids = children.get(oldId) || [];
      queue.push(...kids);
    }
  }

  // ── 1. Custom Roles ──────────────────────────────────────────────
  for (const r of manifest.customRoles as Rec[]) {
    const id = newId("customRole", r.id);
    await prisma.customRole.create({
      data: {
        ...stripRelations(r),
        id,
        organizationId: newOrgId,
        createdAt: safeDate(r.createdAt),
        updatedAt: safeDate(r.updatedAt),
      } as any,
    });
  }

  // ── 2. Categories (hierarchical) ─────────────────────────────────
  await insertWithHierarchy("category", manifest.categories as Rec[], async (r, id) => {
    await prisma.category.create({
      data: {
        ...stripRelations(r),
        id,
        organizationId: newOrgId,
        parentId: remap("category", r.parentId),
        createdAt: safeDate(r.createdAt),
        updatedAt: safeDate(r.updatedAt),
      } as any,
    });
  });

  // ── 3. Locations (hierarchical) ──────────────────────────────────
  await insertWithHierarchy("location", manifest.locations as Rec[], async (r, id) => {
    await prisma.location.create({
      data: {
        ...stripRelations(r),
        id,
        organizationId: newOrgId,
        parentId: remap("location", r.parentId),
        createdAt: safeDate(r.createdAt),
        updatedAt: safeDate(r.updatedAt),
      } as any,
    });
  });

  // ── 4. Suppliers ─────────────────────────────────────────────────
  for (const r of manifest.suppliers as Rec[]) {
    const id = newId("supplier", r.id);
    await prisma.supplier.create({
      data: {
        ...stripRelations(r),
        id,
        organizationId: newOrgId,
        createdAt: safeDate(r.createdAt),
        updatedAt: safeDate(r.updatedAt),
      } as any,
    });
  }

  // ── 5. Models ────────────────────────────────────────────────────
  for (const r of manifest.models as Rec[]) {
    const id = newId("model", r.id);
    await prisma.model.create({
      data: {
        ...stripRelations(r),
        id,
        organizationId: newOrgId,
        categoryId: remap("category", r.categoryId),
        createdAt: safeDate(r.createdAt),
        updatedAt: safeDate(r.updatedAt),
      } as any,
    });
  }

  // ── 6. Kits ──────────────────────────────────────────────────────
  for (const r of manifest.kits as Rec[]) {
    const id = newId("kit", r.id);
    await prisma.kit.create({
      data: {
        ...stripRelations(r),
        id,
        organizationId: newOrgId,
        categoryId: remap("category", r.categoryId),
        locationId: remap("location", r.locationId),
        createdAt: safeDate(r.createdAt),
        updatedAt: safeDate(r.updatedAt),
      } as any,
    });
  }

  // ── 7. Assets ────────────────────────────────────────────────────
  for (const r of manifest.assets as Rec[]) {
    const id = newId("asset", r.id);
    await prisma.asset.create({
      data: {
        ...stripRelations(r),
        id,
        organizationId: newOrgId,
        modelId: remap("model", r.modelId)!,
        supplierId: remap("supplier", r.supplierId),
        supplierOrderId: remap("supplierOrder", r.supplierOrderId),
        locationId: remap("location", r.locationId),
        kitId: remap("kit", r.kitId),
        purchaseDate: safeDateOpt(r.purchaseDate),
        warrantyExpiry: safeDateOpt(r.warrantyExpiry),
        lastTestAndTagDate: safeDateOpt(r.lastTestAndTagDate),
        nextTestAndTagDate: safeDateOpt(r.nextTestAndTagDate),
        createdAt: safeDate(r.createdAt),
        updatedAt: safeDate(r.updatedAt),
      } as any,
    });
  }

  // ── 8. Bulk Assets ───────────────────────────────────────────────
  for (const r of manifest.bulkAssets as Rec[]) {
    const id = newId("bulkAsset", r.id);
    await prisma.bulkAsset.create({
      data: {
        ...stripRelations(r),
        id,
        organizationId: newOrgId,
        modelId: remap("model", r.modelId)!,
        locationId: remap("location", r.locationId),
        createdAt: safeDate(r.createdAt),
        updatedAt: safeDate(r.updatedAt),
      } as any,
    });
  }

  // ── 9. Kit Serialized Items ──────────────────────────────────────
  for (const r of manifest.kitSerializedItems as Rec[]) {
    const id = newId("kitSerializedItem", r.id);
    await prisma.kitSerializedItem.create({
      data: {
        id,
        organizationId: newOrgId,
        kitId: remap("kit", r.kitId)!,
        assetId: remap("asset", r.assetId)!,
        position: r.position ?? null,
        sortOrder: r.sortOrder ?? 0,
        addedAt: safeDate(r.addedAt ?? r.createdAt),
        addedById: remapUserRequired(r.addedById),
        notes: r.notes ?? null,
      } as any,
    });
  }

  // ── 10. Kit Bulk Items ───────────────────────────────────────────
  for (const r of manifest.kitBulkItems as Rec[]) {
    const id = newId("kitBulkItem", r.id);
    await prisma.kitBulkItem.create({
      data: {
        id,
        organizationId: newOrgId,
        kitId: remap("kit", r.kitId)!,
        bulkAssetId: remap("bulkAsset", r.bulkAssetId)!,
        quantity: r.quantity,
        position: r.position ?? null,
        sortOrder: r.sortOrder ?? 0,
        addedAt: safeDate(r.addedAt ?? r.createdAt),
        addedById: remapUserRequired(r.addedById),
        notes: r.notes ?? null,
      } as any,
    });
  }

  // ── 11. Clients (live in Convex) ─────────────────────────────────
  for (const r of manifest.clients as Rec[]) {
    const id = newId("client", r.id);
    await getConvexClient().mutation(api.clients.create, {
      id,
      organizationId: newOrgId,
      name: String(r.name),
      type: (r.type as any) ?? "COMPANY",
      contactName: r.contactName ?? undefined,
      contactEmail: r.contactEmail ?? undefined,
      contactPhone: r.contactPhone ?? undefined,
      billingAddress: r.billingAddress ?? undefined,
      billingLatitude: r.billingLatitude ?? undefined,
      billingLongitude: r.billingLongitude ?? undefined,
      shippingAddress: r.shippingAddress ?? undefined,
      shippingLatitude: r.shippingLatitude ?? undefined,
      shippingLongitude: r.shippingLongitude ?? undefined,
      taxId: r.taxId ?? undefined,
      paymentTerms: r.paymentTerms ?? undefined,
      defaultDiscount: r.defaultDiscount ?? undefined,
      notes: r.notes ?? undefined,
      tags: (r.tags as string[]) ?? [],
      isActive: r.isActive ?? true,
      createdAt: safeDate(r.createdAt).getTime(),
      updatedAt: safeDate(r.updatedAt).getTime(),
    });
  }

  // ── 12. Projects ─────────────────────────────────────────────────
  for (const r of manifest.projects as Rec[]) {
    const id = newId("project", r.id);
    await prisma.project.create({
      data: {
        ...stripRelations(r, ["_count"]),
        id,
        organizationId: newOrgId,
        clientId: remap("client", r.clientId),
        locationId: remap("location", r.locationId),
        projectManagerId: remapUser(r.projectManagerId),
        loadInDate: safeDateOpt(r.loadInDate),
        eventStartDate: safeDateOpt(r.eventStartDate),
        eventEndDate: safeDateOpt(r.eventEndDate),
        loadOutDate: safeDateOpt(r.loadOutDate),
        rentalStartDate: safeDateOpt(r.rentalStartDate),
        rentalEndDate: safeDateOpt(r.rentalEndDate),
        createdAt: safeDate(r.createdAt),
        updatedAt: safeDate(r.updatedAt),
      } as any,
    });
  }

  // ── 12b. Supplier Orders ────────────────────────────────────────────
  for (const r of (manifest.supplierOrders ?? []) as Rec[]) {
    const id = newId("supplierOrder", r.id);
    await prisma.supplierOrder.create({
      data: {
        ...stripRelations(r),
        id,
        organizationId: newOrgId,
        supplierId: remap("supplier", r.supplierId)!,
        projectId: remap("project", r.projectId),
        createdById: remapUser(r.createdById),
        orderDate: safeDateOpt(r.orderDate),
        expectedDate: safeDateOpt(r.expectedDate),
        receivedDate: safeDateOpt(r.receivedDate),
        createdAt: safeDate(r.createdAt),
        updatedAt: safeDate(r.updatedAt),
      } as any,
    });
  }

  // ── 12c. Supplier Order Items ──────────────────────────────────────
  for (const r of (manifest.supplierOrderItems ?? []) as Rec[]) {
    const id = newId("supplierOrderItem", r.id);
    const orderId = remap("supplierOrder", r.orderId);
    if (!orderId) continue;
    await prisma.supplierOrderItem.create({
      data: {
        id,
        orderId,
        description: r.description as string,
        quantity: r.quantity ?? 1,
        unitPrice: r.unitPrice ?? null,
        lineTotal: r.lineTotal ?? null,
        modelId: remap("model", r.modelId),
        assetId: remap("asset", r.assetId),
        notes: r.notes ?? null,
        sortOrder: r.sortOrder ?? 0,
      } as any,
    });
  }

  // ── 13. Project Line Items (with parent hierarchy for kit children) ──
  await insertWithHierarchy("projectLineItem", manifest.projectLineItems as Rec[], async (r, id) => {
    await prisma.projectLineItem.create({
      data: {
        ...stripRelations(r),
        id,
        organizationId: newOrgId,
        projectId: remap("project", r.projectId)!,
        modelId: remap("model", r.modelId),
        assetId: remap("asset", r.assetId),
        bulkAssetId: remap("bulkAsset", r.bulkAssetId),
        kitId: remap("kit", r.kitId),
        parentLineItemId: remap("projectLineItem", r.parentLineItemId),
        supplierOrderId: remap("supplierOrder", r.supplierOrderId),
        checkedOutById: remapUser(r.checkedOutById),
        returnedById: remapUser(r.returnedById),
        checkedOutAt: safeDateOpt(r.checkedOutAt),
        returnedAt: safeDateOpt(r.returnedAt),
        createdAt: safeDate(r.createdAt),
        updatedAt: safeDate(r.updatedAt),
      } as any,
    });
  });

  // ── 14. Asset Scan Logs ──────────────────────────────────────────
  for (const r of manifest.assetScanLogs as Rec[]) {
    const scannedById = remapUser(r.scannedById);
    if (!scannedById) continue;
    const id = newId("assetScanLog", r.id);
    await prisma.assetScanLog.create({
      data: {
        ...stripRelations(r),
        id,
        organizationId: newOrgId,
        assetId: remap("asset", r.assetId),
        bulkAssetId: remap("bulkAsset", r.bulkAssetId),
        kitId: remap("kit", r.kitId),
        projectId: remap("project", r.projectId),
        scannedById,
        scannedAt: safeDate(r.scannedAt),
      } as any,
    });
  }

  // ── 15. Maintenance Records ──────────────────────────────────────
  for (const r of manifest.maintenanceRecords as Rec[]) {
    const id = newId("maintenanceRecord", r.id);
    await prisma.maintenanceRecord.create({
      data: {
        ...stripRelations(r),
        id,
        organizationId: newOrgId,
        kitId: remap("kit", r.kitId),
        reportedById: remapUser(r.reportedById),
        assignedToId: remapUser(r.assignedToId),
        scheduledDate: safeDateOpt(r.scheduledDate),
        completedDate: safeDateOpt(r.completedDate),
        createdAt: safeDate(r.createdAt),
        updatedAt: safeDate(r.updatedAt),
      } as any,
    });
  }

  // ── 16. Maintenance Record Assets ────────────────────────────────
  for (const r of manifest.maintenanceRecordAssets as Rec[]) {
    const mrId = remap("maintenanceRecord", r.maintenanceRecordId);
    const assetId = remap("asset", r.assetId);
    if (!mrId || !assetId) continue;
    await prisma.maintenanceRecordAsset.create({
      data: {
        id: createId(),
        maintenanceRecordId: mrId,
        assetId,
      },
    });
  }

  // ── 17. Test Tag Assets ──────────────────────────────────────────
  for (const r of manifest.testTagAssets as Rec[]) {
    const id = newId("testTagAsset", r.id);
    await prisma.testTagAsset.create({
      data: {
        ...stripRelations(r),
        id,
        organizationId: newOrgId,
        assetId: remap("asset", r.assetId),
        bulkAssetId: remap("bulkAsset", r.bulkAssetId),
        lastTestDate: safeDateOpt(r.lastTestDate),
        nextDueDate: safeDateOpt(r.nextDueDate),
        createdAt: safeDate(r.createdAt),
        updatedAt: safeDate(r.updatedAt),
      } as any,
    });
  }

  // ── 18. Test Tag Records ─────────────────────────────────────────
  for (const r of manifest.testTagRecords as Rec[]) {
    const testTagAssetId = remap("testTagAsset", r.testTagAssetId);
    const testedById = remapUser(r.testedById);
    if (!testTagAssetId || !testedById) continue;
    const id = newId("testTagRecord", r.id);
    await prisma.testTagRecord.create({
      data: {
        ...stripRelations(r),
        id,
        organizationId: newOrgId,
        testTagAssetId,
        testedById,
        testDate: safeDate(r.testDate),
        nextTestDate: safeDateOpt(r.nextTestDate),
        createdAt: safeDate(r.createdAt),
      } as any,
    });
  }

  // ── 19. Activity Logs ───────────────────────────────────────────
  for (const r of (manifest.activityLogs ?? []) as Rec[]) {
    const id = newId("activityLog", r.id);
    const userId = remapUser(r.userId);
    await prisma.activityLog.create({
      data: {
        ...stripRelations(r),
        id,
        organizationId: newOrgId,
        userId: userId || null,
        projectId: r.projectId ? (remap("project", r.projectId) ?? null) : null,
        assetId: r.assetId ? (remap("asset", r.assetId) ?? null) : null,
        kitId: r.kitId ? (remap("kit", r.kitId) ?? null) : null,
        entityId: r.entityId as string,
        createdAt: safeDate(r.createdAt),
      } as any,
    });
  }

  // ── 19c. Saved Reports ──────────────────────────────────────────
  for (const r of (manifest.savedReports ?? []) as Rec[]) {
    const id = newId("savedReport", r.id);
    await prisma.savedReport.create({
      data: {
        ...stripRelations(r),
        id,
        organizationId: newOrgId,
        createdById: remapUser(r.createdById),
        createdAt: safeDate(r.createdAt),
        updatedAt: safeDate(r.updatedAt),
      } as any,
    });
  }

  // ── 20. File Uploads (re-upload to S3) ───────────────────────────
  const urlMap = new Map<string, string>(); // old URL -> new URL
  if (files.size > 0) {
    await ensureBucket();
  }
  for (const r of manifest.fileUploads as Rec[]) {
    const id = newId("fileUpload", r.id);
    const oldKey = r.storageKey as string;
    const oldUrl = r.url as string;
    const fileData = files.get(oldKey);
    let newStorageKey = oldKey;
    let newUrl = oldUrl;

    if (fileData) {
      const result = await uploadToS3(fileData, {
        organizationId: newOrgId,
        folder: "imported",
        entityId: id,
        fileName: r.fileName as string,
        mimeType: r.mimeType as string,
      });
      newStorageKey = result.storageKey;
      newUrl = result.url;
      // Track URL mapping for updating image/images fields on models/assets/kits
      if (oldUrl) urlMap.set(oldUrl, newUrl);
    }

    await prisma.fileUpload.create({
      data: {
        ...stripRelations(r),
        id,
        organizationId: newOrgId,
        storageKey: newStorageKey,
        url: newUrl,
        thumbnailUrl: null, // Thumbnails aren't exported; clear to avoid 403 on old org URLs
        uploadedById: remapUserRequired(r.uploadedById),
        createdAt: safeDate(r.createdAt),
        updatedAt: safeDate(r.updatedAt),
      } as any,
    });
  }

  // ── 19b. Update image URL references on models, assets, kits ────
  if (urlMap.size > 0) {
    const remapUrl = (url: string | null | undefined): string | null => {
      if (!url) return null;
      return urlMap.get(url) ?? url;
    };
    const remapUrls = (urls: string[] | null | undefined): string[] => {
      if (!urls || !Array.isArray(urls)) return [];
      return urls.map((u) => urlMap.get(u) ?? u);
    };

    // Update models
    for (const r of manifest.models as Rec[]) {
      const newModelId = remap("model", r.id);
      if (!newModelId) continue;
      const hasImage = r.image && urlMap.has(r.image);
      const hasImages = r.images?.length && r.images.some((u: string) => urlMap.has(u));
      const hasManuals = r.manuals?.length && r.manuals.some((u: string) => urlMap.has(u));
      if (hasImage || hasImages || hasManuals) {
        await prisma.model.update({
          where: { id: newModelId },
          data: {
            ...(hasImage ? { image: remapUrl(r.image) } : {}),
            ...(hasImages ? { images: remapUrls(r.images) } : {}),
            ...(hasManuals ? { manuals: remapUrls(r.manuals) } : {}),
          },
        });
      }
    }

    // Update assets
    for (const r of manifest.assets as Rec[]) {
      const newAssetId = remap("asset", r.id);
      if (!newAssetId) continue;
      const hasImages = r.images?.length && r.images.some((u: string) => urlMap.has(u));
      if (hasImages) {
        await prisma.asset.update({
          where: { id: newAssetId },
          data: { images: remapUrls(r.images) },
        });
      }
    }

    // Update kits
    for (const r of manifest.kits as Rec[]) {
      const newKitId = remap("kit", r.id);
      if (!newKitId) continue;
      const hasImage = r.image && urlMap.has(r.image);
      const hasImages = r.images?.length && r.images.some((u: string) => urlMap.has(u));
      if (hasImage || hasImages) {
        await prisma.kit.update({
          where: { id: newKitId },
          data: {
            ...(hasImage ? { image: remapUrl(r.image) } : {}),
            ...(hasImages ? { images: remapUrls(r.images) } : {}),
          },
        });
      }
    }
  }

  // ── 20. Media link tables ────────────────────────────────────────
  const mediaConfigs = [
    { records: manifest.modelMedia as Rec[], fkField: "modelId", fkEntity: "model", create: (d: any) => prisma.modelMedia.create({ data: d }) },
    { records: manifest.assetMedia as Rec[], fkField: "assetId", fkEntity: "asset", create: (d: any) => prisma.assetMedia.create({ data: d }) },
    { records: manifest.kitMedia as Rec[], fkField: "kitId", fkEntity: "kit", create: (d: any) => prisma.kitMedia.create({ data: d }) },
    { records: manifest.projectMedia as Rec[], fkField: "projectId", fkEntity: "project", create: (d: any) => prisma.projectMedia.create({ data: d }) },
    { records: manifest.clientMedia as Rec[], fkField: "clientId", fkEntity: "client", create: (d: any) => prisma.clientMedia.create({ data: d }) },
    { records: manifest.locationMedia as Rec[], fkField: "locationId", fkEntity: "location", create: (d: any) => prisma.locationMedia.create({ data: d }) },
  ];

  for (const { records, fkField, fkEntity, create } of mediaConfigs) {
    for (const r of records) {
      const fkId = remap(fkEntity, r[fkField]);
      const fileId = remap("fileUpload", r.fileId);
      if (!fkId || !fileId) continue;
      await create({
        ...stripRelations(r),
        id: createId(),
        organizationId: newOrgId,
        [fkField]: fkId,
        fileId,
        createdAt: safeDate(r.createdAt),
      });
    }
  }

  // ── 20a. Group templates (Track B) ──────────────────────────────
  for (const r of (manifest.groupTemplates ?? []) as Rec[]) {
    const id = newId("groupTemplate", r.id);
    await prisma.groupTemplate.create({
      data: {
        ...stripRelations(r),
        id,
        organizationId: newOrgId,
        createdAt: safeDate(r.createdAt),
        updatedAt: safeDate(r.updatedAt),
      } as any,
    });
  }
  for (const r of (manifest.groupTemplateItems ?? []) as Rec[]) {
    const templateId = remap("groupTemplate", r.templateId);
    if (!templateId) continue;
    await prisma.groupTemplateItem.create({
      data: {
        ...stripRelations(r),
        id: createId(),
        organizationId: newOrgId,
        templateId,
        modelId: remap("model", r.modelId),
        kitId: remap("kit", r.kitId),
      } as any,
    });
  }

  // ── 20b. Crew (FEATUREDOCS/31, Track B) ─────────────────────────
  // Roles + skills first (no dependencies), then members (which can reference
  // a role and a linked platform user), then certifications, assignments,
  // shifts, availability, and time entries.
  for (const r of (manifest.crewRoles ?? []) as Rec[]) {
    const id = newId("crewRole", r.id);
    await prisma.crewRole.create({
      data: {
        ...stripRelations(r),
        id,
        organizationId: newOrgId,
      } as any,
    });
  }
  for (const r of (manifest.crewSkills ?? []) as Rec[]) {
    const id = newId("crewSkill", r.id);
    await prisma.crewSkill.create({
      data: {
        ...stripRelations(r),
        id,
        organizationId: newOrgId,
      } as any,
    });
  }
  for (const r of (manifest.crewMembers ?? []) as Rec[]) {
    const id = newId("crewMember", r.id);
    await prisma.crewMember.create({
      data: {
        ...stripRelations(r),
        id,
        organizationId: newOrgId,
        crewRoleId: remap("crewRole", r.crewRoleId),
        userId: remapUser(r.userId),
        // Drop icalToken (unique field) so the new org can opt back in
        icalEnabled: false,
        icalToken: null,
        dateOfBirth: safeDateOpt(r.dateOfBirth),
        createdAt: safeDate(r.createdAt),
        updatedAt: safeDate(r.updatedAt),
      } as any,
    });
  }
  // Re-link crew members <-> skills (implicit m:n join table)
  for (const link of (manifest.crewMemberSkills ?? []) as Array<{
    crewMemberId: string;
    skillId: string;
  }>) {
    const memberId = remap("crewMember", link.crewMemberId);
    const skillId = remap("crewSkill", link.skillId);
    if (!memberId || !skillId) continue;
    await prisma.crewMember.update({
      where: { id: memberId },
      data: { skills: { connect: { id: skillId } } },
    });
  }
  for (const r of (manifest.crewCertifications ?? []) as Rec[]) {
    const crewMemberId = remap("crewMember", r.crewMemberId);
    if (!crewMemberId) continue;
    await prisma.crewCertification.create({
      data: {
        ...stripRelations(r),
        id: createId(),
        crewMemberId,
        issuedDate: safeDateOpt(r.issuedDate),
        expiryDate: safeDateOpt(r.expiryDate),
      } as any,
    });
  }
  for (const r of (manifest.crewAssignments ?? []) as Rec[]) {
    const projectId = remap("project", r.projectId);
    const crewMemberId = remap("crewMember", r.crewMemberId);
    if (!projectId || !crewMemberId) continue;
    const id = newId("crewAssignment", r.id);
    await prisma.crewAssignment.create({
      data: {
        ...stripRelations(r),
        id,
        organizationId: newOrgId,
        projectId,
        crewMemberId,
        crewRoleId: remap("crewRole", r.crewRoleId),
        confirmedById: remapUser(r.confirmedById),
        // Drop responseToken (unique) so old links don't conflict
        responseToken: null,
        startDate: safeDateOpt(r.startDate),
        endDate: safeDateOpt(r.endDate),
        offeredAt: safeDateOpt(r.offeredAt),
        respondedAt: safeDateOpt(r.respondedAt),
        confirmedAt: safeDateOpt(r.confirmedAt),
        createdAt: safeDate(r.createdAt),
        updatedAt: safeDate(r.updatedAt),
      } as any,
    });
  }
  for (const r of (manifest.crewShifts ?? []) as Rec[]) {
    const assignmentId = remap("crewAssignment", r.assignmentId);
    if (!assignmentId) continue;
    await prisma.crewShift.create({
      data: {
        ...stripRelations(r),
        id: createId(),
        assignmentId,
        date: safeDate(r.date),
      } as any,
    });
  }
  for (const r of (manifest.crewAvailability ?? []) as Rec[]) {
    const crewMemberId = remap("crewMember", r.crewMemberId);
    if (!crewMemberId) continue;
    await prisma.crewAvailability.create({
      data: {
        ...stripRelations(r),
        id: createId(),
        crewMemberId,
        startDate: safeDate(r.startDate),
        endDate: safeDate(r.endDate),
        createdAt: safeDate(r.createdAt),
        updatedAt: safeDate(r.updatedAt),
      } as any,
    });
  }
  for (const r of (manifest.crewTimeEntries ?? []) as Rec[]) {
    const crewMemberId = remap("crewMember", r.crewMemberId);
    if (!crewMemberId) continue;
    await prisma.crewTimeEntry.create({
      data: {
        ...stripRelations(r),
        id: createId(),
        organizationId: newOrgId,
        crewMemberId,
        assignmentId: remap("crewAssignment", r.assignmentId),
        approvedById: remapUser(r.approvedById),
        date: safeDate(r.date),
        approvedAt: safeDateOpt(r.approvedAt),
        createdAt: safeDate(r.createdAt),
        updatedAt: safeDate(r.updatedAt),
      } as any,
    });
  }

  // ── 20c. Check items (FEATUREDOCS/37, Track B) ──────────────────
  for (const r of (manifest.checkItems ?? []) as Rec[]) {
    const id = newId("checkItem", r.id);
    await prisma.checkItem.create({
      data: {
        ...stripRelations(r),
        id,
        organizationId: newOrgId,
        createdById: remapUser(r.createdById),
        createdAt: safeDate(r.createdAt),
        updatedAt: safeDate(r.updatedAt),
      } as any,
    });
  }
  for (const r of (manifest.modelCheckItems ?? []) as Rec[]) {
    const modelId = remap("model", r.modelId);
    const checkItemId = remap("checkItem", r.checkItemId);
    if (!modelId || !checkItemId) continue;
    await prisma.modelCheckItem.create({
      data: {
        ...stripRelations(r),
        id: createId(),
        organizationId: newOrgId,
        modelId,
        checkItemId,
        createdAt: safeDate(r.createdAt),
      } as any,
    });
  }
  for (const r of (manifest.kitCheckItems ?? []) as Rec[]) {
    const kitId = remap("kit", r.kitId);
    const checkItemId = remap("checkItem", r.checkItemId);
    if (!kitId || !checkItemId) continue;
    await prisma.kitCheckItem.create({
      data: {
        ...stripRelations(r),
        id: createId(),
        organizationId: newOrgId,
        kitId,
        checkItemId,
        createdAt: safeDate(r.createdAt),
      } as any,
    });
  }
  for (const r of (manifest.checkRecords ?? []) as Rec[]) {
    const checkItemId = remap("checkItem", r.checkItemId);
    const performedById = remapUser(r.performedById);
    // performedById is required + cascade-deleted with user. Skip if we can't
    // resolve the original user — preserving every check record is less
    // important than keeping the import idempotent.
    if (!checkItemId || !performedById) continue;
    await prisma.checkRecord.create({
      data: {
        ...stripRelations(r),
        id: createId(),
        organizationId: newOrgId,
        checkItemId,
        performedById,
        lineItemId: remap("projectLineItem", r.lineItemId),
        assetId: remap("asset", r.assetId),
        bulkAssetId: remap("bulkAsset", r.bulkAssetId),
        kitId: remap("kit", r.kitId),
        performedAt: safeDate(r.performedAt),
      } as any,
    });
  }

  // ── 21. Add members ──────────────────────────────────────────────
  for (const m of manifest.members) {
    const user = await prisma.user.findUnique({
      where: { email: m.userEmail },
      select: { id: true },
    });
    if (!user) continue;

    const existing = await prisma.member.findFirst({
      where: { organizationId: newOrgId, userId: user.id },
    });
    if (existing) continue;

    await prisma.member.create({
      data: {
        id: createId(),
        organizationId: newOrgId,
        userId: user.id,
        role: m.role,
        createdAt: new Date(m.createdAt),
      },
    });
  }

  return {
    organizationId: newOrgId,
    name: orgName,
    slug: orgSlug,
    stats: {
      categories: manifest.categories.length,
      models: manifest.models.length,
      assets: manifest.assets.length,
      bulkAssets: manifest.bulkAssets.length,
      kits: manifest.kits.length,
      projects: manifest.projects.length,
      clients: manifest.clients.length,
      files: manifest.fileUploads.length,
      members: manifest.members.length,
      savedReports: (manifest.savedReports ?? []).length,
      crewMembers: (manifest.crewMembers ?? []).length,
      crewRoles: (manifest.crewRoles ?? []).length,
      crewSkills: (manifest.crewSkills ?? []).length,
      crewAssignments: (manifest.crewAssignments ?? []).length,
      checkItems: (manifest.checkItems ?? []).length,
      checkRecords: (manifest.checkRecords ?? []).length,
      groupTemplates: (manifest.groupTemplates ?? []).length,
    },
  };
}
