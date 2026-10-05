/**
 * Accessory relocation (#1296) — the ONE definition of "this accessory unit is
 * packed in a different container than its parent, so it ships with ITS
 * container, not with the parent".
 *
 * Accessory units normally travel with their parent: deploy, return and de-prep
 * of the parent cascade to every accessory unit. Once an operator moves some of
 * them into another case ("batteries into the Battery Box"), that case is what
 * goes out the door, so the parent's cascades must leave those units alone and
 * the units are actioned on their own rows instead.
 *
 * Pure (no ctx, no `src/` imports) so the Convex cascades and the warehouse UI
 * (`src/components/warehouse/relocate-accessories.ts`) share one rule (R-3.1).
 */

/** The slice of a parent unit the rule reads. */
export interface ParentUnitLike {
  assetId?: string | null;
  containerId?: string | null;
}

/** The slice of an accessory unit the rule reads. */
export interface AccessoryUnitLike {
  parentUnitAssetId?: string | null;
  containerId?: string | null;
}

/**
 * Build the "which container is this accessory's parent in?" lookup for ONE
 * parent line. A tagged parent unit is matched by its asset (the accessory
 * unit's `parentUnitAssetId`); anything else falls back to the line's own
 * container (a single packed asset, or an untagged multi-quantity line).
 */
export function parentContainerResolver(
  parentUnits: readonly ParentUnitLike[],
): (accessoryUnit: AccessoryUnitLike) => string | null {
  const byAsset = new Map<string, string | null>();
  for (const pu of parentUnits) {
    if (pu.assetId) byAsset.set(pu.assetId, pu.containerId ?? null);
  }
  const fallback = parentUnits.find((pu) => pu.containerId)?.containerId ?? null;
  return (acc) => {
    const key = acc.parentUnitAssetId;
    return key && byAsset.has(key) ? (byAsset.get(key) ?? null) : fallback;
  };
}

/**
 * True when the accessory unit is physically packed somewhere AND that place is
 * not its parent's container. An accessory with no container at all is still
 * loose gear that goes with its parent, so it is never "relocated".
 */
export function isRelocatedAccessoryUnit(
  accessoryUnit: AccessoryUnitLike,
  parentContainerId: string | null,
): boolean {
  return !!accessoryUnit.containerId && accessoryUnit.containerId !== parentContainerId;
}
