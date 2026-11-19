"use server";

import { requirePermission } from "@/lib/org-context";
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
  // The same permission the live de-prep write needs (`deprepItemsBatch`): a role that can't de-prep can't resolve tags.
  const { organizationId } = await requirePermission("warehouse", "check_out");
  const raw = tag.trim();
  if (!raw) return serialize({ kind: "none" as const });
  const [asset, bulk, kit] = await Promise.all([
    getAssetByAssetTag(organizationId, raw), getBulkAssetByAssetTag(organizationId, raw), getKitByAssetTag(organizationId, raw),
  ]);
  if (!asset && !bulk && !kit) return serialize({ kind: "none" as const });
  const convex = await getConvexClient();
  // `listByProject` returns [] for a project outside the caller's org, so a foreign projectId matches nothing below.
  const lines = (await convex.query(api.projectLineItems.listByProject, { projectId, orgId: organizationId })).filter((l) => l.status !== "CANCELLED");
  if (lines.length === 0) return serialize({ kind: "refuse" as const, text: "Job not found" });
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
  const model = await getModelById(bin.modelId);
  const name = model?.name ?? bin.assetTag;
  // Genuine bulk lines only: the line names this bin, or it is an untagged model-level line (no assetId, no
  // kit parent). Then the bin's own units decide: a SERIALISED line of the same model never carries a unit
  // with `bulkAssetId === bin.id`, so a bin scan can never de-prep serial units.
  const candidates = lines.filter((l) => !l.isKitChild && (l.bulkAssetId === bin.id || (!l.bulkAssetId && !l.assetId && l.modelId === bin.modelId)));
  if (candidates.length === 0) return serialize({ kind: "refuse" as const, text: "Asset not assigned to this job" });
  let onJob = false;
  // One read per candidate, in parallel; the first match is still taken in the lines' own order.
  const unitsByLine = await Promise.all(candidates.map((line) => convex.query(api.projectLineItemUnits.listByLineItem, { lineItemId: line.id })));
  for (const [i, line] of candidates.entries()) {
    const binUnits = unitsByLine[i].filter((u) => u.bulkAssetId === bin.id);
    if (binUnits.length === 0 && line.bulkAssetId !== bin.id) continue;
    onJob = true;
    const remaining = binUnits.filter((u) => u.status === "RETURNED" && u.prepStatus === "PACKED").reduce((n, u) => n + (u.quantity ?? 1), 0);
    if (remaining > 0) return serialize({ kind: "bulk" as const, lineItemId: line.id, name, remaining });
  }
  return serialize({ kind: "refuse" as const, text: onJob ? `${name}: ${NOT_WAITING.toLowerCase()}` : "Asset not assigned to this job" });
}
