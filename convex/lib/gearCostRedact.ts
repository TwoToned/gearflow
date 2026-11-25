import type { MutationCtx, QueryCtx } from "../_generated/server";
import { getAuthContext, isAgentNoFinancials, redactFields } from "./auth";
import {
  ASSET_COST_FIELDS,
  ASSET_SORT_KEYS,
  BULK_ASSET_COST_FIELDS,
  BULK_ASSET_SORT_KEYS,
  KIT_COST_FIELDS,
  MODEL_COST_FIELDS,
  resolveSortKey,
} from "./gearCostFields";

/**
 * Per-read cost redaction for unit rows (what a unit COST to buy). A `noFinancials`
 * API key gets the cost columns ABSENT (never zeroed), and a hidden field is not a
 * sort key either (sorting by it would leak the order). Call ONCE at the top of a
 * read and map the rows through `row`; every asset / bulk-asset read uses it so a
 * new read is a one-liner, not a second rule (R-3.1).
 */
export interface GearCostGuard {
  /** True for a `noFinancials` key. */
  hidden: boolean;
  /** Strips the cost columns from a unit row (a no-op for everyone else). */
  row: <T extends Record<string, unknown>>(r: T) => T;
  /** Strips the model's cost columns from a model embedded in a unit row. */
  model: <T extends Record<string, unknown> | null>(m: T) => T;
  /** The sort key: `requested` when allow-listed (and not a hidden cost column), else the default `assetTag`. */
  sort: (requested: string | undefined) => string;
}

async function guard(ctx: QueryCtx | MutationCtx, fields: readonly string[], sorts: readonly string[]): Promise<GearCostGuard> {
  const hidden = await isAgentNoFinancials(ctx, await getAuthContext(ctx));
  return {
    hidden,
    row: (r) => (hidden ? redactFields(r, fields) : r),
    model: (m) => (hidden && m ? redactFields(m, MODEL_COST_FIELDS) : m),
    sort: (requested) => resolveSortKey(requested, sorts, hidden, "assetTag"),
  };
}

const KIT_SORT_KEYS = ["assetTag", "name", "status", "condition", "category", "location", "createdAt", "updatedAt"] as const;

/** Kit rows: the kit's own `purchasePrice`. A kit sort is an allow-list too, so `purchasePrice` is never a sort key for a hidden caller. */
export const kitCostGuard = (ctx: QueryCtx | MutationCtx) => guard(ctx, KIT_COST_FIELDS, KIT_SORT_KEYS);
export const assetCostGuard = (ctx: QueryCtx | MutationCtx) => guard(ctx, ASSET_COST_FIELDS, ASSET_SORT_KEYS);
export const bulkAssetCostGuard = (ctx: QueryCtx | MutationCtx) => guard(ctx, BULK_ASSET_COST_FIELDS, BULK_ASSET_SORT_KEYS);
