"use server";

import { prisma } from "@/lib/prisma";
import { getOrgContext } from "@/lib/org-context";
import { getConvexClient } from "@/lib/convex-client";
import { api } from "../../convex/_generated/api";

/**
 * Look up a scanned barcode value and return the URL to navigate to.
 * Checks: Asset → Kit → Test & Tag item (by testTagId).
 */
export async function scanLookup(value: string): Promise<{ url: string | null; label: string | null }> {
  const { organizationId } = await getOrgContext();
  const tag = value.trim();

  // Validate scanned value: reasonable length and character set
  if (!tag || tag.length > 128 || !/^[A-Za-z0-9\-_.:/ ]+$/.test(tag)) {
    return { url: null, label: null };
  }

  const client = await getConvexClient();

  // 1. Check serialized assets
  const asset = await client.query(api.assets.getByAssetTag, { organizationId, assetTag: tag });
  if (asset) {
    return { url: `/assets/registry/${asset.id}`, label: `Asset ${asset.assetTag}` };
  }

  // 2. Check kits
  const kit = await client.query(api.kits.getByAssetTag, { organizationId, assetTag: tag });
  if (kit) {
    return { url: `/kits/${kit.id}`, label: `Kit ${kit.assetTag}` };
  }

  // 3. Check bulk assets (they have asset tags too)
  const bulk = await client.query(api.bulkAssets.getByAssetTag, { organizationId, assetTag: tag });
  if (bulk) {
    return { url: `/assets/registry/${bulk.id}`, label: `Bulk Asset ${bulk.assetTag}` };
  }

  // 4. Check test & tag items (stays Prisma — testTagAsset has no Convex mirror)
  const ttAsset = await prisma.testTagAsset.findUnique({
    where: { organizationId_testTagId: { organizationId, testTagId: tag } },
    select: { id: true, testTagId: true },
  });
  if (ttAsset) {
    return { url: `/test-and-tag/${ttAsset.id}`, label: `T&T ${ttAsset.testTagId}` };
  }

  return { url: null, label: null };
}
