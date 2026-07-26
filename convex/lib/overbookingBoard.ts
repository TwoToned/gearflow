/**
 * Pure aggregation math for the Overbookings & Gaps board (WS3 #942). Kept
 * separate from `overbookingBoard.ts` (the query) so every section's math is
 * independently unit-testable against plain fixtures — no Convex ctx required.
 *
 * Two-layer vocabulary (`isConfirmedOrLater`, `PENCILLED_PROJECT_STATUSES`) is
 * shared with `availabilityCore.ts` (which is itself pinned against
 * `src/lib/overbooking-core.ts`) — this file imports from `availabilityCore.ts`
 * directly (both live in `convex/`, no alias problem) rather than re-deriving
 * the rule a third time.
 */
import { getProjectWindow } from "./projectWindow";
import {
  isConfirmedOrLater,
  resolveModelAssetType,
  computeStockBreakdown,
} from "./availabilityCore";
import { EXCLUDED_ASSIGNMENT_STATUSES, overlaps as timeOverlaps, classifyAvailabilityBlock } from "./crewConflicts";

/** Mirrors `src/lib/overbooking-core.ts`'s EXCLUDED_PROJECT_STATUSES. */
const DEAD_PROJECT_STATUSES = new Set(["CANCELLED", "RETURNED", "COMPLETED", "INVOICED"]);

export interface DateRange {
  start: number;
  end: number;
}

// ─── Shared input shapes (subset of the Convex docs the board bundle reads) ───

export interface BoardProject {
  id: string;
  status?: string | null;
  isTemplate?: boolean | null;
  name: string;
  projectNumber: string;
  projectStartDate?: number | null;
  projectEndDate?: number | null;
  rentalStartDate?: number | null;
  rentalEndDate?: number | null;
}

export interface BoardLineItem {
  id: string;
  projectId: string;
  modelId: string | null;
  quantity: number;
  status?: string | null;
  subHireId?: string | null;
  isOptional?: boolean | null;
}

export interface BoardModel {
  id: string;
  name: string;
  assetType?: string | null;
}

export interface BoardAsset {
  modelId: string | null;
  status?: string | null;
  isActive?: boolean | null;
}

export interface BoardBulkAsset {
  id: string;
  modelId: string | null;
  assetTag: string;
  totalQuantity?: number | null;
  isActive?: boolean | null;
  saleStockQuantity?: number | null;
}

/** A project whose PROJECT window (getProjectWindow) overlaps `range`, alive. */
export function candidateBoardProjects(projects: BoardProject[], range: DateRange): BoardProject[] {
  return projects.filter((p) => {
    if (p.isTemplate) return false;
    if (DEAD_PROJECT_STATUSES.has(p.status ?? "")) return false;
    const { start, end } = getProjectWindow(p);
    if (start == null || end == null) return false;
    return start <= range.end && end >= range.start;
  });
}

// ─── Section 1+2: gear hard shortage / pencilled collisions ───────────────────

export interface GearShortageRow {
  modelId: string;
  modelName: string;
  qty: number;
  spanStart: number;
  spanEnd: number;
  projects: { id: string; name: string; projectNumber: string }[];
}

export interface GearBoardResult {
  hard: GearShortageRow[];
  pencilled: GearShortageRow[];
}

/**
 * Per model, org-wide, over the whole `range`: sum HARD demand (non-optional
 * line on a `isConfirmedOrLater` project) vs PENCILLED demand (an `isOptional`
 * line, or any line on a not-yet-confirmed project) across every candidate
 * project whose window overlaps `range`. `hard.qty` = shortage if only hard
 * demand ran; `pencilled.qty` = the ADDITIONAL shortage if pencilled demand
 * also ran — the "would this collide if confirmed" number. Sub-hire lines are
 * excluded (covered demand, third-party stock).
 *
 * This sums across the WHOLE range the same way the per-project engine
 * (`reconstructOverbookedStatus`) sums across a project's own window — a
 * deliberate, precedented simplification (it doesn't day-slice non-overlapping
 * sub-windows within `range`), so a shortage here is a "somewhere in this
 * range, demand exceeds stock" signal, not a per-day guarantee.
 */
