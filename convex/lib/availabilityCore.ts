/**
 * Availability / double-booking CORE for the native line-item mutations
 * (`convex/lineItemWrites.ts` addNative / patchNative).
 *
 * The two pure stock-math helpers (`resolveModelAssetType`, `computeStockBreakdown`)
 * are copied BYTE-FOR-BYTE from `src/lib/overbooking-core.ts:46-74` — the Convex
 * bundler can't resolve the `@/` alias, so they're duplicated here (same pattern as
 * `convex/lib/reservationConflicts.ts`) and PINNED against the originals by a
 * cross-import equality test in `convex/availabilityCore.test.ts`.
 *
 * `loadModelAvailabilityBundle` mirrors `convex/availabilityCheck.ts:21-53` (minus the
 * bulk-accessory count) — all reads are backend-local + bounded (referenced-only
 * projects). `computeModelAvailability` is PURE and mirrors the model-path math in
 * `src/server/line-items.ts:192-252` (== `checkAvailability`), so the enforcement the
 * native mutation adds is parity-equivalent to the server-side pre-check.
 *
 * `findAssetConflict` mirrors the dated asset double-booking check in
 * `src/server/line-items.ts:107-158`, bounded to the asset's referenced projects.
 */
import type { MutationCtx } from "../_generated/server";
import type { Doc } from "../_generated/dataModel";

// ─── Pure stock breakdown (copied byte-for-byte from overbooking-core.ts) ─────

