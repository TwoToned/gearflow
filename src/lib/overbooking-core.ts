/**
 * CLIENT-SAFE core of the overbooking computation.
 *
 * Zero server imports (no getConvexClient / prisma) so a browser component can
 * import it: the native read-layer cutover subscribes to
 * `useQuery(api.overbooking.bundle)` and reconstructs the
 * `lineItemId → OverbookedInfo` map client-side with the SAME math the server
 * `computeOverbookedStatus` runs — parity-by-construction.
 *
 * The pure pieces (`projectMatchesWindow`, `indexProjectsById`,
 * `sumBookingsByModel`, `computeStockBreakdown`, `OverbookedInfo`, `DateWindow`)
 * were MOVED here out of `availability-read.ts` / `availability.ts` (which keep
 * their server-only IO co-residents) and are re-exported from those modules for
 * back-compat. The only value dependency is the client-safe `mapLineItemDoc`
 * (already proven client-safe in `project-equipment-reconstruct.ts`). Convex doc /
 * entity types are `import type` (erased — safe to reference impure modules for
 * types).
 */
import type { FunctionReturnType } from "convex/server";
import type { api } from "../../convex/_generated/api";
import type { ConvexProject } from "@/lib/projects-read";
import type { MappedLineItem } from "@/lib/project-line-item-read";
import { mapLineItemDoc } from "@/lib/project-equipment-reconstruct";
import { getProjectWindow } from "@/lib/project-window";

// ─── Stock breakdown (moved from availability.ts) ────────────────────────────

/**
 * Canonical stock breakdown for a model.
 *
 * `effectiveStock` is the only value that should be used for availability
 * enforcement — both server-side (addLineItem, updateLineItem, checkAvailability)
 * and client-side (computeOverbookedStatus, edit dialog). Raw `totalStock`
 * includes assets that are in maintenance / lost / retired and will overstate
 * what can actually be booked.
 */
/**
 * Resolve a model's stock type when the Convex `assetType` mirror field may be
 * absent. `assetType` is `v.optional` in the Convex schema, so older / backfilled
 * model docs read back `undefined`. Blindly defaulting to `"SERIALIZED"` made a
 * genuine BULK model take the serialized branch of `computeStockBreakdown` —
 * `totalStock = assets.length = 0` (a bulk model has no serialized assets) — so
 * every bulk line showed "0 available". Fall back to `"BULK"` when the model has
 * any active bulk asset. A present value is returned unchanged, so this is a
 * strictly-safe replacement for `assetType ?? "SERIALIZED"` at every stock site.
 *
 * The undefined-only fallback above never fires for a NEW model, though: the
 * model-form.tsx create form defaults `assetType` to an EXPLICIT `"SERIALIZED"`
 * (there's a Serialized/Bulk selector, but Serialized is what you get unless you
 * deliberately switch it), so a model stocked exclusively with bulk assets and
 * never switched away from the default reads back `assetType: "SERIALIZED"` —
 * present, not absent — and stays stuck on the zero-stock branch forever
 * (issue #801). `hasAssets` closes that gap: a model with real bulk stock and
 * ZERO actual serialized assets can never have any serialized stock to report
 * under any interpretation, so an explicit-but-label-only `"SERIALIZED"` is
 * trusted less than the data in that one unambiguous case.
 */
export function resolveModelAssetType(
  assetType: string | null | undefined,
  hasBulkAssets: boolean,
  hasAssets: boolean,
): "SERIALIZED" | "BULK" {
  if (assetType === "BULK") return "BULK";
  if (assetType === "SERIALIZED") return hasBulkAssets && !hasAssets ? "BULK" : "SERIALIZED";
  return hasBulkAssets ? "BULK" : "SERIALIZED";
}

export function computeStockBreakdown(model: {
  assetType: "SERIALIZED" | "BULK";
  assets: { status: string }[];
  bulkAssets: { totalQuantity: number }[];
}): { totalStock: number; effectiveStock: number; unavailable: number } {
  if (model.assetType === "SERIALIZED") {
    const totalStock = model.assets.length;
    const unavailable = model.assets.filter(
      (a) =>
        a.status === "IN_MAINTENANCE" ||
        a.status === "LOST" ||
        a.status === "RETIRED",
    ).length;
    return { totalStock, effectiveStock: totalStock - unavailable, unavailable };
  }
  const totalStock = model.bulkAssets.reduce(
    (sum, ba) => sum + ba.totalQuantity,
    0,
  );
  return { totalStock, effectiveStock: totalStock, unavailable: 0 };
}

