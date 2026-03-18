import { prisma } from "@/lib/prisma";
import { getFromS3 } from "@/lib/storage";
import { MANIFEST_VERSION, type OrgExportManifest } from "./org-transfer-types";
import archiver from "archiver";
import { PassThrough } from "stream";

/** Serialize Prisma Decimals and Dates for JSON */
function clean(obj: unknown): unknown {
  return JSON.parse(
    JSON.stringify(obj, (_key, value) => {
      if (value && typeof value === "object" && typeof value.toNumber === "function")
        return value.toNumber();
      return value;
    })
  );
}

/**
 * Export an entire organization as a streamable zip archive.
 * Returns a Node ReadableStream (PassThrough) that can be piped to an HTTP response.
 */
export async function exportOrganization(orgId: string) {
  const org = await prisma.organization.findUnique({ where: { id: orgId } });
  if (!org) throw new Error("Organization not found");

  // Query all org-scoped tables
  const [
    customRoles,
    categories,
    locations,
    suppliers,
    models,
    assets,
    bulkAssets,
    kits,
    kitSerializedItems,
    kitBulkItems,
    clients,
    projects,
    projectLineItems,
    assetScanLogs,
    maintenanceRecords,
    maintenanceRecordAssets,
    testTagAssets,
    testTagRecords,
    supplierOrders,
    supplierOrderItems,
    activityLogs,
    fileUploads,
    modelMedia,
    assetMedia,
    kitMedia,
    projectMedia,
    clientMedia,
    locationMedia,
    savedReports,
    members,
  ] = await Promise.all([
    prisma.customRole.findMany({ where: { organizationId: orgId } }),
    prisma.category.findMany({ where: { organizationId: orgId } }),
    prisma.location.findMany({ where: { organizationId: orgId } }),
    prisma.supplier.findMany({ where: { organizationId: orgId } }),
    prisma.model.findMany({ where: { organizationId: orgId } }),
    prisma.asset.findMany({ where: { organizationId: orgId } }),
    prisma.bulkAsset.findMany({ where: { organizationId: orgId } }),
    prisma.kit.findMany({ where: { organizationId: orgId } }),
    prisma.kitSerializedItem.findMany({ where: { organizationId: orgId } }),
    prisma.kitBulkItem.findMany({ where: { organizationId: orgId } }),
    prisma.client.findMany({ where: { organizationId: orgId } }),
    prisma.project.findMany({ where: { organizationId: orgId } }),
    prisma.projectLineItem.findMany({ where: { organizationId: orgId } }),
    prisma.assetScanLog.findMany({ where: { organizationId: orgId } }),
    prisma.maintenanceRecord.findMany({ where: { organizationId: orgId } }),
    prisma.maintenanceRecordAsset.findMany({
      where: { maintenanceRecord: { organizationId: orgId } },
    }),
    prisma.testTagAsset.findMany({ where: { organizationId: orgId } }),
    prisma.testTagRecord.findMany({ where: { organizationId: orgId } }),
    prisma.supplierOrder.findMany({ where: { organizationId: orgId } }),
    prisma.supplierOrderItem.findMany({
      where: { order: { organizationId: orgId } },
    }),
    prisma.activityLog.findMany({ where: { organizationId: orgId } }),
    prisma.fileUpload.findMany({ where: { organizationId: orgId } }),
    prisma.modelMedia.findMany({ where: { organizationId: orgId } }),
    prisma.assetMedia.findMany({ where: { organizationId: orgId } }),
    prisma.kitMedia.findMany({ where: { organizationId: orgId } }),
    prisma.projectMedia.findMany({ where: { organizationId: orgId } }),
    prisma.clientMedia.findMany({ where: { organizationId: orgId } }),
    prisma.locationMedia.findMany({ where: { organizationId: orgId } }),
    prisma.savedReport.findMany({ where: { organizationId: orgId } }),
    prisma.member.findMany({
      where: { organizationId: orgId },
      include: { user: { select: { id: true, email: true, name: true } } },
    }),
  ]);

  // Build user email map for all user IDs referenced across the org
  const userIds = new Set<string>();
  for (const m of members) userIds.add(m.userId);

  // Collect user IDs from various FK fields
  const collectUserIds = (records: Record<string, unknown>[], fields: string[]) => {
    for (const r of records) {
      for (const f of fields) {
        if (r[f] && typeof r[f] === "string") userIds.add(r[f] as string);
      }
    }
  };

  collectUserIds(projects as unknown as Record<string, unknown>[], ["projectManagerId"]);
  collectUserIds(projectLineItems as unknown as Record<string, unknown>[], ["checkedOutById", "returnedById"]);
  collectUserIds(assetScanLogs as unknown as Record<string, unknown>[], ["scannedById"]);
  collectUserIds(maintenanceRecords as unknown as Record<string, unknown>[], ["reportedById", "assignedToId"]);
  collectUserIds(testTagRecords as unknown as Record<string, unknown>[], ["testedById"]);
  collectUserIds(kitSerializedItems as unknown as Record<string, unknown>[], ["addedById"]);
  collectUserIds(kitBulkItems as unknown as Record<string, unknown>[], ["addedById"]);
  collectUserIds(supplierOrders as unknown as Record<string, unknown>[], ["createdById"]);
  collectUserIds(activityLogs as unknown as Record<string, unknown>[], ["userId"]);
  collectUserIds(fileUploads as unknown as Record<string, unknown>[], ["uploadedById"]);
  collectUserIds(savedReports as unknown as Record<string, unknown>[], ["createdById"]);

  const users = await prisma.user.findMany({
    where: { id: { in: [...userIds] } },
    select: { id: true, email: true },
  });
  const userEmailMap: Record<string, string> = {};
  for (const u of users) userEmailMap[u.id] = u.email;

  const manifest: OrgExportManifest = {
    version: MANIFEST_VERSION,
    exportedAt: new Date().toISOString(),
    sourceOrgId: org.id,
    sourceOrgName: org.name,
    sourceOrgSlug: org.slug,

    organization: clean(org) as Record<string, unknown>,
    customRoles: clean(customRoles) as Record<string, unknown>[],
    categories: clean(categories) as Record<string, unknown>[],
    locations: clean(locations) as Record<string, unknown>[],
    suppliers: clean(suppliers) as Record<string, unknown>[],
    models: clean(models) as Record<string, unknown>[],
    assets: clean(assets) as Record<string, unknown>[],
    bulkAssets: clean(bulkAssets) as Record<string, unknown>[],
    kits: clean(kits) as Record<string, unknown>[],
    kitSerializedItems: clean(kitSerializedItems) as Record<string, unknown>[],
    kitBulkItems: clean(kitBulkItems) as Record<string, unknown>[],
    clients: clean(clients) as Record<string, unknown>[],
    projects: clean(projects) as Record<string, unknown>[],
    projectLineItems: clean(projectLineItems) as Record<string, unknown>[],
    assetScanLogs: clean(assetScanLogs) as Record<string, unknown>[],
    maintenanceRecords: clean(maintenanceRecords) as Record<string, unknown>[],
    maintenanceRecordAssets: clean(maintenanceRecordAssets) as Record<string, unknown>[],
    testTagAssets: clean(testTagAssets) as Record<string, unknown>[],
    testTagRecords: clean(testTagRecords) as Record<string, unknown>[],
    supplierOrders: clean(supplierOrders) as Record<string, unknown>[],
    supplierOrderItems: clean(supplierOrderItems) as Record<string, unknown>[],
    activityLogs: clean(activityLogs) as Record<string, unknown>[],
    fileUploads: clean(fileUploads) as Record<string, unknown>[],
    modelMedia: clean(modelMedia) as Record<string, unknown>[],
    assetMedia: clean(assetMedia) as Record<string, unknown>[],
    kitMedia: clean(kitMedia) as Record<string, unknown>[],
    projectMedia: clean(projectMedia) as Record<string, unknown>[],
    clientMedia: clean(clientMedia) as Record<string, unknown>[],
    locationMedia: clean(locationMedia) as Record<string, unknown>[],
    savedReports: clean(savedReports) as Record<string, unknown>[],

    members: members.map((m) => ({
      role: m.role,
      userEmail: m.user.email,
      userName: m.user.name,
      createdAt: m.createdAt.toISOString(),
    })),

    userEmailMap,
  };

  // Create a zip archive stream
  const passthrough = new PassThrough();
  const archive = archiver("zip", { zlib: { level: 6 } });
  archive.pipe(passthrough);

  // Add manifest
  archive.append(JSON.stringify(manifest, null, 2), { name: "manifest.json" });

  // Add S3 files (with concurrency limit)
  const CONCURRENT_DOWNLOADS = 5;
  const fileQueue = [...fileUploads];

  async function downloadBatch() {
    while (fileQueue.length > 0) {
      const batch = fileQueue.splice(0, CONCURRENT_DOWNLOADS);
      await Promise.all(
        batch.map(async (fu) => {
          try {
            const response = await getFromS3(fu.storageKey);
            if (response.Body) {
              const bytes = await response.Body.transformToByteArray();
              archive.append(Buffer.from(bytes), {
                name: `files/${fu.storageKey}`,
              });
            }
          } catch {
            // File missing from S3 — skip, import will handle gracefully
          }
        })
      );
    }
  }

  // Start downloading files, then finalize
  downloadBatch().then(() => archive.finalize());

  return passthrough;
}
