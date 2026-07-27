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
  modelId?: string | null;
  quantity?: number | null;
  status?: string | null;
  subHireId?: string | null;
  isOptional?: boolean | null;
}

export interface BoardModel {
  id: string;
  name: string;
  assetType?: string | null;
  /** WS11 (#950) — the single per-model sale-stock pool. Negative = sold
   *  below what's in stock; feeds "Sale stock to procure" below. Supersedes
   *  the old per-bulk-asset-row `BoardBulkAsset.saleStockQuantity` stub. */
  saleStockQuantity?: number | null;
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
type ModelAgg = {
  hardQty: number;
  combinedQty: number;
  hardProjectIds: Set<string>;
  pencilledProjectIds: Set<string>;
  spanStart: number;
  spanEnd: number;
};

/** Fold `lineItems` into a per-model hard/pencilled demand aggregate. */
function isRelevantDemandLine(li: BoardLineItem, projectById: Map<string, BoardProject>): boolean {
  if (li.modelId == null) return false;
  if ((li.status ?? "") === "CANCELLED") return false;
  if (li.subHireId != null) return false;
  return projectById.has(li.projectId);
}

function getOrCreateAgg(byModel: Map<string, ModelAgg>, modelId: string, clampedStart: number, clampedEnd: number): ModelAgg {
  const existing = byModel.get(modelId);
  if (existing) return existing;
  const created: ModelAgg = { hardQty: 0, combinedQty: 0, hardProjectIds: new Set(), pencilledProjectIds: new Set(), spanStart: clampedStart, spanEnd: clampedEnd };
  byModel.set(modelId, created);
  return created;
}

function applyDemandLine(agg: ModelAgg, li: BoardLineItem, p: BoardProject, clampedStart: number, clampedEnd: number): void {
  const isPencilled = li.isOptional === true || !isConfirmedOrLater(p.status);
  const qty = li.quantity ?? 0;
  agg.combinedQty += qty;
  agg.spanStart = Math.min(agg.spanStart, clampedStart);
  agg.spanEnd = Math.max(agg.spanEnd, clampedEnd);
  if (isPencilled) {
    agg.pencilledProjectIds.add(p.id);
  } else {
    agg.hardQty += qty;
    agg.hardProjectIds.add(p.id);
  }
}

function aggregateDemandByModel(
  range: DateRange,
  lineItems: BoardLineItem[],
  projectById: Map<string, BoardProject>,
): Map<string, ModelAgg> {
  const byModel = new Map<string, ModelAgg>();

  for (const li of lineItems) {
    if (!isRelevantDemandLine(li, projectById)) continue;
    const p = projectById.get(li.projectId)!;
    const { start, end } = getProjectWindow(p);
    const clampedStart = Math.max(range.start, start ?? range.start);
    const clampedEnd = Math.min(range.end, end ?? range.end);
    const agg = getOrCreateAgg(byModel, li.modelId!, clampedStart, clampedEnd);
    applyDemandLine(agg, li, p, clampedStart, clampedEnd);
  }

  return byModel;
}

function groupByModelId<T extends { modelId?: string | null; isActive?: boolean | null }>(rows: T[]): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const r of rows) {
    if (!r.modelId || r.isActive === false) continue;
    const arr = map.get(r.modelId);
    if (arr) arr.push(r); else map.set(r.modelId, [r]);
  }
  return map;
}

/** Effective (bookable) stock for one model, mirroring overbooking-core.ts. */
function effectiveStockForModel(model: BoardModel, assetsForModel: BoardAsset[], bulksForModel: BoardBulkAsset[]): number {
  const assetType = resolveModelAssetType(model.assetType, bulksForModel.length > 0, assetsForModel.length > 0);
  return computeStockBreakdown({
    assetType,
    assets: assetsForModel.map((a) => ({ status: a.status ?? "AVAILABLE" })),
    bulkAssets: bulksForModel.map((b) => ({ totalQuantity: b.totalQuantity ?? 0 })),
  }).effectiveStock;
}

function projectRef(p: BoardProject | undefined): { id: string; name: string; projectNumber: string } {
  return { id: p?.id ?? "", name: p?.name ?? "", projectNumber: p?.projectNumber ?? "" };
}