export interface OverbookedInfo {
  /** How many units over capacity */
  overBy: number;
  /** Total active assets for this model */
  totalStock: number;
  /** Usable stock (totalStock minus unavailable assets) */
  effectiveStock: number;
  /** Total booked across all overlapping projects */
  totalBooked: number;
  /** True when a kit parent is overbooked only because its children are */
  inherited?: boolean;
  /** Number of assets in non-usable statuses (IN_MAINTENANCE, LOST, etc.) */
  unavailableAssets?: number;
  /** True when overbooking is ONLY caused by unavailable assets, not other bookings */
  reducedOnly?: boolean;
  /** Kit parent: has children that are truly overbooked (booking conflicts) */
  hasOverbookedChildren?: boolean;
  /** Kit parent: has children with reduced stock (unavailable assets) */
  hasReducedChildren?: boolean;
}

// ─── Window / booking aggregation (moved from availability-read.ts) ──────────

/** Project statuses excluded from availability/booking windows (Prisma `notIn`). */
export const EXCLUDED_PROJECT_STATUSES: ReadonlySet<string> = new Set([
  "CANCELLED",
  "RETURNED",
  "COMPLETED",
  "INVOICED",
]);

/** The booking date window (inclusive overlap). */
export interface DateWindow {
  start: Date;
  end: Date;
}

/**
 * Reproduces the Prisma `project` `where` used by every availability read:
 * non-template, active status, and PROJECT window (WS2 #941 — the gear-committed
 * window, `getProjectWindow`; defaults to the rental window when unset) overlaps
 * `[start, end]`. A project with no resolvable window is excluded (null fails the
 * date comparison, matching Prisma's behaviour on `lte`/`gte` against null).
 *
 * NOTE: this is the AVAILABILITY window — pricing reads the rental window
 * directly and is untouched by this (see #943).
 */
export function projectMatchesWindow(p: ConvexProject, window: DateWindow): boolean {
  if (p.isTemplate === true) return false;
  if (p.status != null && EXCLUDED_PROJECT_STATUSES.has(p.status)) return false;
  const { start, end } = getProjectWindow(p);
  if (start == null || end == null) return false;
  // start <= window.end AND end >= window.start
  return start <= window.end.getTime() && end >= window.start.getTime();
}

/** Build a `projectId → ConvexProject` map from the org's projects. */
export function indexProjectsById(projects: ConvexProject[]): Map<string, ConvexProject> {
  return new Map(projects.map((p) => [p.id, p]));
}

/**
 * For overbooking: sum non-cancelled, non-sub-hire bookings per model across all
 * projects whose window overlaps (or, when `window` is null, only `thisProjectId`).
 * Returns total-by-model and this-project-by-model maps, mirroring
 * `computeOverbookedStatus`'s aggregation.
 */
export function sumBookingsByModel(
  modelIds: string[],
  lineItems: MappedLineItem[],
  projectsById: Map<string, ConvexProject>,
  window: DateWindow | null,
  thisProjectId: string,
): { totalByModel: Map<string, number>; thisProjectByModel: Map<string, number> } {
  const modelSet = new Set(modelIds);
  const totalByModel = new Map<string, number>();
  const thisProjectByModel = new Map<string, number>();

  for (const li of lineItems) {
    if (li.modelId == null || !modelSet.has(li.modelId)) continue;
    if (li.status === "CANCELLED") continue;
    if (li.subHireId != null) continue;

    if (window) {
      const p = projectsById.get(li.projectId);
      if (!p || !projectMatchesWindow(p, window)) continue;
    } else {
      // Dateless: only this project's bookings (no overlap possible).
      if (li.projectId !== thisProjectId) continue;
    }

    totalByModel.set(li.modelId, (totalByModel.get(li.modelId) ?? 0) + li.quantity);
    if (li.projectId === thisProjectId) {
      thisProjectByModel.set(li.modelId, (thisProjectByModel.get(li.modelId) ?? 0) + li.quantity);
    }
  }

  return { totalByModel, thisProjectByModel };
}

