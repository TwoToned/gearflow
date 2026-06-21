/**
 * Auto-mirror registry for the integration harness.
 *
 * Domain data is now Convex-only for the migrated surfaces: the converted server
 * actions and read helpers look in Convex, not Prisma. The integration tests,
 * however, seed their world by writing Prisma rows (directly via
 * `testPrisma.<model>.create(...)` or through the fixture factories). Without a
 * mirror, those rows are invisible to the code under test.
 *
 * Rather than edit ~24 test files, we wrap `testPrisma` in a Prisma `$extends`
 * query interceptor (see integration.ts) that, after any create/createMany/
 * update/upsert/delete on a Convex-backed table, replays the SAME mutation into
 * the shared dev Convex deployment using the SAME mirror helpers the inverted
 * server actions use — so the fixture write and the production write produce
 * byte-identical Convex docs.
 *
 * Only tables that the migrated code READS from Convex are listed. Prisma-only
 * tables (customFieldDefinition, savedView, member, user, organization, etc.)
 * are deliberately absent — mirroring them would be wasted round-trips (and some
 * have no Convex table at all).
 */

import { getConvexClient, toConvexDoc } from "@/lib/convex-client";
import { api } from "../../convex/_generated/api";
import {
  mirrorAssetCreate,
  patchAssetInConvex,
  removeAssetFromConvex,
  mirrorBulkAssetCreate,
  patchBulkAssetInConvex,
  removeBulkAssetFromConvex,
} from "@/lib/asset-mirror";
import {
  mirrorKitCreate,
  patchKitInConvex,
  removeKitFromConvex,
  mirrorKitBulkItemCreate,
  removeKitBulkItemFromConvex,
} from "@/lib/kit-mirror";
import {
  mirrorProjectCreate,
  patchProjectInConvex,
  removeProjectFromConvex,
} from "@/lib/project-mirror";
import {
  mirrorLineItemCreate,
  patchLineItemInConvex,
  removeLineItemFromConvex,
} from "@/lib/line-item-mirror";

type Row = Record<string, unknown>;

export type MirrorEntry = {
  create: (row: Row) => Promise<unknown>;
  /** Patch by cuid. Receives the full fresh row. */
  patch: (id: string, row: Row) => Promise<unknown>;
  remove: (id: string) => Promise<unknown>;
};

// Generic Convex helpers for tables that have no dedicated src/lib mirror — the
// write was inlined in the server action. We replicate the same create/patch/
// remove shape the generated CRUD exposes.
function generic(table: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  createIfMissing: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  update: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  remove: any;
}): MirrorEntry {
  return {
    create: async (row) => {
      const client = await getConvexClient();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return client.mutation(table.createIfMissing, toConvexDoc(row) as any);
    },
    patch: async (id, row) => {
      const client = await getConvexClient();
      const { id: _drop, ...rest } = toConvexDoc(row);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return client.mutation(table.update, { id, patch: rest } as any);
    },
    remove: async (id) => {
      const client = await getConvexClient();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return client.mutation(table.remove, { id } as any);
    },
  };
}

/**
 * Map Prisma model name (the `model` arg Prisma passes to $extends, camelCase) to
 * its Convex mirror. The line-item-unit table has no patch-by-cuid mirror export
 * (its sync re-reads from Prisma), so we use the generic CRUD for it too.
 */
export const MIRROR_REGISTRY: Record<string, MirrorEntry> = {
  Model: generic(api.models),
  Asset: { create: mirrorAssetCreate, patch: patchAssetInConvex, remove: removeAssetFromConvex },
  BulkAsset: { create: mirrorBulkAssetCreate, patch: patchBulkAssetInConvex, remove: removeBulkAssetFromConvex },
  Kit: { create: mirrorKitCreate, patch: patchKitInConvex, remove: removeKitFromConvex },
  KitBulkItem: { create: mirrorKitBulkItemCreate, patch: generic(api.kitBulkItems).patch, remove: removeKitBulkItemFromConvex },
  Project: { create: mirrorProjectCreate, patch: patchProjectInConvex, remove: removeProjectFromConvex },
  ProjectCategory: generic(api.projectCategories),
  ProjectGroup: generic(api.projectGroups),
  ProjectLineItem: { create: mirrorLineItemCreate, patch: patchLineItemInConvex, remove: (id) => removeLineItemFromConvex(id) },
  ProjectLineItemUnit: generic(api.projectLineItemUnits),
  CategorySlot: generic(api.categorySlots),
  Location: generic(api.locations),
  Client: generic(api.clients),
  Supplier: generic(api.suppliers),
  Category: generic(api.categories),
  SupplierModelRate: generic(api.supplierModelRates),
  ProjectService: generic(api.projectServices),
  // Additional Convex-backed tables read by the migrated server surfaces.
  SubHire: generic(api.subHires),
  SubHireGroup: generic(api.subHireGroups),
  SubHireItem: generic(api.subHireItems),
  CheckItem: generic(api.checkItems),
  ModelCheckItem: generic(api.modelCheckItems),
  KitCheckItem: generic(api.kitCheckItems),
  TestTagAsset: generic(api.testTagAssets),
  TestTagRecord: generic(api.testTagRecords),
  SubTestRecord: generic(api.subTestRecords),
  CheckRecord: generic(api.checkRecords),
  AssetScanLog: generic(api.assetScanLogs),
  CrewMember: generic(api.crewMembers),
  FileUpload: generic(api.fileUploads),
  KitSerializedItem: generic(api.kitSerializedItems),
};
