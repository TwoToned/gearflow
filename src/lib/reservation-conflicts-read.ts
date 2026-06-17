/**
 * Convex read layer for reservation-conflict DETECTION (Phase A read-rewiring of
 * the Convex domain-only decommission).
 *
 * The pure conflict-detection reads in `src/lib/reservation-conflicts.ts` used to
 * scan `projectLineItem` + `projectLineItemUnit` via Prisma. Those rows are
 * dual-written to Convex (see line-item-mirror.ts), so this module reads the
 * Convex copy instead and replicates the Prisma `where` filters EXACTLY in JS.
 *
 * Split into:
 *  - thin Convex fetchers (`getOrgLineItems` / `getOrgLineItemUnits`) that map
 *    epoch-ms → Date and absent → null via the shared `mapLineItemDoc` /
 *    `mapUnitDoc` mappers, and
 *  - PURE predicate/aggregation helpers (overlap math, status filters, asset-ref
 *    collection, conflict matching, swap-candidate filtering) that are unit-tested
 *    independently — the date-overlap math is the high-risk surface.
 *
 * NO Prisma fallback on a Convex miss. Auth-User joins are NOT needed here.
 *
 * The READ-THEN-WRITE reads in `swapLineItemAssetCore` (the pre-write line-item
 * lookup + the in-`$transaction` TOCTOU guard reads that gate `tx.update`) stay on
 * Prisma — they must read the same store they write, inside the same transaction.
 */

import { getConvexClient } from "@/lib/convex-client";
import { api } from "../../convex/_generated/api";
import {
  mapLineItemDoc,
  mapUnitDoc,
  type MappedLineItem,
  type MappedUnit,
} from "@/lib/project-line-item-read";
import type { ConvexAsset } from "@/lib/assets-read";
import type { ConvexProject } from "@/lib/projects-read";

/**
 * Project statuses where the booking is released — excluded from conflict
 * checks. Mirrors `DEAD_PROJECT_STATUSES` in reservation-conflicts.ts (kept in
 * sync; both derive from addLineItem's conflict guard).
 */
const DEAD_PROJECT_STATUSES = ["CANCELLED", "RETURNED", "COMPLETED", "INVOICED"] as const;

// ---------------------------------------------------------------------------
// Thin Convex fetchers
// ---------------------------------------------------------------------------

/** All org line items, mapped to the Prisma row shape (dates → Date). */
export async function getOrgLineItems(organizationId: string): Promise<MappedLineItem[]> {
  const convex = await getConvexClient();
  const docs = await convex.query(api.projectLineItems.list, { orgId: organizationId });
  return docs.map(mapLineItemDoc);
}

/** All org line-item units, mapped to the Prisma row shape (dates → Date). */
export async function getOrgLineItemUnits(organizationId: string): Promise<MappedUnit[]> {
  const convex = await getConvexClient();
  const docs = await convex.query(api.projectLineItemUnits.list, { orgId: organizationId });
  return docs.map(mapUnitDoc);
}

// ---------------------------------------------------------------------------
// PURE helpers
// ---------------------------------------------------------------------------

/**
 * Org projects that overlap `[startMs, endMs]` in a live (non-dead) status,
 * excluding templates and `excludeProjectId`. Returns the set of matching ids.
 *
 * Replicates the Prisma cross-domain
 * `project: { isTemplate: false, status: notIn(DEAD), rentalStartDate <= end, rentalEndDate >= start }`
 * join. Inclusive bounds (`<=` / `>=`) match Prisma's window-overlap semantics:
 * touching windows count as overlapping. A project with a null window can't
 * overlap (it has no window) and is excluded.
 */