// ─── Pure overbooked reconstruction (the body of computeOverbookedStatus) ────

/** The minimal line-item shape the overbooked computation reads. */
export type OverbookLineItem = {
  id: string;
  modelId: string | null;
  quantity: number;
  isKitChild: boolean;
  parentLineItemId: string | null;
  kitId: string | null;
  status: string;
  subHireId?: string | null;
};

/** The raw-doc bundle `overbooking.bundle` returns. */
export type OverbookingBundleData = FunctionReturnType<typeof api.overbooking.bundle>;

/**
 * The model ids the overbooked computation actually consults — the `relevantItems`
 * filter (`computeOverbookedStatus`): line items with a model, non-cancelled, not a
 * sub-hire. The native read layer passes these as the `overbooking.bundle`
 * `modelIds` arg so the bundle fetches exactly what `reconstructOverbookedStatus`
 * needs (mirrors the server's modelIds derivation).
 */
export function relevantOverbookModelIds(lineItems: OverbookLineItem[]): string[] {
  // Sorted so the returned array is DETERMINISTIC for a given set of models.
  // The overbooking.bundle subscription is keyed on this array; two hooks on the
  // project-detail page (useNativeProjectDetail + useNativeEquipmentTab) derive it
  // from different bundles, and Convex's query cache only dedupes byte-identical
  // args — insertion-order differences would spawn a SECOND subscription that
  // re-reads the whole org-wide booking set (doubling Database I/O). Sorting makes
  // both args identical so the cache serves ONE subscription. Order does not affect
  // the query result (it re-dedupes modelIds and computes order-independently).
  return [
    ...new Set(
      lineItems
        .filter((li) => li.modelId && li.status !== "CANCELLED" && li.subHireId == null)
        .map((li) => li.modelId!),
    ),
  ].sort();
}

/**
 * PURE reconstruction of `computeOverbookedStatus` from the `overbooking.bundle`
 * payload + the project's (non-cancelled) line items. Byte-for-byte the Map the
 * server `computeOverbookedStatus` produces — the server now fetches the bundle
 * and delegates here (parity-by-construction).
 *
 * `lineItems` are the project's line items already mapped + filtered to
 * `status !== "CANCELLED"` (the same input contract the server passed).
 */