export function resolveModelAssetType(
  assetType: string | null | undefined,
  hasBulkAssets: boolean,
): "SERIALIZED" | "BULK" {
  if (assetType === "BULK" || assetType === "SERIALIZED") return assetType;
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

/** Project statuses whose bookings are released (mirrors server literal list). */
const DEAD_PROJECT_STATUSES = ["CANCELLED", "RETURNED", "COMPLETED", "INVOICED"];

// ─── Model availability bundle (mirror of availabilityCheck.checkBundle) ──────

export interface ModelAvailabilityBundle {
  model: Doc<"models"> | null;
  activeAssets: Doc<"assets">[];
  activeBulkAssets: Doc<"bulkAssets">[];
  lines: Doc<"projectLineItems">[];
  projects: Doc<"projects">[];
}

/**
 * ONE bundle of everything the model-level availability math needs, all reads
 * backend-local + bounded. Mirrors `convex/availabilityCheck.ts:21-53` exactly
 * (minus the bulk-accessory count, which enforcement doesn't use):
 * model (org-rechecked → null if another org), active assets/bulkAssets
 * (`isActive !== false`), this model's org line items, and the REFERENCED-ONLY
 * projects those lines point at (unique projectIds, each `by_cuid`, org-rechecked).
 */
export async function loadModelAvailabilityBundle(
  ctx: MutationCtx,
  modelId: string,
  orgId: string,
): Promise<ModelAvailabilityBundle> {
  const [modelDoc, assetsRaw, bulksRaw, lineRaw] = await Promise.all([
    ctx.db.query("models").withIndex("by_cuid", (q) => q.eq("id", modelId)).unique(),
    ctx.db.query("assets").withIndex("by_modelId", (q) => q.eq("modelId", modelId)).collect(),
    ctx.db.query("bulkAssets").withIndex("by_modelId", (q) => q.eq("modelId", modelId)).collect(),
    ctx.db.query("projectLineItems").withIndex("by_modelId", (q) => q.eq("modelId", modelId)).collect(),
  ]);

  const lines = lineRaw.filter((r) => r.organizationId === orgId);
  const projectIds = [...new Set(lines.map((li) => li.projectId))];
  const projectDocs = await Promise.all(
    projectIds.map((pid) =>
      ctx.db.query("projects").withIndex("by_cuid", (q) => q.eq("id", pid)).unique(),
    ),
  );

  return {
    model: modelDoc && modelDoc.organizationId === orgId ? modelDoc : null,
    // Org-filter as well as isActive: by_modelId is a GLOBAL index (CLAUDE.md rule),
    // and the server enforcement path reads org-scoped (getActiveAssetsByModel). Without
    // this, a cross-org asset sharing the modelId would inflate effectiveStock and let an
    // overbook through.
    activeAssets: assetsRaw.filter((a) => a.organizationId === orgId && a.isActive !== false),
    activeBulkAssets: bulksRaw.filter((b) => b.organizationId === orgId && b.isActive !== false),
    lines,
    projects: projectDocs.filter(
      (p): p is NonNullable<typeof p> => !!p && p.organizationId === orgId,
    ),
  };
}

export interface ModelAvailability {
  totalStock: number;
  effectiveStock: number;
  unavailable: number;
  booked: number;
  available: number;
  assetType: "SERIALIZED" | "BULK";
}

/**
 * PURE model availability — mirrors `src/server/line-items.ts:192-252`
 * (== `checkAvailability:1332-1431`). `booked` sums non-cancelled, non-sub-hire
 * lines on overlapping live projects (dated) or on `excludeProjectId` (dateless).
 * `available = max(0, effectiveStock - booked)`.
 *
 * NOTE: dated `booked` INCLUDES `excludeProjectId`'s own lines (parity:
 * checkAvailability's booked includes this project; excludeProjectId only shapes
 * the conflicts list, which enforcement doesn't consult).
 */
export function computeModelAvailability(
  bundle: ModelAvailabilityBundle,
  opts: {
    rentalStart: number | null;
    rentalEnd: number | null;
    excludeProjectId: string;
  },
): ModelAvailability {
  const { model, activeAssets, activeBulkAssets, lines, projects } = bundle;
  const { rentalStart, rentalEnd, excludeProjectId } = opts;
  const hasDates = rentalStart != null && rentalEnd != null;

  const assetType = resolveModelAssetType(model?.assetType, activeBulkAssets.length > 0);
  const modelForBreakdown = {
    assetType,
    assets: activeAssets.map((a) => ({ status: a.status ?? "AVAILABLE" })),
    bulkAssets: activeBulkAssets.map((ba) => ({ totalQuantity: ba.totalQuantity ?? 0 })),
  };

  let overlapping: Doc<"projectLineItems">[];
  if (hasDates) {
    const conflictProjectIds = new Set(
      projects
        .filter(
          (p) =>
            !p.isTemplate &&
            !DEAD_PROJECT_STATUSES.includes(p.status ?? "") &&
            p.rentalStartDate != null &&
            p.rentalEndDate != null &&
            (p.rentalStartDate as number) <= rentalEnd &&
            (p.rentalEndDate as number) >= rentalStart,
        )
        .map((p) => p.id),
    );
    overlapping = lines.filter(
      (li) =>
        li.status !== "CANCELLED" &&
        li.subHireId == null &&
        conflictProjectIds.has(li.projectId),
    );
  } else {
    overlapping = lines.filter(
      (li) =>
        li.status !== "CANCELLED" &&
        li.subHireId == null &&
        li.projectId === excludeProjectId,
    );
  }

  const booked = overlapping.reduce((sum, li) => sum + (li.quantity ?? 0), 0);
  const { totalStock, effectiveStock, unavailable } = computeStockBreakdown(modelForBreakdown);
  const available = Math.max(0, effectiveStock - booked);

  return { totalStock, effectiveStock, unavailable, booked, available, assetType };
}

// ─── Dated asset double-booking (mirror of line-items.ts:107-158) ─────────────

/**
 * Dated-only asset double-booking. Returns the FIRST other-project doc the asset is
 * booked on during `[rentalStart, rentalEnd]` (via a legacy `line.assetId` row OR a
 * live unit), or null. Bounded to the asset's referenced projects (parity-equivalent
 * to the server's whole-org `getProjectsByOrg` conflictSet, which is only ever probed
 * by `conflictSet.has(assetLine.projectId)`).
 */
export async function findAssetConflict(
  ctx: MutationCtx,
  opts: {
    assetId: string;
    orgId: string;
    excludeProjectId: string;
    rentalStart: number;
    rentalEnd: number;
  },
): Promise<Doc<"projects"> | null> {
  const { assetId, orgId, excludeProjectId, rentalStart, rentalEnd } = opts;

  const [assetLines, assetUnits] = await Promise.all([
    ctx.db.query("projectLineItems").withIndex("by_assetId", (q) => q.eq("assetId", assetId)).collect(),
    ctx.db.query("projectLineItemUnits").withIndex("by_assetId", (q) => q.eq("assetId", assetId)).collect(),
  ]);
  const lines = assetLines.filter((l) => l.organizationId === orgId);
  const units = assetUnits.filter((u) => u.organizationId === orgId && u.status !== "RETURNED");

  // Batch-fetch the line items backing the asset's live units (one read each).
  const unitLineIds = [...new Set(units.map((u) => u.lineItemId))];
  const unitLineDocs = await Promise.all(
    unitLineIds.map((lid) =>
      ctx.db.query("projectLineItems").withIndex("by_cuid", (q) => q.eq("id", lid)).unique(),
    ),
  );
  const unitLines = unitLineDocs.filter(
    (l): l is NonNullable<typeof l> => !!l && l.organizationId === orgId,
  );

  // Referenced-only projects: the ones the asset's (non-cancelled) lines/units point
  // at. conflictSet only probes these projectIds, so fetching just them is parity.
  const projectIds = [
    ...new Set([...lines, ...unitLines].filter((l) => l.status !== "CANCELLED").map((l) => l.projectId)),
  ];
  const projectDocs = await Promise.all(
    projectIds.map((pid) =>
      ctx.db.query("projects").withIndex("by_cuid", (q) => q.eq("id", pid)).unique(),
    ),
  );
  const projectMap = new Map<string, Doc<"projects">>();
  const conflictSet = new Set<string>();
  for (const p of projectDocs) {
    if (!p || p.organizationId !== orgId) continue;
    projectMap.set(p.id, p);
    if (p.id === excludeProjectId) continue;
    if (p.isTemplate) continue;
    if (DEAD_PROJECT_STATUSES.includes(p.status ?? "")) continue;
    if (p.rentalStartDate == null || p.rentalEndDate == null) continue;
    if ((p.rentalStartDate as number) <= rentalEnd && (p.rentalEndDate as number) >= rentalStart) {
      conflictSet.add(p.id);
    }
  }

  const lineConflict = lines.find(
    (li) => li.status !== "CANCELLED" && conflictSet.has(li.projectId),
  );
  const unitConflictProjId = unitLines.find(
    (ul) => ul.status !== "CANCELLED" && conflictSet.has(ul.projectId),
  )?.projectId;
  const conflictProjId = lineConflict?.projectId ?? unitConflictProjId;
  return conflictProjId ? (projectMap.get(conflictProjId) ?? null) : null;
}

// ─── Dated kit double-booking (mirror of line-items.ts:823-860) ───────────────

/**
 * Dated-only kit double-booking. Returns the FIRST other-project doc the kit is booked
 * on (a non-cancelled, non-child parent kit line) during `[rentalStart, rentalEnd]`, or
 * null. Bounded to the kit's referenced projects (parity-equivalent to the server's
 * whole-org conflictSet, which is only probed via `conflictSet.has(kitLine.projectId)`).
 */
export async function findKitConflict(
  ctx: MutationCtx,
  opts: {
    kitId: string;
    orgId: string;
    excludeProjectId: string;
    rentalStart: number;
    rentalEnd: number;
  },
): Promise<Doc<"projects"> | null> {
  const { kitId, orgId, excludeProjectId, rentalStart, rentalEnd } = opts;

  const kitLinesRaw = await ctx.db
    .query("projectLineItems")
    .withIndex("by_kitId", (q) => q.eq("kitId", kitId))
    .collect();
  const kitLines = kitLinesRaw.filter(
    (li) =>
      li.organizationId === orgId &&
      li.kitId === kitId &&
      !li.isKitChild &&
      li.status !== "CANCELLED",
  );

  const projectIds = [...new Set(kitLines.map((li) => li.projectId))];
  const projectDocs = await Promise.all(
    projectIds.map((pid) =>
      ctx.db.query("projects").withIndex("by_cuid", (q) => q.eq("id", pid)).unique(),
    ),
  );
  const projectMap = new Map<string, Doc<"projects">>();
  const conflictSet = new Set<string>();
  for (const p of projectDocs) {
    if (!p || p.organizationId !== orgId) continue;
    projectMap.set(p.id, p);
    if (p.id === excludeProjectId) continue;
    if (p.isTemplate) continue;
    if (DEAD_PROJECT_STATUSES.includes(p.status ?? "")) continue;
    if (p.rentalStartDate == null || p.rentalEndDate == null) continue;
    if ((p.rentalStartDate as number) <= rentalEnd && (p.rentalEndDate as number) >= rentalStart) {
      conflictSet.add(p.id);
    }
  }

  const conflict = kitLines.find((li) => conflictSet.has(li.projectId));
  return conflict ? (projectMap.get(conflict.projectId) ?? null) : null;
}
