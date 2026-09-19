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
        a.status === "RETIRED" ||
        // WS11 (#950) — a sold unit is terminal/disposed, same as RETIRED/LOST.
        a.status === "SOLD",
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

/**
 * True when an `OverbookedInfo` entry reflects a genuine HARD overage — i.e.
 * would still be flagged under the pre-badge-widening rule (a confirmed-or-
 * later project's non-optional demand alone exceeds stock). A map entry can
 * now exist purely because of pencilled demand (`hardOverBy === 0`); a
 * consumer that must not surface a speculative collision — a rendered/exported
 * document, see `build-document-data.ts` — filters through this instead of
 * a bare `!!info` truthiness check.
 */
export function isHardOverbooked(info: OverbookedInfo | null | undefined): boolean {
  return !!info && (info.hardOverBy ?? info.overBy) > 0;
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
  // #1236 — an agreed-but-unpaid job HARD-holds its gear. The client has said
  // yes and/or an invoice is out; letting someone else book the same stock while
  // a bank transfer clears is how you end up double-booked on the one job you
  // were most sure of. CANCELLED still releases it, as it always did.
  "AWAITING_PAYMENT",
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
 * One project's claim on a model — the input unit for `allocateFifo`.
 * `claimedAt` is the EARLIEST creation time among that project's line items for
 * this model in this layer (hard or pencilled), so a project that added a
 * second unit later doesn't lose its original place in line.
 */
export interface ProjectModelClaim {
  projectId: string;
  qty: number;
  claimedAt: number;
}

/**
 * First-come-first-served stock allocation (2026-09, superseding the symmetric
 * "everyone competing for the same pool is flagged" rule — product decision
 * after the symmetric version proved too noisy in practice, especially
 * multiplied across kit children). `claims` are sorted ascending by
 * `claimedAt` (earliest booking wins), ties broken by `projectId` for
 * determinism; each claim is granted against whatever capacity remains AFTER
 * every earlier claim's FULL quantity is deducted — so only the claim(s) that
 * actually don't fit are "over," never a claim that was satisfied before a
 * later one showed up. Returns `projectId -> overBy` for projects with a
 * nonzero shortfall only (absent = fully allocated).
 */
export function allocateFifo(claims: ProjectModelClaim[], capacity: number): Map<string, number> {
  const overByProject = new Map<string, number>();
  const sorted = [...claims].sort((a, b) => a.claimedAt - b.claimedAt || a.projectId.localeCompare(b.projectId));
  let allocated = 0;
  for (const c of sorted) {
    const available = Math.max(0, capacity - allocated);
    const overBy = Math.max(0, c.qty - available);
    if (overBy > 0) overByProject.set(c.projectId, overBy);
    allocated += c.qty;
  }
  return overByProject;
}

/**
 * For overbooking: sum non-cancelled, non-sub-hire bookings per model across all
 * projects whose window overlaps (or, when `window` is null, only `thisProjectId`).
 *
 * WS3 (#942) splits every booking into HARD (non-`isOptional` line on a
 * `isConfirmedOrLater` project) vs PENCILLED (an `isOptional` line, on ANY
 * project, OR any line on a not-yet-confirmed project). Per-model, per-layer
 * claims are grouped BY PROJECT (qty summed, `claimedAt` = earliest line-item
 * creation time for that project+model+layer) so `allocateFifo` can decide
 * FCFS who's actually over capacity, instead of flagging every project sharing
 * the pool. `totalByModel` stays a plain org-wide sum (informational —
 * `OverbookedInfo.totalBooked`, unaffected by ordering).
 */
export function sumBookingsByModel(
  modelIds: string[],
  lineItems: MappedLineItem[],
  projectsById: Map<string, ConvexProject>,
  window: DateWindow | null,
  thisProjectId: string,
): {
  totalByModel: Map<string, number>;
  hardClaimsByModel: Map<string, ProjectModelClaim[]>;
  pencilledClaimsByModel: Map<string, ProjectModelClaim[]>;
} {
  const modelSet = new Set(modelIds);
  const totalByModel = new Map<string, number>();
  const hardAcc = new Map<string, Map<string, ProjectModelClaim>>();
  const pencilledAcc = new Map<string, Map<string, ProjectModelClaim>>();

  const bumpTotal = (modelId: string, qty: number) =>
    totalByModel.set(modelId, (totalByModel.get(modelId) ?? 0) + qty);

  const bumpClaim = (
    acc: Map<string, Map<string, ProjectModelClaim>>,
    modelId: string,
    projectId: string,
    qty: number,
    claimedAt: number,
  ) => {
    let byProject = acc.get(modelId);
    if (!byProject) {
      byProject = new Map();
      acc.set(modelId, byProject);
    }
    const existing = byProject.get(projectId);
    if (existing) {
      existing.qty += qty;
      existing.claimedAt = Math.min(existing.claimedAt, claimedAt);
    } else {
      byProject.set(projectId, { projectId, qty, claimedAt });
    }
  };

  for (const li of lineItems) {
    if (li.modelId == null || !modelSet.has(li.modelId)) continue;
    if (li.status === "CANCELLED") continue;
    if (li.subHireId != null) continue;
    // WS11 (#950) — a SALE line is never rental demand: NEW_STOCK draws from
    // Model.saleStockQuantity (a separate pool), and FROM_RENTAL_STOCK already
    // removed the unit from the rental pool at sale time (asset -> SOLD /
    // bulkAsset.totalQuantity decremented, see convex/lib/saleStock.ts), which
    // effectiveStock already reflects — counting it here too would
    // double-subtract it and pencil a phantom overbooking on the rental model.
    if (li.type === "SALE") continue;

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
    // `createdAt` falls back to the Convex system creation time in
    // `mapLineItemDoc`, so this is virtually always a real timestamp; the
    // `?? Number.MAX_SAFE_INTEGER` is a last-resort defensive fallback only
    // (a line with no timestamp at all goes to the back of the line, never
    // jumps ahead of a real claim).
    const claimedAt = li.createdAt?.getTime() ?? Number.MAX_SAFE_INTEGER;

    bumpTotal(li.modelId, li.quantity);
    bumpClaim(isPencilled ? pencilledAcc : hardAcc, li.modelId, li.projectId, li.quantity, claimedAt);
  }

  const toClaimsByModel = (acc: Map<string, Map<string, ProjectModelClaim>>) =>
    new Map([...acc].map(([modelId, byProject]) => [modelId, [...byProject.values()]]));

  return {
    totalByModel,
    hardClaimsByModel: toClaimsByModel(hardAcc),
    pencilledClaimsByModel: toClaimsByModel(pencilledAcc),
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
  /** WS11 (#950) — excluded from rental demand when `"SALE"`; see the SALE
   *  skip in `sumBookingsByModel`/`relevantOverbookModelIds`/`reconstructOverbookedStatus`. */
  type?: string | null;
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
        .filter((li) => li.modelId && li.status !== "CANCELLED" && li.subHireId == null && li.type !== "SALE")
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
    (li) => li.modelId && li.status !== "CANCELLED" && li.subHireId == null && li.type !== "SALE",
  );
  if (relevantItems.length === 0) return overbookedMap;

  const modelIds = [...new Set(relevantItems.map((li) => li.modelId!))];
  const hasDates = !!rentalStartDate && !!rentalEndDate;
  const window: DateWindow | null = hasDates
    ? { start: rentalStartDate!, end: rentalEndDate! }
    : null;

  const orgLineItems = bundle.lineItems.map(mapLineItemDoc);
  const projectsById = indexProjectsById(bundle.projects as unknown as ConvexProject[]);
  const { totalByModel: totalBookedByModel, hardClaimsByModel, pencilledClaimsByModel } = sumBookingsByModel(
    modelIds,
    orgLineItems,
    projectsById,
    window,
    projectId,
  );

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

  // For each model, run FCFS allocation (2026-09) to see if THIS project is
  // one of the ones that doesn't fit — not "is total demand over capacity"
  // (the old symmetric rule, which flagged every project sharing the pool).
  // Hard claims allocate first against `effectiveStock` (a CONFIRMED-or-later
  // job never loses stock to a mere quote); whatever's left over is what
  // pencilled claims compete for among themselves, also FCFS. `hardOverBy`/
  // `pencilledOverBy` stay on `OverbookedInfo` so a consumer that needs to
  // tell the two apart (the equipment-tab badge's amber-vs-red; the PDF
  // pipeline, which deliberately keeps showing hard-only — see
  // `build-document-data.ts`) still can. `totalBooked`/`totalStock`/
  // `effectiveStock` stay full-org-wide values (unchanged meaning) for
  // back-compat with every existing consumer.
  for (const modelId of modelIds) {
    const totalStock = stockByModel.get(modelId) || 0;
    const effectiveStock = effectiveStockByModel.get(modelId) || 0;
    const unavailable = unavailableByModel.get(modelId) || 0;
    const totalBooked = totalBookedByModel.get(modelId) || 0;

    const hardClaims = hardClaimsByModel.get(modelId) ?? [];
    const pencilledClaims = pencilledClaimsByModel.get(modelId) ?? [];
    const hardQtyTotal = hardClaims.reduce((sum, c) => sum + c.qty, 0);

    const hardOverByProject = allocateFifo(hardClaims, effectiveStock);
    const pencilledOverByProject = allocateFifo(pencilledClaims, Math.max(0, effectiveStock - hardQtyTotal));
    const hardOverBy = hardOverByProject.get(projectId) ?? 0;
    const pencilledOverBy = pencilledOverByProject.get(projectId) ?? 0;
    const combinedOverBy = hardOverBy + pencilledOverBy;

    if (combinedOverBy > 0) {
      // Would THIS project still be one of the ones that doesn't fit, in the
      // SAME FCFS order, if every asset were available (full totalStock
      // instead of effectiveStock)? If not, and some assets ARE unavailable,
      // the shortfall is caused solely by maintenance/lost stock, not by
      // competing demand (informational only — see equipment-rows.tsx; no
      // longer softens the badge severity, just the tooltip wording).
      const hardOverByProjectFullStock = allocateFifo(hardClaims, totalStock);
      const pencilledOverByProjectFullStock = allocateFifo(pencilledClaims, Math.max(0, totalStock - hardQtyTotal));
      const wouldBeOverWithFullStock =
        (hardOverByProjectFullStock.get(projectId) ?? 0) + (pencilledOverByProjectFullStock.get(projectId) ?? 0) > 0;
      const reducedOnly = !wouldBeOverWithFullStock && unavailable > 0;

      const info: OverbookedInfo = {
        overBy: combinedOverBy,
        totalStock,
        effectiveStock,
        totalBooked,
        unavailableAssets: unavailable > 0 ? unavailable : undefined,
        reducedOnly,
        hardOverBy,
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
        let totalUnavailable = 0;
        let totalHardOver = 0;
        let totalPencilledOver = 0;
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
            totalHardOver += info.hardOverBy ?? info.overBy;
            totalPencilledOver += info.pencilledOverBy ?? 0;
            if (info.reducedOnly) anyReduced = true;
          }
        }
        // Every child in `overbookedChildren` genuinely can't be fulfilled today
        // (combinedOverBy > 0 put it in the map) — a child's overage being caused
        // solely by maintenance/lost stock (`reducedOnly`) doesn't make it less
        // real, so it counts toward `hasOverbookedChildren` just like every
        // other child. `hasReducedChildren`/`reducedOnly` stay as informational
        // context (surfaced in the tooltip), not a lower-severity classification.
        overbookedMap.set(li.id, {
          overBy: totalOver,
          totalStock,
          effectiveStock,
          totalBooked,
          inherited: true,
          unavailableAssets: totalUnavailable > 0 ? totalUnavailable : undefined,
          reducedOnly: false,
          hasOverbookedChildren: true,
          hasReducedChildren: anyReduced,
          hardOverBy: totalHardOver,
          pencilledOverBy: totalPencilledOver,
        });
      }
    }
  }

  return overbookedMap;
}
