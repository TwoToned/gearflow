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
  /**
   * WS3 (#942) — the HARD-layer overage (non-`isOptional` lines on a
   * CONFIRMED-or-later project). Identical value to `overBy` — `overBy` IS the
   * hard number (preserving every existing badge/consumer's behaviour
   * byte-for-byte); `hardOverBy` is the explicit, self-documenting name new
   * two-layer-aware callers (the Overbookings & Gaps board, the confirm-time
   * gate) should read instead of relying on `overBy`'s meaning by convention.
   */
  hardOverBy?: number;
  /**
   * WS3 (#942) — the ADDITIONAL overage that would exist if every currently
   * PENCILLED booking for this model (an `isOptional` line, or any line on a
   * not-yet-confirmed project) were also treated as hard demand. Zero when
   * there is no pencilled demand, or when it wouldn't push the model over
   * capacity beyond the hard overage alone. This is what "pencilled warns,
   * never blocks" measures: a non-zero value flags a collision that would only
   * bite if a quoted/optional line is later confirmed — never a violation of
   * today's hard rule.
   */
  pencilledOverBy?: number;
}

// ─── Window / booking aggregation (moved from availability-read.ts) ──────────

/** Project statuses excluded from availability/booking windows (Prisma `notIn`). */
export const EXCLUDED_PROJECT_STATUSES: ReadonlySet<string> = new Set([
  "CANCELLED",
  "RETURNED",
  "COMPLETED",
  "INVOICED",
]);

// ─── Two-layer hard/pencilled availability (WS3 #942) ─────────────────────────

/**
 * Statuses where the GIG ITSELF is still speculative — every one of its lines,
 * optional or not, stays PENCILLED (spec decision, WS3 #942/"Overbookings & Gaps").
 * Mirrors `stageIndexForStatus` stages before "confirmed"
 * (`src/components/projects/project-lifecycle.tsx`) without importing the
 * component. Never overlaps `EXCLUDED_PROJECT_STATUSES` — a project in one of
 * those is already excluded from the booking window entirely upstream
 * (`projectMatchesWindow`), so this set only needs to partition the "still alive"
 * statuses into pencilled vs hard.
 */
export const PENCILLED_PROJECT_STATUSES: ReadonlySet<string> = new Set([
  "ENQUIRY",
  "QUOTING",
  "QUOTED",
]);

/**
 * Statuses where the gig is locked in — every non-`isOptional` line HARD-holds
 * stock; an `isOptional` line stays pencilled regardless (the "confirmed gigs
 * hard-hold everything except optional lines" rule).
 */
export const HARD_PROJECT_STATUSES: ReadonlySet<string> = new Set([
  "CONFIRMED",
  "PREPPING",
  "CHECKED_OUT",
  "ON_SITE",
]);

/**
 * True once a project's status has passed QUOTED into CONFIRMED-or-later — the
 * "gig is locked in" boundary the two-layer pencil rule keys off. A project in
 * `EXCLUDED_PROJECT_STATUSES` (CANCELLED/RETURNED/COMPLETED/INVOICED) never
 * reaches this function in practice (excluded earlier by `projectMatchesWindow`),
 * but for any status this doesn't explicitly recognise as hard, the safe default
 * is `false` (pencilled) — never silently promote an unrecognised status to hard.
 */
export function isConfirmedOrLater(status: string | null | undefined): boolean {
  return status != null && HARD_PROJECT_STATUSES.has(status);
}

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
 *
 * WS3 (#942) additionally splits every sum into HARD (non-`isOptional` line on a
 * `isConfirmedOrLater` project) vs PENCILLED (an `isOptional` line, on ANY
 * project, OR any line on a not-yet-confirmed project) — the two are a strict
 * partition of every counted booking, so `hard + pencilled === total` for every
 * model at every key. `total`/`thisProject` are kept (unchanged shape/values) so
 * this stays a drop-in superset for any existing caller.
 */