function shortageRow(modelId: string, m: BoardModel, agg: ModelAgg, qty: number, projectIds: Set<string>, projectById: Map<string, BoardProject>): GearShortageRow {
  return {
    modelId,
    modelName: m.name,
    qty,
    spanStart: agg.spanStart,
    spanEnd: agg.spanEnd,
    projects: [...projectIds].map((id) => projectRef(projectById.get(id))),
  };
}

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
  const byModel = aggregateDemandByModel(range, lineItems, projectById);

  const assetMap = groupByModelId(assets);
  const bulkMap = groupByModelId(bulkAssets);
  const modelById = new Map(models.map((m) => [m.id, m]));

  const hard: GearShortageRow[] = [];
  const pencilled: GearShortageRow[] = [];

  for (const [modelId, agg] of byModel) {
    const m = modelById.get(modelId);
    if (!m) continue;
    const effectiveStock = effectiveStockForModel(m, assetMap.get(modelId) ?? [], bulkMap.get(modelId) ?? []);

    const hardShortage = Math.max(0, agg.hardQty - effectiveStock);
    const combinedShortage = Math.max(0, agg.combinedQty - effectiveStock);
    const pencilledCollision = Math.max(0, combinedShortage - hardShortage);

    if (hardShortage > 0) hard.push(shortageRow(modelId, m, agg, hardShortage, agg.hardProjectIds, projectById));
    if (pencilledCollision > 0) pencilled.push(shortageRow(modelId, m, agg, pencilledCollision, agg.pencilledProjectIds, projectById));
  }

  hard.sort((a, b) => b.qty - a.qty);
  pencilled.sort((a, b) => b.qty - a.qty);
  return { hard, pencilled };
}

// ─── Section 3: sale stock to procure ─────────────────────────────────────────

export interface BoardSaleLine {
  id: string;
  projectId: string;
  modelId?: string | null;
  quantity?: number | null;
  status?: string | null;
  type?: string | null;
  saleMode?: string | null;
}

export interface SaleStockContributingLine {
  lineItemId: string;
  projectId: string;
  projectName: string;
  projectNumber: string;
  quantity: number;
}

export interface SaleStockRow {
  modelId: string;
  modelName: string;
  shortfallQty: number;
  contributingSaleLines: SaleStockContributingLine[];
}

/**
 * Models whose `Model.saleStockQuantity` (WS11 #950 — a single per-model
 * sale-stock pool, independent of rental assets/bulk) has gone negative:
 * sold below what was ever added as stock. Supersedes the WS3 (#942)
 * `bulkAssets.saleStockQuantity` per-bulk-asset-row stub, which nothing ever
 * wrote (see convex/schema.ts's field comment on that now-inert field).
 * `contributingSaleLines` lists the NEW_STOCK sale lines (org already
 * verified upstream) that drew the pool down, so the board can point at
 * exactly which project(s) to reconcile against.
 */
