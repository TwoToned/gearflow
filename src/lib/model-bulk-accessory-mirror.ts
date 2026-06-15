import { type FunctionReference } from "convex/server";
import { getConvexClient, toConvexDoc } from "@/lib/convex-client";
import { api } from "../../convex/_generated/api";

/**
 * `model_bulk_accessory` dual-write (Phase 6 decommission groundwork).
 *
 * Model-level bulk accessories ("every asset of this model ships with N of this
 * bulk asset"). Created and deleted by the model-accessory server actions; there
 * are no in-place updates today, but a patch helper is exported for completeness.
 *
 * INFRA-ONLY mirror (no reactive consumer yet) — keeps the Convex graph complete
 * for the eventual Prisma decommission. `createIfMissing` is idempotent; the
 * Convex side always throws `ConvexError`. See FEATUREDOCS/54 and the
 * line-item-unit-mirror sibling.
 *
 * Clear-to-null caveat: `toConvexDoc` drops null -> absent, so clearing `notes`
 * to null via patch is a no-op in Convex. Tolerable for a consumer-less mirror;
 * heals on a backfill run.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyRef = FunctionReference<"mutation", "public", any, any>;

/** Scalar columns the Convex create/update validators accept (relations stripped). */
const SCALAR_KEYS = new Set([
  "id", "organizationId", "modelId", "bulkAssetId", "quantity", "sortOrder",
  "notes", "addedAt", "addedById",
]);

function strip(row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) {
    if (SCALAR_KEYS.has(k)) out[k] = v;
  }
  return out;
}

/** Mirror a freshly written model bulk accessory into Convex (idempotent). */
export async function mirrorModelBulkAccessoryCreate(row: Record<string, unknown>) {
  const doc = strip(toConvexDoc(row));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (await getConvexClient()).mutation(api.modelBulkAccessories.createIfMissing as AnyRef, doc as any);
}

/** Remove a model bulk accessory from Convex. Call AFTER the Prisma delete. */
export async function removeModelBulkAccessoryFromConvex(id: string) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (await getConvexClient()).mutation(api.modelBulkAccessories.remove as AnyRef, { id } as any);
}

/** Patch a model bulk accessory in Convex (scalars only; null -> absent). */
export async function patchModelBulkAccessoryInConvex(id: string, row: Record<string, unknown>) {
  const { id: _id, ...rest } = strip(toConvexDoc(row));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (await getConvexClient()).mutation(api.modelBulkAccessories.update as AnyRef, { id, patch: rest } as any);
}
