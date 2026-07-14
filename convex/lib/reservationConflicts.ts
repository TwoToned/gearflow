/**
 * Pure conflict-detection helpers for `convex/reservationConflicts.ts` (Phase 3
 * browser-direct re-homing). Ported BYTE-FOR-BYTE from the Prisma-era pure helpers in
 * `src/lib/reservation-conflicts-read.ts` (the Convex bundler can't resolve the `@/`
 * alias, so they're duplicated here on minimal Convex-side shapes and pinned by
 * `convex/reservationConflicts.test.ts`). Rows are read straight from the Convex docs —
 * the fields these helpers use (status/assetId/modelId/projectId, rental dates as
 * epoch-ms) are identical on the docs, so no date/Prisma mapping is needed.
 *
 * A conflict: a serialized asset held by project P (line.assetId row OR live unit row)
 * that also appears on a line/unit of a DIFFERENT live project P2 whose rental window
 * overlaps P's. Dateless projects can't conflict.
 */

/** Project statuses where the booking is released — excluded from conflict checks. */
export const DEAD_PROJECT_STATUSES = ["CANCELLED", "RETURNED", "COMPLETED", "INVOICED"] as const;

export interface CLine {
  id: string;
  projectId: string;
  organizationId: string;
  status?: string;
  assetId?: string | null;
  modelId?: string | null;
}
export interface CUnit {
  assetId?: string | null;
  status?: string;
  lineItemId: string;
}
export interface CProject {
  id: string;
  projectNumber: string;
  name: string;
  isTemplate?: boolean;
  status?: string;
  rentalStartDate?: number | null;
  rentalEndDate?: number | null;
}
export interface CAsset {
  id: string;
  assetTag: string;
  modelId?: string | null;
  isActive?: boolean;
  kitId?: string | null;
  status?: string;
  serialNumber?: string | null;
  customName?: string | null;
}

/**
 * Org projects that overlap `[startMs, endMs]` in a live (non-dead) status, excluding
 * templates and `excludeProjectId`. Inclusive bounds match Prisma window-overlap: a
 * touching window counts as overlapping; a null-window project can't overlap.
 */
export function overlappingProjectIds(
  projects: CProject[],
  startMs: number,
  endMs: number,
  excludeProjectId: string,
): Set<string> {
  const ids = new Set<string>();
  for (const p of projects) {
    if (p.id === excludeProjectId) continue;
    if (p.isTemplate) continue;
    if ((DEAD_PROJECT_STATUSES as readonly string[]).includes(p.status ?? "")) continue;
    const s = p.rentalStartDate ?? null;
    const e = p.rentalEndDate ?? null;
    if (s == null || e == null) continue;
    if (s <= endMs && e >= startMs) ids.add(p.id);
  }
  return ids;
}

export interface AssetRef {
  lineItemId: string;
  assetId: string;
  modelId: string | null;
  assetTag: string;
  modelName: string;
}

/**
 * The "here" asset references for a project — every asset it holds, from BOTH legacy
 * `line.assetId` rows AND live `ProjectLineItemUnit` rows.
 */
export function collectHereAssetRefs(
  projectId: string,
  lineItems: CLine[],
  units: CUnit[],
  assetMap: Map<string, CAsset>,
  modelMap: Map<string, { name: string }>,
): AssetRef[] {
  const lineById = new Map(lineItems.map((l) => [l.id, l]));
  const refs: AssetRef[] = [];

  for (const l of lineItems) {
    if (l.projectId !== projectId) continue;
    if (l.status === "CANCELLED") continue;
    if (!l.assetId) continue;
    refs.push({
      lineItemId: l.id,
      assetId: l.assetId,
      modelId: l.modelId ?? null,
      assetTag: assetMap.get(l.assetId)?.assetTag ?? "—",
      modelName: l.modelId ? (modelMap.get(l.modelId)?.name ?? "—") : "—",
    });
  }

  for (const u of units) {
    if (!u.assetId) continue;
    if (u.status === "RETURNED") continue;
    const line = lineById.get(u.lineItemId);
    if (!line || line.projectId !== projectId || line.status === "CANCELLED") continue;
    const unitAsset = assetMap.get(u.assetId);
    const unitModelId = unitAsset?.modelId ?? null;
    refs.push({
      lineItemId: u.lineItemId,
      assetId: u.assetId,
      modelId: unitModelId,
      assetTag: unitAsset?.assetTag ?? "—",
      modelName: unitModelId ? (modelMap.get(unitModelId)?.name ?? "—") : "—",
    });
  }

  return refs;
}

