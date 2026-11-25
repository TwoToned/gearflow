/**
 * What a unit or a model COST to own. These are the cost columns of the gear
 * records; a `noFinancials` API key must never see them. ABSENT (never zeroed) for
 * such a caller, applied per read site with `redactFields` (there is no generic
 * cost-field registry, CLAUDE.md "danger classification"). One list per record so
 * the model and asset reads can't drift (R-3.1). Reads of unit rows go through
 * `gearCostRedact.ts`.
 */
export const MODEL_COST_FIELDS = ["replacementCost", "defaultPurchasePrice"] as const;
export const ASSET_COST_FIELDS = ["purchasePrice"] as const;
export const BULK_ASSET_COST_FIELDS = ["purchasePricePerUnit"] as const;

// ── Sort keys ──────────────────────────────────────────────────────────────────
// A list that sorts by a field it hides leaks the ORDER of that field, so list sorts are
// an explicit allow-list (never `r[sortBy]`), and a cost key from a redacted caller falls
// back to the default sort. ONE decision, shared by every gear list (Assets, Models, Kits).
const COST_SORT_KEYS: ReadonlySet<string> = new Set([
  ...MODEL_COST_FIELDS,
  ...ASSET_COST_FIELDS,
  ...BULK_ASSET_COST_FIELDS,
  "fleetCost",
  "value",
]);

export const ASSET_SORT_KEYS = [
  "assetTag", "model", "serialNumber", "customName", "status", "condition", "location",
  "createdAt", "updatedAt", "purchaseDate", "warrantyExpiry", "purchasePrice",
] as const;
export const BULK_ASSET_SORT_KEYS = [
  "assetTag", "model", "status", "location", "totalQuantity", "availableQuantity",
  "createdAt", "updatedAt", "purchasePricePerUnit",
] as const;

/** May this caller sort by `field`? A cost column is only sortable by a caller who sees it. */
export function costSortAllowed(field: string, costHidden: boolean): boolean {
  return !(costHidden && COST_SORT_KEYS.has(field));
}

/** The sort key to use: the request when it is allow-listed and permitted, else `fallback`. */
export function resolveSortKey(requested: string | undefined, allowed: readonly string[], costHidden: boolean, fallback: string): string {
  return requested && allowed.includes(requested) && costSortAllowed(requested, costHidden) ? requested : fallback;
}
