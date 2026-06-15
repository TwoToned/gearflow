import { getConvexClient, toConvexDoc } from "@/lib/convex-client";
import { api } from "../../convex/_generated/api";

/**
 * `supplier_model_rate` dual-write (Phase 6 decommission groundwork).
 *
 * SupplierModelRate is the per-(supplier, model) last-rate cache, written only
 * from the sub-hire item create/update paths (an `upsert` keyed on the compound
 * unique [organizationId, supplier, model]). There is no consumer of the Convex
 * copy yet — this keeps the Convex graph complete for the eventual decommission.
 * See FEATUREDOCS/54 and the line-item-unit-mirror sibling for the helper style.
 *
 * `toConvexDoc` maps Decimal `lastUnitCost` -> number (the Convex create args
 * expect `v.number()`), Date -> ms, null -> absent. The Convex create/update arg
 * validators accept scalars only, so nested relations (`supplier`, `model`,
 * `organization`) must be stripped before mirroring. Always `ConvexError` on the
 * Convex side; `createIfMissing` is idempotent.
 */

/** Scalar columns the Convex create/update validators accept. */
const RATE_SCALAR_KEYS = new Set([
  "id", "organizationId", "supplierId", "modelId", "lastUnitCost",
  "pricingType", "lastUsedAt", "updatedAt",
]);

function stripRate(row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) {
    if (RATE_SCALAR_KEYS.has(k)) out[k] = v;
  }
  return out;
}

/** Mirror a freshly written supplier-model-rate row into Convex (idempotent). */
export async function mirrorSupplierModelRateCreate(row: Record<string, unknown>) {
  const doc = stripRate(toConvexDoc(row));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (await getConvexClient()).mutation(api.supplierModelRates.createIfMissing, doc as any);
}

/** Patch an existing supplier-model-rate row in Convex. */
export async function patchSupplierModelRateInConvex(id: string, row: Record<string, unknown>) {
  const { id: _id, ...rest } = stripRate(toConvexDoc(row));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (await getConvexClient()).mutation(api.supplierModelRates.update, { id, patch: rest } as any);
}

/** Remove a supplier-model-rate row from Convex. */
export async function removeSupplierModelRateFromConvex(id: string) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (await getConvexClient()).mutation(api.supplierModelRates.remove, { id } as any);
}

/**
 * Mirror an upsert: idempotently create-if-missing then patch so the row lands in
 * Convex whether the Prisma upsert inserted or updated. Call AFTER the Prisma
 * upsert commits, with the resulting row (which carries the authoritative `id`).
 */
export async function mirrorSupplierModelRateUpsert(row: Record<string, unknown>) {
  await mirrorSupplierModelRateCreate(row);
  await patchSupplierModelRateInConvex(row.id as string, row);
}