export interface OverlapHit {
  id: string;
  projectId: string;
}

/**
 * Map each conflicting asset id → the FIRST other-project booking (line or unit). Lines
 * are scanned before units, first hit per asset wins (lines-take-precedence tie-break).
 */
export function buildOverlapByAsset(
  assetIds: Set<string>,
  conflictProjectIds: Set<string>,
  lineItems: CLine[],
  units: CUnit[],
): Map<string, OverlapHit> {
  const lineById = new Map(lineItems.map((l) => [l.id, l]));
  const overlapByAsset = new Map<string, OverlapHit>();

  for (const l of lineItems) {
    if (!l.assetId || !assetIds.has(l.assetId)) continue;
    if (l.status === "CANCELLED") continue;
    if (!conflictProjectIds.has(l.projectId)) continue;
    if (!overlapByAsset.has(l.assetId)) {
      overlapByAsset.set(l.assetId, { id: l.id, projectId: l.projectId });
    }
  }

  for (const u of units) {
    if (!u.assetId || !assetIds.has(u.assetId)) continue;
    if (u.status === "RETURNED") continue;
    const line = lineById.get(u.lineItemId);
    if (!line || line.status === "CANCELLED") continue;
    if (!conflictProjectIds.has(line.projectId)) continue;
    if (!overlapByAsset.has(u.assetId)) {
      overlapByAsset.set(u.assetId, { id: u.lineItemId, projectId: line.projectId });
    }
  }

  return overlapByAsset;
}

/** Map a Convex project doc to the conflict-report project shape (dates as epoch-ms). */
export function toConflictProject(p: CProject): {
  id: string;
  projectNumber: string;
  name: string;
  status: string;
  rentalStartDate: number | null;
  rentalEndDate: number | null;
} {
  return {
    id: p.id,
    projectNumber: p.projectNumber,
    name: p.name,
    status: p.status ?? "",
    rentalStartDate: p.rentalStartDate ?? null,
    rentalEndDate: p.rentalEndDate ?? null,
  };
}

/**
 * Bookable same-model swap candidates:
 * `{ modelId === target, isActive !== false, !kitId, status not in (RETIRED, LOST) }`.
 */
export function filterSwapCandidateAssets(assets: CAsset[], modelId: string): CAsset[] {
  return assets.filter(
    (a) =>
      a.modelId === modelId &&
      a.isActive !== false &&
      !a.kitId &&
      a.status !== "RETIRED" &&
      a.status !== "LOST",
  );
}

/**
 * Asset ids among `candidateAssetIds` booked on some live overlapping project (line or
 * unit), EXCLUDING the line item being swapped.
 */
export function collectBookedAssetIds(
  candidateAssetIds: Set<string>,
  conflictProjectIds: Set<string>,
  excludeLineItemId: string,
  lineItems: CLine[],
  units: CUnit[],
): Set<string> {
  const lineById = new Map(lineItems.map((l) => [l.id, l]));
  const booked = new Set<string>();

  for (const l of lineItems) {
    if (!l.assetId || !candidateAssetIds.has(l.assetId)) continue;
    if (l.status === "CANCELLED") continue;
    if (l.id === excludeLineItemId) continue;
    if (!conflictProjectIds.has(l.projectId)) continue;
    booked.add(l.assetId);
  }

  for (const u of units) {
    if (!u.assetId || !candidateAssetIds.has(u.assetId)) continue;
    if (u.status === "RETURNED") continue;
    if (u.lineItemId === excludeLineItemId) continue;
    const line = lineById.get(u.lineItemId);
    if (!line || line.status === "CANCELLED") continue;
    if (!conflictProjectIds.has(line.projectId)) continue;
    booked.add(u.assetId);
  }

  return booked;
}