export function computeGearShortageBoard(
  range: DateRange,
  projects: BoardProject[],
  lineItems: BoardLineItem[],
  models: BoardModel[],
  assets: BoardAsset[],
  bulkAssets: BoardBulkAsset[],
): GearBoardResult {
  const candidates = candidateBoardProjects(projects, range);
  const projectById = new Map(candidates.map((p) => [p.id, p]));

  type ModelAgg = {
    hardQty: number;
    combinedQty: number;
    hardProjectIds: Set<string>;
    pencilledProjectIds: Set<string>;
    spanStart: number;
    spanEnd: number;
  };
  const byModel = new Map<string, ModelAgg>();

  for (const li of lineItems) {
    if (li.modelId == null) continue;
    if ((li.status ?? "") === "CANCELLED") continue;
    if (li.subHireId != null) continue;
    const p = projectById.get(li.projectId);
    if (!p) continue; // not a candidate project for this range

    const isPencilled = li.isOptional === true || !isConfirmedOrLater(p.status);
    const { start, end } = getProjectWindow(p);
    const clampedStart = Math.max(range.start, start ?? range.start);
    const clampedEnd = Math.min(range.end, end ?? range.end);

    let agg = byModel.get(li.modelId);
    if (!agg) {
      agg = { hardQty: 0, combinedQty: 0, hardProjectIds: new Set(), pencilledProjectIds: new Set(), spanStart: clampedStart, spanEnd: clampedEnd };
      byModel.set(li.modelId, agg);
    }
    agg.combinedQty += li.quantity;
    agg.spanStart = Math.min(agg.spanStart, clampedStart);
    agg.spanEnd = Math.max(agg.spanEnd, clampedEnd);
    if (isPencilled) {
      agg.pencilledProjectIds.add(p.id);
    } else {
      agg.hardQty += li.quantity;
      agg.hardProjectIds.add(p.id);
    }
  }

  // Stock per model (mirrors overbooking-core.ts's stockByModel derivation).
  const assetMap = new Map<string, BoardAsset[]>();
  for (const a of assets) {
    if (!a.modelId || a.isActive === false) continue;
    const arr = assetMap.get(a.modelId);
    if (arr) arr.push(a); else assetMap.set(a.modelId, [a]);
  }
  const bulkMap = new Map<string, BoardBulkAsset[]>();
  for (const b of bulkAssets) {
    if (!b.modelId || b.isActive === false) continue;
    const arr = bulkMap.get(b.modelId);
    if (arr) arr.push(b); else bulkMap.set(b.modelId, [b]);
  }
  const modelById = new Map(models.map((m) => [m.id, m]));

  const hard: GearShortageRow[] = [];
  const pencilled: GearShortageRow[] = [];

  for (const [modelId, agg] of byModel) {
    const m = modelById.get(modelId);
    if (!m) continue;
    const bulks = bulkMap.get(modelId) ?? [];
    const assetsForModel = assetMap.get(modelId) ?? [];
    const assetType = resolveModelAssetType(m.assetType, bulks.length > 0, assetsForModel.length > 0);
    const { effectiveStock } = computeStockBreakdown({
      assetType,
      assets: assetsForModel.map((a) => ({ status: a.status ?? "AVAILABLE" })),
      bulkAssets: bulks.map((b) => ({ totalQuantity: b.totalQuantity ?? 0 })),
    });

    const hardShortage = Math.max(0, agg.hardQty - effectiveStock);
    const combinedShortage = Math.max(0, agg.combinedQty - effectiveStock);
    const pencilledCollision = Math.max(0, combinedShortage - hardShortage);

    if (hardShortage > 0) {
      hard.push({
        modelId,
        modelName: m.name,
        qty: hardShortage,
        spanStart: agg.spanStart,
        spanEnd: agg.spanEnd,
        projects: [...agg.hardProjectIds].map((id) => projectRef(projectById.get(id))),
      });
    }
    if (pencilledCollision > 0) {
      pencilled.push({
        modelId,
        modelName: m.name,
        qty: pencilledCollision,
        spanStart: agg.spanStart,
        spanEnd: agg.spanEnd,
        projects: [...agg.pencilledProjectIds].map((id) => projectRef(projectById.get(id))),
      });
    }
  }

  hard.sort((a, b) => b.qty - a.qty);
  pencilled.sort((a, b) => b.qty - a.qty);
  return { hard, pencilled };
}

function projectRef(p: BoardProject | undefined): { id: string; name: string; projectNumber: string } {
  return { id: p?.id ?? "", name: p?.name ?? "", projectNumber: p?.projectNumber ?? "" };
}

// ─── Section 3: sale stock to procure ─────────────────────────────────────────

export interface SaleStockRow {
  modelId: string;
  modelName: string;
  shortfallQty: number;
  contributingBulkAssets: { id: string; assetTag: string; saleStockQuantity: number }[];
}

/**
 * Models whose `bulkAssets.saleStockQuantity` (WS3's minimal pre-WS11 stub
 * field) is negative on ANY of their bulk-asset rows — pre-WS11, nothing writes
 * this field yet, so it's inert (empty result) until it's populated. Bulk-asset
 * rows, not project line items, are the "contributing" unit here: there's no
 * sale-specific line-item type in the schema yet (that's WS11's job).
 */