export function overlappingProjectIds(
  projects: ConvexProject[],
  startMs: number,
  endMs: number,
  excludeProjectId: string,
): Set<string> {
  const ids = new Set<string>();
  for (const p of projects) {
    if (p.id === excludeProjectId) continue;
    if (p.isTemplate) continue;
    if ((DEAD_PROJECT_STATUSES as readonly string[]).includes(p.status ?? "")) continue;
    const s = p.rentalStartDate as number | null | undefined;
    const e = p.rentalEndDate as number | null | undefined;
    if (s == null || e == null) continue;
    if (s <= endMs && e >= startMs) ids.add(p.id);
  }
  return ids;
}

/** An asset reference resolved on the project being inspected. */
export interface AssetRef {
  lineItemId: string;
  assetId: string;
  modelId: string | null;
  assetTag: string;
  modelName: string;
}

/**
 * Build the "here" asset references for a project — every asset this project
 * holds, from BOTH legacy `line.assetId` rows AND `ProjectLineItemUnit` rows
 * (the fulfillment model). Replicates:
 *  - lines:  `{ projectId, assetId not null, status != CANCELLED }`
 *  - units:  `{ assetId not null, status != RETURNED, lineItem: { projectId, status != CANCELLED } }`
 *
 * `assetMap` / `modelMap` resolve assetTag + model name + (for unit rows) the
 * unit's modelId from its asset.
 */
export function collectHereAssetRefs(
  projectId: string,
  lineItems: MappedLineItem[],
  units: MappedUnit[],
  assetMap: Map<string, ConvexAsset>,
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
      modelId: l.modelId,
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

/** A conflicting booking of an asset, located on another project. */
export interface OverlapHit {
  /** The line item id that holds the asset on the other project. */
  id: string;
  projectId: string;
}

/**
 * Map each conflicting asset id → the FIRST other-project booking found (line or
 * unit). Replicates the Prisma overlap queries restricted to
 * `projectId in conflictProjectIds`, `assetId in assetIds`:
 *  - lines:  `{ assetId in, status != CANCELLED, projectId in }`
 *  - units:  `{ assetId in, status != RETURNED, lineItem: { projectId in, status != CANCELLED } }`
 *
 * Lines are scanned before units (matching the original two-`findMany` order),
 * and the first hit per asset wins (`!has` guard) — preserving the legacy
 * "lines take precedence" tie-break.
 */
export function buildOverlapByAsset(
  assetIds: Set<string>,
  conflictProjectIds: Set<string>,
  lineItems: MappedLineItem[],
  units: MappedUnit[],
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

/** Map a Convex project doc to the conflict-report project shape. */
export function toConflictProject(p: ConvexProject): {
  id: string;
  projectNumber: string;
  name: string;
  status: string;
  rentalStartDate: Date | null;
  rentalEndDate: Date | null;
} {
  return {
    id: p.id,
    projectNumber: p.projectNumber,
    name: p.name,
    status: p.status ?? "",
    rentalStartDate: p.rentalStartDate != null ? new Date(p.rentalStartDate as number) : null,
    rentalEndDate: p.rentalEndDate != null ? new Date(p.rentalEndDate as number) : null,
  };
}

/**
 * Bookable same-model swap candidates. Replicates the Prisma asset filter:
 * `{ modelId === target, isActive !== false, !kitId, status not in (RETIRED, LOST) }`.
 */
export function filterSwapCandidateAssets(
  assets: ConvexAsset[],
  modelId: string,
): ConvexAsset[] {
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
 * Asset ids among `candidateAssetIds` that are booked on some live overlapping
 * project (line or unit), EXCLUDING the line item being swapped. Replicates:
 *  - lines:  `{ assetId in, status != CANCELLED, id != excludeLineItemId, projectId in }`
 *  - units:  `{ assetId in, status != RETURNED, lineItemId != excludeLineItemId,
 *              lineItem: { status != CANCELLED, projectId in } }`
 */
export function collectBookedAssetIds(
  candidateAssetIds: Set<string>,
  conflictProjectIds: Set<string>,
  excludeLineItemId: string,
  lineItems: MappedLineItem[],
  units: MappedUnit[],
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

export { DEAD_PROJECT_STATUSES };