export function reconstructOverbookedStatus(
  bundle: OverbookingBundleData,
  lineItems: OverbookLineItem[],
  rentalStartDate: Date | null,
  rentalEndDate: Date | null,
  projectId: string,
): Map<string, OverbookedInfo> {
  const overbookedMap = new Map<string, OverbookedInfo>();

  // Collect ALL equipment line items with a modelId (including kit children).
  // Sub-hire items represent third-party stock and never consume our inventory.
  const relevantItems = lineItems.filter(
    (li) => li.modelId && li.status !== "CANCELLED" && li.subHireId == null,
  );
  if (relevantItems.length === 0) return overbookedMap;

  const modelIds = [...new Set(relevantItems.map((li) => li.modelId!))];
  const hasDates = !!rentalStartDate && !!rentalEndDate;
  const window: DateWindow | null = hasDates
    ? { start: rentalStartDate!, end: rentalEndDate! }
    : null;

  const orgLineItems = bundle.lineItems.map(mapLineItemDoc);
  const projectsById = indexProjectsById(bundle.projects as unknown as ConvexProject[]);
  const { totalByModel: totalBookedByModel, thisProjectByModel: thisProjectBookedByModel } =
    sumBookingsByModel(modelIds, orgLineItems, projectsById, window, projectId);

  const convexModelMap = new Map(bundle.models.map((m) => [m.id, m]));
  const assetsAll = bundle.assets;
  const bulksAll = bundle.bulkAssets;
  const assetMap = new Map<string, typeof assetsAll>();
  for (const a of assetsAll) {
    if (!a.modelId || a.isActive === false) continue;
    const arr = assetMap.get(a.modelId);
    if (arr) arr.push(a); else assetMap.set(a.modelId, [a]);
  }
  const bulkMap = new Map<string, typeof bulksAll>();
  for (const b of bulksAll) {
    if (!b.modelId || b.isActive === false) continue;
    const arr = bulkMap.get(b.modelId);
    if (arr) arr.push(b); else bulkMap.set(b.modelId, [b]);
  }

  const stockByModel = new Map<string, number>();
  const effectiveStockByModel = new Map<string, number>();
  const unavailableByModel = new Map<string, number>();

  for (const modelId of modelIds) {
    const m = convexModelMap.get(modelId);
    if (!m) continue;
    const modelForBreakdown = {
      assetType: resolveModelAssetType(m.assetType, (bulkMap.get(modelId)?.length ?? 0) > 0, (assetMap.get(modelId)?.length ?? 0) > 0),
      assets: (assetMap.get(modelId) ?? []).map((a) => ({ status: a.status ?? "AVAILABLE" })),
      bulkAssets: (bulkMap.get(modelId) ?? []).map((ba) => ({ totalQuantity: ba.totalQuantity ?? 0 })),
    };
    const { totalStock, effectiveStock, unavailable } = computeStockBreakdown(modelForBreakdown);
    stockByModel.set(modelId, totalStock);
    effectiveStockByModel.set(modelId, effectiveStock);
    unavailableByModel.set(modelId, unavailable);
  }

  // For each model, check if this project's total booking exceeds available
  for (const modelId of modelIds) {
    const totalStock = stockByModel.get(modelId) || 0;
    const effectiveStock = effectiveStockByModel.get(modelId) || 0;
    const unavailable = unavailableByModel.get(modelId) || 0;
    const totalBooked = totalBookedByModel.get(modelId) || 0;
    const bookedByOthers = totalBooked - (thisProjectBookedByModel.get(modelId) || 0);
    const bookedByThisProject = thisProjectBookedByModel.get(modelId) || 0;

    // Check against effective stock (factors in unavailable assets)
    const availableForProject = effectiveStock - bookedByOthers;

    if (bookedByThisProject > availableForProject) {
      const overBy = bookedByThisProject - availableForProject;
      // Would it be overbooked if all assets were available?
      const wouldBeOverWithFullStock = bookedByThisProject > (totalStock - bookedByOthers);
      const reducedOnly = !wouldBeOverWithFullStock && unavailable > 0;

      const info: OverbookedInfo = {
        overBy,
        totalStock,
        effectiveStock,
        totalBooked,
        unavailableAssets: unavailable > 0 ? unavailable : undefined,
        reducedOnly,
      };
      // Mark all line items of this model on this project as overbooked
      for (const li of relevantItems) {
        if (li.modelId === modelId) {
          overbookedMap.set(li.id, info);
        }
      }
    }
  }

  // Also mark kit parent items as overbooked if any of their children are
  for (const li of lineItems) {
    if (li.kitId && !li.isKitChild) {
      const children = lineItems.filter((c) => c.parentLineItemId === li.id);
      const overbookedChildren = children.filter((c) => overbookedMap.has(c.id));
      if (overbookedChildren.length > 0) {
        // Aggregate: sum up the overBy from distinct models
        const seen = new Set<string>();
        let totalOver = 0;
        let totalStock = 0;
        let effectiveStock = 0;
        let totalBooked = 0;
        let anyReduced = false;
        let allReduced = true;
        let totalUnavailable = 0;
        for (const c of overbookedChildren) {
          const info = overbookedMap.get(c.id)!;
          const mid = c.modelId!;
          if (!seen.has(mid)) {
            seen.add(mid);
            totalOver += info.overBy;
            totalStock += info.totalStock;
            effectiveStock += info.effectiveStock;
            totalBooked += info.totalBooked;
            totalUnavailable += info.unavailableAssets || 0;
            if (info.reducedOnly) anyReduced = true;
            else allReduced = false;
          }
        }
        if (seen.size > 0 && !anyReduced) allReduced = false;
        const anyOverbooked = !allReduced; // at least one child is truly overbooked
        overbookedMap.set(li.id, {
          overBy: totalOver,
          totalStock,
          effectiveStock,
          totalBooked,
          inherited: true,
          unavailableAssets: totalUnavailable > 0 ? totalUnavailable : undefined,
          reducedOnly: allReduced && anyReduced,
          hasOverbookedChildren: anyOverbooked,
          hasReducedChildren: anyReduced,
        });
      }
    }
  }

  return overbookedMap;
}