export function computeSaleStockToProcure(bulkAssets: BoardBulkAsset[], models: BoardModel[]): SaleStockRow[] {
  const modelNameById = new Map(models.map((m) => [m.id, m.name]));
  const byModel = new Map<string, BoardBulkAsset[]>();
  for (const b of bulkAssets) {
    if (!b.modelId) continue;
    if (b.saleStockQuantity == null || b.saleStockQuantity >= 0) continue;
    const arr = byModel.get(b.modelId);
    if (arr) arr.push(b); else byModel.set(b.modelId, [b]);
  }
  const rows: SaleStockRow[] = [];
  for (const [modelId, rows_] of byModel) {
    const shortfallQty = rows_.reduce((sum, b) => sum + Math.abs(b.saleStockQuantity ?? 0), 0);
    rows.push({
      modelId,
      modelName: modelNameById.get(modelId) ?? "Unknown model",
      shortfallQty,
      contributingBulkAssets: rows_.map((b) => ({ id: b.id, assetTag: b.assetTag, saleStockQuantity: b.saleStockQuantity ?? 0 })),
    });
  }
  return rows.sort((a, b) => b.shortfallQty - a.shortfallQty);
}

// ─── Section 4: services missing crew ─────────────────────────────────────────

export interface BoardService {
  id: string;
  projectId: string;
  title: string;
  date?: number | null;
  endDate?: number | null;
  crewCountRequired?: number | null;
  status?: string | null;
}

export interface BoardAssignment {
  id: string;
  projectId: string;
  crewMemberId: string;
  serviceId?: string | null;
  status?: string | null;
  startDate?: number | null;
  endDate?: number | null;
}

export interface MissingCrewRow {
  serviceId: string;
  projectId: string;
  projectName: string;
  projectNumber: string;
  title: string;
  date: number | null;
  crewCountRequired: number;
  assignedCount: number;
  shortfall: number;
}

/**
 * Services within `range` (by `date`, falling back to `endDate`) whose FILLED
 * crew count (excluding DECLINED/CANCELLED assignments — the same predicate
 * `src/lib/crew-assignment-status.ts` fixed in the per-project UI) is below
 * `crewCountRequired`. A `crewCountRequired` of `null`/`0` is explicitly
 * skipped, never flagged (spec decision) — an unstated requirement is not a gap.
 */
export function computeServicesMissingCrew(
  range: DateRange,
  services: BoardService[],
  assignmentsByServiceId: Map<string, BoardAssignment[]>,
  projectsById: Map<string, { id: string; name: string; projectNumber: string }>,
): MissingCrewRow[] {
  const rows: MissingCrewRow[] = [];
  for (const s of services) {
    if (s.crewCountRequired == null || s.crewCountRequired <= 0) continue;
    if ((s.status ?? "") === "CANCELLED") continue;
    const d = s.date ?? s.endDate;
    if (d == null || d < range.start || d > range.end) continue;

    const assignments = assignmentsByServiceId.get(s.id) ?? [];
    const filled = assignments.filter((a) => !EXCLUDED_ASSIGNMENT_STATUSES.has(a.status ?? "")).length;
    if (filled >= s.crewCountRequired) continue;

    const p = projectsById.get(s.projectId);
    rows.push({
      serviceId: s.id,
      projectId: s.projectId,
      projectName: p?.name ?? "",
      projectNumber: p?.projectNumber ?? "",
      title: s.title,
      date: s.date ?? null,
      crewCountRequired: s.crewCountRequired,
      assignedCount: filled,
      shortfall: s.crewCountRequired - filled,
    });
  }
  return rows.sort((a, b) => (a.date ?? 0) - (b.date ?? 0));
}

// ─── Section 5: unconfirmed crew ──────────────────────────────────────────────

export interface UnconfirmedCrewRow {
  assignmentId: string;
  crewMemberId: string;
  projectId: string;
  projectName: string;
  projectNumber: string;
  startDate: number | null;
  status: string;
}

/**
 * Assignments (not `CONFIRMED`, and not already excluded/dead — DECLINED and
 * CANCELLED aren't "unconfirmed", they're settled-no) on projects whose window
 * STARTS within `range`.
 */
