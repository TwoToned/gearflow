/**
 * UI predicates for off-inventory ("Prep as custom item") units — FEATUREDOCS/12.
 *
 * Mirrors the preconditions `convertUnitToOffInventoryCore` enforces server-side
 * (`convex/warehouseOps.ts`); the server stays the authority, these only decide
 * whether to OFFER the action. Plain module so the warehouse screen and the
 * Equipment tab share one definition (R-3.1).
 */
import type { OverbookedInfo } from "@/lib/overbooking-core";

export interface CustomUnitLine {
  id: string;
  type?: string | null;
  status?: string | null;
  modelId?: string | null;
  quantity: number;
  isKitChild?: boolean | null;
  kitId?: string | null;
  subHireId?: string | null;
  isContainerLineItem?: boolean | null;
  isCustomItem?: boolean | null;
  bulkAssetId?: string | null;
  model?: { assetType?: string | null } | null;
  units?: Array<{ quantity?: number | null; status?: string | null; assetId?: string | null; bulkAssetId?: string | null }> | null;
  offInventoryQuantity?: number | null;
}

/** Units of the line not yet taken by a serial or a custom unit. */
export function freeUnitSlots(line: Pick<CustomUnitLine, "quantity" | "units">): number {
  const taken = (line.units ?? [])
    .filter((u) => u.status !== "CANCELLED")
    .reduce((n, u) => n + (u.quantity ?? 0), 0);
  return Math.max(0, line.quantity - taken);
}

/** Not a kit / kit child / container / custom item / sub-hire. */
function isStandaloneOwnStockLine(line: CustomUnitLine): boolean {
  return !line.isKitChild && !line.kitId && !line.isContainerLineItem && !line.isCustomItem && line.subHireId == null;
}

/** A live, model-backed, serialised equipment line. */
function isLiveSerialisedModelLine(line: CustomUnitLine): boolean {
  if ((line.type ?? "EQUIPMENT") !== "EQUIPMENT" || !line.modelId || line.status === "CANCELLED") return false;
  return !line.bulkAssetId && line.model?.assetType !== "BULK";
}

function isPlainSerialisedModelLine(line: CustomUnitLine): boolean {
  return isStandaloneOwnStockLine(line) && isLiveSerialisedModelLine(line);
}

/** Offer "Prep as custom item": an overbooked plain serialised line with a free unit. */
export function canConvertToCustomUnit(line: CustomUnitLine, overbooked: OverbookedInfo | null | undefined): boolean {
  if (!overbooked || overbooked.inherited) return false;
  const short = overbooked.overBy > 0 || (overbooked.hardOverBy ?? 0) > 0 || (overbooked.pencilledOverBy ?? 0) > 0;
  return short && isPlainSerialisedModelLine(line) && freeUnitSlots(line) >= 1;
}

/** Offer "Convert back": the line has a custom unit that has not gone out yet. */
export function canConvertBackToInventory(line: CustomUnitLine): boolean {
  if ((line.offInventoryQuantity ?? 0) < 1) return false;
  return (line.units ?? []).some(
    (u) => !u.assetId && !u.bulkAssetId && u.status !== "CHECKED_OUT" && u.status !== "RETURNED" && u.status !== "CANCELLED",
  );
}
