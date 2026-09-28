/**
 * #1296 build plan phase 3b — loads a project's `projectContainers` for
 * `structureLineItems`'s `byContainer` mode, resolving each ASSET/BULK_ASSET
 * container's own tag in two batched lookups (never one point-read per
 * container). Split out of `build-document-data.ts` to keep that file's
 * per-function branching manageable (R-3.6) and so this is unit-testable on
 * its own.
 */
import { getConvexClient } from "@/lib/convex-client";
import { api } from "../../../convex/_generated/api";
import type { ContainerForStructuring } from "./structure-line-items";

export interface ContainerDataForDocuments {
  containers: ContainerForStructuring[];
  containerCount: number;
  nestedContainerCount: number;
}

type ContainerRow = {
  id: string;
  kind: "ASSET" | "BULK_ASSET" | "CUSTOM";
  label: string;
  description?: string;
  assetId?: string;
  bulkAssetId?: string;
  parentContainerId?: string;
  sortOrder: number;
};

function tagLookup(row: ContainerRow, assetTagById: Map<string, string>, bulkAssetTagById: Map<string, string>): string | null {
  if (row.kind === "ASSET") return row.assetId ? assetTagById.get(row.assetId) ?? null : null;
  if (row.kind === "BULK_ASSET") return row.bulkAssetId ? bulkAssetTagById.get(row.bulkAssetId) ?? null : null;
  return null;
}

export async function loadContainersForStructuring(
  orgId: string,
  projectId: string,
  versionId: string | undefined,
): Promise<ContainerDataForDocuments> {
  const convex = await getConvexClient();
  const rows = (await convex.query(api.projectContainers.listForProject, {
    orgId,
    projectId,
    versionId,
  })) as ContainerRow[];
  if (rows.length === 0) return { containers: [], containerCount: 0, nestedContainerCount: 0 };

  const assetIds = rows.filter((r) => r.kind === "ASSET" && r.assetId).map((r) => r.assetId as string);
  const bulkAssetIds = rows.filter((r) => r.kind === "BULK_ASSET" && r.bulkAssetId).map((r) => r.bulkAssetId as string);
  const [assets, bulkAssets] = await Promise.all([
    assetIds.length ? convex.query(api.assets.listByIds, { orgId, ids: assetIds }) : Promise.resolve([]),
    bulkAssetIds.length ? convex.query(api.bulkAssets.listByIds, { orgId, ids: bulkAssetIds }) : Promise.resolve([]),
  ]);
  const assetTagById = new Map(assets.map((a) => [a.id, a.assetTag]));
  const bulkAssetTagById = new Map(bulkAssets.map((b) => [b.id, b.assetTag]));

  const containers: ContainerForStructuring[] = rows.map((r) => ({
    id: r.id,
    kind: r.kind,
    label: r.label,
    description: r.description ?? null,
    tag: tagLookup(r, assetTagById, bulkAssetTagById),
    parentContainerId: r.parentContainerId ?? null,
    sortOrder: r.sortOrder ?? 0,
  }));

  const nestedContainerCount = containers.filter((c) => c.parentContainerId).length;
  return { containers, containerCount: containers.length - nestedContainerCount, nestedContainerCount };
}
