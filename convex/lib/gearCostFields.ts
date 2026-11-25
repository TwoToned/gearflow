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