export function sumBookingsByModel(
  modelIds: string[],
  lineItems: MappedLineItem[],
  projectsById: Map<string, ConvexProject>,
  window: DateWindow | null,
  thisProjectId: string,
): {
  totalByModel: Map<string, number>;
  thisProjectByModel: Map<string, number>;
  hardTotalByModel: Map<string, number>;
  hardThisProjectByModel: Map<string, number>;
  pencilledTotalByModel: Map<string, number>;
  pencilledThisProjectByModel: Map<string, number>;
} {
  const modelSet = new Set(modelIds);
  const totalByModel = new Map<string, number>();
  const thisProjectByModel = new Map<string, number>();
  const hardTotalByModel = new Map<string, number>();
  const hardThisProjectByModel = new Map<string, number>();
  const pencilledTotalByModel = new Map<string, number>();
  const pencilledThisProjectByModel = new Map<string, number>();

  const bump = (map: Map<string, number>, modelId: string, qty: number) =>
    map.set(modelId, (map.get(modelId) ?? 0) + qty);

  for (const li of lineItems) {
    if (li.modelId == null || !modelSet.has(li.modelId)) continue;
    if (li.status === "CANCELLED") continue;
    if (li.subHireId != null) continue;

    let p: ConvexProject | undefined;
    if (window) {
      p = projectsById.get(li.projectId);
      if (!p || !projectMatchesWindow(p, window)) continue;
    } else {
      // Dateless: only this project's bookings (no overlap possible).
      if (li.projectId !== thisProjectId) continue;
      p = projectsById.get(li.projectId);
    }

    const isPencilled = li.isOptional === true || !isConfirmedOrLater(p?.status);

    bump(totalByModel, li.modelId, li.quantity);
    bump(isPencilled ? pencilledTotalByModel : hardTotalByModel, li.modelId, li.quantity);
    if (li.projectId === thisProjectId) {
      bump(thisProjectByModel, li.modelId, li.quantity);
      bump(isPencilled ? pencilledThisProjectByModel : hardThisProjectByModel, li.modelId, li.quantity);
    }
  }

  return {
    totalByModel,
    thisProjectByModel,
    hardTotalByModel,
    hardThisProjectByModel,
    pencilledTotalByModel,
    pencilledThisProjectByModel,
  };
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
  /**
   * WS3 (#942) — an optional line always stays PENCILLED, even on a
   * CONFIRMED-or-later project. Optional (defaults to `false`/non-optional) so
   * every pre-WS3 caller — none of which pass this field — keeps its existing
   * all-hard behaviour unchanged.
   */
  isOptional?: boolean;
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
  const {
    totalByModel: totalBookedByModel,
    thisProjectByModel: thisProjectBookedByModel,
    hardTotalByModel,
    hardThisProjectByModel,
  } = sumBookingsByModel(modelIds, orgLineItems, projectsById, window, projectId);

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

  // For each model, check if this project's total booking exceeds available.
  // WS3 (#942): the gate below now runs on the HARD-only sums (non-`isOptional`
  // lines on a confirmed-or-later project) — an optional line, or ANY line on a
  // still-quoted project, drops out of this sum entirely. This is the two-layer
  // rule: existing per-project badges/PDFs/warehouse pull-sheet flags are
  // UNCHANGED for the common case (no optional lines, confirmed project — hard
  // === what totalBooked always was), and only lose a flag when the overage was
  // caused purely by pencilled demand — "that's the rule working," not a
  // regression. `totalBooked`/`totalStock`/`effectiveStock` stay full-combined
  // values (unchanged meaning) for back-compat with every existing consumer.
  for (const modelId of modelIds) {
    const totalStock = stockByModel.get(modelId) || 0;
    const effectiveStock = effectiveStockByModel.get(modelId) || 0;
    const unavailable = unavailableByModel.get(modelId) || 0;
    const totalBooked = totalBookedByModel.get(modelId) || 0;

    const hardBookedByThisProject = hardThisProjectByModel.get(modelId) || 0;
    const hardBookedByOthers = (hardTotalByModel.get(modelId) || 0) - hardBookedByThisProject;
    const hardAvailableForProject = effectiveStock - hardBookedByOthers;

    if (hardBookedByThisProject > hardAvailableForProject) {
      const overBy = hardBookedByThisProject - hardAvailableForProject;
      // Would it be overbooked if all assets were available?
      const wouldBeOverWithFullStock = hardBookedByThisProject > (totalStock - hardBookedByOthers);
      const reducedOnly = !wouldBeOverWithFullStock && unavailable > 0;

      // WS3 (#942) — pencilledOverBy: the ADDITIONAL overage if every currently
      // pencilled booking for this model (org-wide, not just this project) also
      // became hard demand, using the SAME (effectiveStock, others) baseline.
      const combinedBookedByThisProject = thisProjectBookedByModel.get(modelId) || 0;
      const combinedBookedByOthers = totalBooked - combinedBookedByThisProject;
      const combinedAvailableForProject = effectiveStock - combinedBookedByOthers;
      const combinedOverBy = Math.max(0, combinedBookedByThisProject - combinedAvailableForProject);
      const pencilledOverBy = Math.max(0, combinedOverBy - overBy);

      const info: OverbookedInfo = {
        overBy,
        totalStock,
        effectiveStock,
        totalBooked,
        unavailableAssets: unavailable > 0 ? unavailable : undefined,
        reducedOnly,
        hardOverBy: overBy,
        pencilledOverBy,
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
