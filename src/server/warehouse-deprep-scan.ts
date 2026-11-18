"use server";

import { getOrgContext } from "@/lib/org-context";
import { serialize } from "@/lib/serialize";
import { getConvexClient } from "@/lib/convex-client";
import { getKitByAssetTag } from "@/lib/kits-read";
import { getAssetByAssetTag, getBulkAssetByAssetTag } from "@/lib/assets-read";
import { getModelById } from "@/lib/models-read";
import { api } from "../../convex/_generated/api";
import type { DeprepScanResult } from "@/lib/warehouse-deprep-scan";

const NOT_WAITING = "Not waiting to be de-prepped on this job";

/**
 * Resolve a tag scanned on the Returned stage against THIS job on the server (org-scoped like
 * `lookupAssetForScan`): a kit whose line is returned-and-packed, one serialised or accessory unit that
 * is returned-and-packed, or a bulk bin with its waiting count. Kit members and anything not waiting
 * are refused here, so the dock never trusts a client-held list.
 */
export async function lookupDeprepScan(projectId: string, tag: string): Promise<DeprepScanResult> {
  const { organizationId } = await getOrgContext();
  const raw = tag.trim();
  if (!raw) return serialize({ kind: "none" as const });
  const [asset, bulk, kit] = await Promise.all([
    getAssetByAssetTag(organizationId, raw), getBulkAssetByAssetTag(organizationId, raw), getKitByAssetTag(organizationId, raw),
  ]);
  if (!asset && !bulk && !kit) return serialize({ kind: "none" as const });
  const convex = await getConvexClient();
  const lines = (await convex.query(api.projectLineItems.listByProject, { projectId, orgId: organizationId })).filter((l) => l.status !== "CANCELLED");
  const waiting = (l: { status?: string | null; prepStatus?: string | null }) => l.status === "RETURNED" && l.prepStatus === "PACKED";

  if (kit) {
    const line = lines.find((l) => l.kitId === kit.id && !l.isKitChild);
    return serialize(line && waiting(line)
      ? { kind: "kit" as const, lineItemId: line.id, kitId: kit.id, name: kit.name }
      : { kind: "refuse" as const, text: line ? `${kit.name}: ${NOT_WAITING.toLowerCase()}` : "Kit not assigned to this job" });
  }
  if (asset) {
    if (asset.kitId) return serialize({ kind: "refuse" as const, text: "This asset is in a kit: scan the kit barcode to de-prep it." });
    const lineIds = new Map(lines.map((l) => [l.id, l]));
    const units = await convex.query(api.projectLineItemUnits.listByOrgAndAsset, { orgId: organizationId, assetId: asset.id });
    const unit = units.find((u) => lineIds.has(u.lineItemId) && u.status === "RETURNED" && u.prepStatus === "PACKED");
    const model = await getModelById(asset.modelId);
    const name = [model?.name, asset.customName ? `(${asset.customName})` : null].filter(Boolean).join(" ") || asset.assetTag;
    if (!unit) return serialize({ kind: "refuse" as const, text: `${name}: ${NOT_WAITING.toLowerCase()}` });
    const line = lineIds.get(unit.lineItemId)!;
    return serialize(line.childKind === "ACCESSORY"
      ? { kind: "accessory" as const, lineItemId: line.id, unitId: unit.id, assetId: asset.id, name }
      : { kind: "unit" as const, lineItemId: line.id, assetId: asset.id, name });
  }
  const bin = bulk!;
  const line = lines.find((l) => l.bulkAssetId === bin.id || (!l.bulkAssetId && l.modelId === bin.modelId && !l.isKitChild));
  const model = await getModelById(bin.modelId);
  const name = model?.name ?? bin.assetTag;
  if (!line) return serialize({ kind: "refuse" as const, text: "Asset not assigned to this job" });
  const units = await convex.query(api.projectLineItemUnits.listByLineItem, { lineItemId: line.id });
  const remaining = units.filter((u) => u.status === "RETURNED" && u.prepStatus === "PACKED").reduce((n, u) => n + (u.quantity ?? 1), 0);
  return serialize(remaining > 0 ? { kind: "bulk" as const, lineItemId: line.id, name, remaining } : { kind: "refuse" as const, text: `${name}: ${NOT_WAITING.toLowerCase()}` });
}