export function computeSaleStockToProcure(
  models: BoardModel[],
  saleLines: BoardSaleLine[],
  projectById: Map<string, { id: string; name: string; projectNumber: string }>,
): SaleStockRow[] {
  const negativeModels = models.filter((m) => (m.saleStockQuantity ?? 0) < 0);
  if (negativeModels.length === 0) return [];

  const linesByModel = new Map<string, BoardSaleLine[]>();
  for (const li of saleLines) {
    if (!li.modelId || li.type !== "SALE" || li.saleMode !== "NEW_STOCK" || li.status === "CANCELLED") continue;
    const arr = linesByModel.get(li.modelId);
    if (arr) arr.push(li); else linesByModel.set(li.modelId, [li]);
  }

  const rows = negativeModels.map((m) => ({
    modelId: m.id,
    modelName: m.name,
    shortfallQty: Math.abs(m.saleStockQuantity ?? 0),
    contributingSaleLines: (linesByModel.get(m.id) ?? []).map((li) => {
      const p = projectById.get(li.projectId);
      return {
        lineItemId: li.id,
        projectId: li.projectId,
        projectName: p?.name ?? "",
        projectNumber: p?.projectNumber ?? "",
        quantity: li.quantity ?? 0,
      };
    }),
  }));
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
function serviceInRange(s: BoardService, range: DateRange): boolean {
  const d = s.date ?? s.endDate;
  return d != null && d >= range.start && d <= range.end;
}

function missingCrewRowFor(
  s: BoardService,
  assignmentsByServiceId: Map<string, BoardAssignment[]>,
  projectsById: Map<string, { id: string; name: string; projectNumber: string }>,
): MissingCrewRow | null {
  const required = s.crewCountRequired;
  if (required == null || required <= 0) return null;
  const assignments = assignmentsByServiceId.get(s.id) ?? [];
  const filled = assignments.filter((a) => !EXCLUDED_ASSIGNMENT_STATUSES.has(a.status ?? "")).length;
  if (filled >= required) return null;

  const p = projectsById.get(s.projectId);
  return {
    serviceId: s.id,
    projectId: s.projectId,
    projectName: p?.name ?? "",
    projectNumber: p?.projectNumber ?? "",
    title: s.title,
    date: s.date ?? null,
    crewCountRequired: required,
    assignedCount: filled,
    shortfall: required - filled,
  };
}

export function computeServicesMissingCrew(
  range: DateRange,
  services: BoardService[],
  assignmentsByServiceId: Map<string, BoardAssignment[]>,
  projectsById: Map<string, { id: string; name: string; projectNumber: string }>,
): MissingCrewRow[] {
  const rows: MissingCrewRow[] = [];
  for (const s of services) {
    if ((s.status ?? "") === "CANCELLED") continue;
    if (!serviceInRange(s, range)) continue;
    const row = missingCrewRowFor(s, assignmentsByServiceId, projectsById);
    if (row) rows.push(row);
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
type AssignmentRef = DoubleBookingRow["a"];

function groupBy<T>(items: T[], keyOf: (item: T) => string): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const item of items) {
    const key = keyOf(item);
    const arr = map.get(key);
    if (arr) arr.push(item); else map.set(key, [item]);
  }
  return map;
}

function assignmentRef(a: BoardAssignment, projectsById: Map<string, { id: string; name: string; projectNumber: string }>): AssignmentRef {
  const p = projectsById.get(a.projectId);
  return { assignmentId: a.id, projectId: a.projectId, projectName: p?.name ?? "", projectNumber: p?.projectNumber ?? "", startDate: a.startDate ?? null, endDate: a.endDate ?? null };
}

/** (a) hard rows: an UNAVAILABLE availability block overlapping one of the member's assignments. */
function hardConflictRows(
  crewMemberId: string,
  memberAssignments: BoardAssignment[],
  blocks: BoardAvailabilityBlock[],
  range: DateRange,
  projectsById: Map<string, { id: string; name: string; projectNumber: string }>,
): DoubleBookingRow[] {
  const rows: DoubleBookingRow[] = [];
  for (const block of blocks.filter((b) => timeOverlaps(b.startDate, b.endDate, range.start, range.end))) {
    const { severity, label } = classifyAvailabilityBlock(block.type, block.reason);
    if (severity !== "hard") continue;
    const clashing = memberAssignments.find((a) => timeOverlaps(a.startDate!, a.endDate!, block.startDate, block.endDate));
    if (!clashing) continue;
    rows.push({ crewMemberId, severity: "hard", label, a: assignmentRef(clashing, projectsById), b: null });
  }
  return rows;
}

/** (b) soft rows: two overlapping assignments (different projects) for the same member. */
function softConflictRows(
  crewMemberId: string,
  memberAssignments: BoardAssignment[],
  projectsById: Map<string, { id: string; name: string; projectNumber: string }>,
): DoubleBookingRow[] {
  const rows: DoubleBookingRow[] = [];
  for (let i = 0; i < memberAssignments.length; i++) {
    for (let j = i + 1; j < memberAssignments.length; j++) {
      const a1 = memberAssignments[i];
      const a2 = memberAssignments[j];
      if (a1.projectId === a2.projectId) continue; // same job, not a conflict
      if (!timeOverlaps(a1.startDate!, a1.endDate!, a2.startDate!, a2.endDate!)) continue;
      rows.push({ crewMemberId, severity: "soft", label: "Double-booked", a: assignmentRef(a1, projectsById), b: assignmentRef(a2, projectsById) });
    }
  }
  return rows;
}

export function computeCrewDoubleBookings(
  range: DateRange,
  assignments: BoardAssignment[],
  availabilityBlocks: BoardAvailabilityBlock[],
  projectsById: Map<string, { id: string; name: string; projectNumber: string }>,
): DoubleBookingRow[] {
  const relevantAssignments = assignments.filter(
    (a) =>
      !EXCLUDED_ASSIGNMENT_STATUSES.has(a.status ?? "") &&
      a.startDate != null &&
      a.endDate != null &&
      timeOverlaps(a.startDate, a.endDate, range.start, range.end),
  );
  const byMember = groupBy(relevantAssignments, (a) => a.crewMemberId);
  const blocksByMember = groupBy(availabilityBlocks, (b) => b.crewMemberId);

  const rows: DoubleBookingRow[] = [];
  for (const [crewMemberId, memberAssignments] of byMember) {
    rows.push(...hardConflictRows(crewMemberId, memberAssignments, blocksByMember.get(crewMemberId) ?? [], range, projectsById));
    rows.push(...softConflictRows(crewMemberId, memberAssignments, projectsById));
  }

  return rows.sort((x, y) => (x.severity === y.severity ? 0 : x.severity === "hard" ? -1 : 1));
}

// Confirm-time gate (computeConfirmImpactModels / countUnconfirmedCrewForProject)
// lives in ./overbookingConfirmImpact.ts — split out to stay under the
// file's line budget; it reuses computeGearShortageBoard above directly.
