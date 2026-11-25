import type { MutationCtx, QueryCtx } from "../_generated/server";
import { getAuthContext, isAgentNoFinancials, redactFields } from "./auth";
import { ASSET_COST_FIELDS, BULK_ASSET_COST_FIELDS, MODEL_COST_FIELDS } from "./gearCostFields";

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
  /** `sortBy`, or `fallback` when it names a hidden cost column. */
  sortBy: (sortBy: string, fallback: string) => string;
}

async function guard(ctx: QueryCtx | MutationCtx, fields: readonly string[]): Promise<GearCostGuard> {
  const hidden = await isAgentNoFinancials(ctx, await getAuthContext(ctx));
  return {
    hidden,
    row: (r) => (hidden ? redactFields(r, fields) : r),
    model: (m) => (hidden && m ? redactFields(m, MODEL_COST_FIELDS) : m),
    sortBy: (s, fallback) => (hidden && fields.includes(s) ? fallback : s),
  };
}

export const assetCostGuard = (ctx: QueryCtx | MutationCtx) => guard(ctx, ASSET_COST_FIELDS);
export const bulkAssetCostGuard = (ctx: QueryCtx | MutationCtx) => guard(ctx, BULK_ASSET_COST_FIELDS);