export function computeUnconfirmedCrew(
  range: DateRange,
  assignments: BoardAssignment[],
  projectsById: Map<string, BoardProject>,
): UnconfirmedCrewRow[] {
  const rows: UnconfirmedCrewRow[] = [];
  for (const a of assignments) {
    const status = a.status ?? "PENDING";
    if (status === "CONFIRMED" || EXCLUDED_ASSIGNMENT_STATUSES.has(status)) continue;
    const p = projectsById.get(a.projectId);
    if (!p) continue;
    const { start } = getProjectWindow(p);
    if (start == null || start < range.start || start > range.end) continue;
    rows.push({
      assignmentId: a.id,
      crewMemberId: a.crewMemberId,
      projectId: a.projectId,
      projectName: p.name,
      projectNumber: p.projectNumber,
      startDate: start,
      status,
    });
  }
  return rows.sort((a, b) => (a.startDate ?? 0) - (b.startDate ?? 0));
}

// ─── Section 6: crew double-bookings ───────────────────────────────────────────

export interface DoubleBookingRow {
  crewMemberId: string;
  severity: "hard" | "soft";
  label: string;
  a: { assignmentId: string; projectId: string; projectName: string; projectNumber: string; startDate: number | null; endDate: number | null };
  b: { assignmentId: string; projectId: string; projectName: string; projectNumber: string; startDate: number | null; endDate: number | null } | null;
}

export interface BoardAvailabilityBlock {
  id: string;
  crewMemberId: string;
  startDate: number;
  endDate: number;
  type?: string | null;
  reason?: string | null;
}

/**
 * Org-wide rollup of `crewAvailability.conflicts`'s severity model (WS3 #942):
 * for every crew member with an assignment overlapping `range`, (a) a `hard`
 * row per overlapping `UNAVAILABLE` availability block, and (b) a `soft` row
 * per pair of overlapping, non-excluded assignments for that member — the SAME
 * classification `crewAvailability.ts` uses per-member, aggregated org-wide
 * instead of one member at a time.
 */
export function computeCrewDoubleBookings(
  range: DateRange,
  assignments: BoardAssignment[],
  availabilityBlocks: BoardAvailabilityBlock[],
  projectsById: Map<string, { id: string; name: string; projectNumber: string }>,
): DoubleBookingRow[] {
  const rows: DoubleBookingRow[] = [];

  const relevantAssignments = assignments.filter(
    (a) =>
      !EXCLUDED_ASSIGNMENT_STATUSES.has(a.status ?? "") &&
      a.startDate != null &&
      a.endDate != null &&
      timeOverlaps(a.startDate, a.endDate, range.start, range.end),
  );
  const byMember = new Map<string, BoardAssignment[]>();
  for (const a of relevantAssignments) {
    const arr = byMember.get(a.crewMemberId);
    if (arr) arr.push(a); else byMember.set(a.crewMemberId, [a]);
  }

  const ref = (a: BoardAssignment) => {
    const p = projectsById.get(a.projectId);
    return { assignmentId: a.id, projectId: a.projectId, projectName: p?.name ?? "", projectNumber: p?.projectNumber ?? "", startDate: a.startDate ?? null, endDate: a.endDate ?? null };
  };

  // (a) hard — UNAVAILABLE availability block overlapping an assignment.
  const blocksByMember = new Map<string, BoardAvailabilityBlock[]>();
  for (const b of availabilityBlocks) {
    const arr = blocksByMember.get(b.crewMemberId);
    if (arr) arr.push(b); else blocksByMember.set(b.crewMemberId, [b]);
  }
  for (const [crewMemberId, memberAssignments] of byMember) {
    const blocks = (blocksByMember.get(crewMemberId) ?? []).filter((b) => timeOverlaps(b.startDate, b.endDate, range.start, range.end));
    for (const block of blocks) {
      const { severity, label } = classifyAvailabilityBlock(block.type, block.reason);
      if (severity !== "hard") continue;
      const clashing = memberAssignments.find((a) => timeOverlaps(a.startDate!, a.endDate!, block.startDate, block.endDate));
      if (!clashing) continue;
      rows.push({ crewMemberId, severity: "hard", label, a: ref(clashing), b: null });
    }
  }

  // (b) soft — two overlapping assignments for the same member.
  for (const [crewMemberId, memberAssignments] of byMember) {
    for (let i = 0; i < memberAssignments.length; i++) {
      for (let j = i + 1; j < memberAssignments.length; j++) {
        const a1 = memberAssignments[i];
        const a2 = memberAssignments[j];
        if (a1.projectId === a2.projectId) continue; // same job, not a conflict
        if (!timeOverlaps(a1.startDate!, a1.endDate!, a2.startDate!, a2.endDate!)) continue;
        rows.push({ crewMemberId, severity: "soft", label: "Double-booked", a: ref(a1), b: ref(a2) });
      }
    }
  }

  return rows.sort((x, y) => (x.severity === y.severity ? 0 : x.severity === "hard" ? -1 : 1));
}
