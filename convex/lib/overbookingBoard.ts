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
  type?: string | null;
  /** `v.optional` in the schema — see `_creationTime` fallback below. */
  createdAt?: number | null;
  /** Convex system field, always present on a real doc. Real callers pass raw
   *  `Doc<"projectLineItems">` (structurally compatible), so this is free. */
  _creationTime?: number;
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
 * Per model, org-wide: sum HARD demand (non-optional line on a
 * `isConfirmedOrLater` project) vs PENCILLED demand (an `isOptional` line, or
 * any line on a not-yet-confirmed project) across every candidate project
 * whose window overlaps `range`. `hard.qty` = shortage if only hard demand
 * ran; `pencilled.qty` = the ADDITIONAL shortage if pencilled demand also ran
 * — the "would this collide if confirmed" number. Sub-hire lines are excluded
 * (covered demand, third-party stock).
 *
 * **Day-sliced (2026-09 fix)**: two projects that each fit fine on their own
 * but whose windows both happen to fall somewhere inside `range` used to be
 * pooled into ONE combined demand figure even when their actual dates never
 * overlap EACH OTHER (e.g. project A runs Oct 1-15, project B runs Oct 18-24,
 * `range` is Oct 1-19 — A and B never compete for the same day, but both got
 * summed as if they did). `sweepModelConflicts` below runs a proper sweep-line
 * over each model's per-project claim windows, so a shortage is only reported
 * for the actual time segment(s) where demand genuinely exceeds stock — a
 * model can now produce more than one `GearShortageRow` if it has multiple,
 * non-adjacent real conflict windows within `range`.
 */
/** One project's claim on a model — mirrors `ProjectModelClaim` in
 *  `src/lib/overbooking-core.ts` (duplicated, not imported: this file lives in
 *  `convex/lib/` and that one is `src/lib/`, no `@/` alias resolution between
 *  the two — same reason `isConfirmedOrLater`/`PENCILLED_PROJECT_STATUSES` are
 *  duplicated rather than shared). `claimedAt` is the EARLIEST creation time
 *  among that project's lines for this model in this layer; `start`/`end` are
 *  that project's own (range-clamped) window — every line item on the same
 *  project shares the same window (`getProjectWindow` is a function of the
 *  project, not the line item), so one claim per project is exact, not an
 *  approximation. */
type ProjectClaim = { qty: number; claimedAt: number; start: number; end: number };

type ModelAgg = {
  hardClaims: Map<string, ProjectClaim>; // projectId -> claim
  pencilledClaims: Map<string, ProjectClaim>;
};

/**
 * First-come-first-served stock allocation (2026-09, superseding the symmetric
 * "everyone competing for the pool is flagged" rule) — see the matching
 * `allocateFifo` in `src/lib/overbooking-core.ts` for the full rationale.
 * `claims` sorted ascending by `claimedAt` (earliest wins), ties broken by
 * `projectId`; each is granted against whatever capacity remains after every
 * earlier claim's FULL quantity is deducted. Returns `projectId -> overBy` for
 * projects with a nonzero shortfall only.
 */
function allocateFifo(claims: Map<string, ProjectClaim>, capacity: number): Map<string, number> {
  const overByProject = new Map<string, number>();
  const sorted = [...claims].sort(([aId, a], [bId, b]) => a.claimedAt - b.claimedAt || aId.localeCompare(bId));
  let allocated = 0;
  for (const [projectId, c] of sorted) {
    const available = Math.max(0, capacity - allocated);
    const overBy = Math.max(0, c.qty - available);
    if (overBy > 0) overByProject.set(projectId, overBy);
    allocated += c.qty;
  }
  return overByProject;
}

/** Fold `lineItems` into a per-model hard/pencilled demand aggregate. */
function isRelevantDemandLine(li: BoardLineItem, projectById: Map<string, BoardProject>): boolean {
  if (li.modelId == null) return false;
  if ((li.status ?? "") === "CANCELLED") return false;
  if (li.subHireId != null) return false;
  // WS11 (#950) — a SALE line is never rental demand: NEW_STOCK draws from
  // Model.saleStockQuantity (its own pool, covered by
  // computeSaleStockToProcure below), and FROM_RENTAL_STOCK already removed
  // the unit from the rental pool at sale time (see saleStock.ts) — counting
  // it here too would pencil a phantom shortage against the rental model.
  if (li.type === "SALE") return false;
  return projectById.has(li.projectId);
}

function getOrCreateAgg(byModel: Map<string, ModelAgg>, modelId: string): ModelAgg {
  const existing = byModel.get(modelId);
  if (existing) return existing;
  const created: ModelAgg = { hardClaims: new Map(), pencilledClaims: new Map() };
  byModel.set(modelId, created);
  return created;
}

function bumpClaim(claims: Map<string, ProjectClaim>, projectId: string, qty: number, claimedAt: number, start: number, end: number): void {
  const existing = claims.get(projectId);
  if (existing) {
    existing.qty += qty;
    existing.claimedAt = Math.min(existing.claimedAt, claimedAt);
  } else {
    claims.set(projectId, { qty, claimedAt, start, end });
  }
}

function applyDemandLine(agg: ModelAgg, li: BoardLineItem, p: BoardProject, clampedStart: number, clampedEnd: number): void {
  const isPencilled = li.isOptional === true || !isConfirmedOrLater(p.status);
  const qty = li.quantity ?? 0;
  // `createdAt` is `v.optional`; `_creationTime` (Convex system field) is
  // always present on a real doc and is the fallback — same reasoning as
  // `mapLineItemDoc` in `project-equipment-reconstruct.ts`.
  const claimedAt = li.createdAt ?? li._creationTime ?? Number.MAX_SAFE_INTEGER;
  bumpClaim(isPencilled ? agg.pencilledClaims : agg.hardClaims, p.id, qty, claimedAt, clampedStart, clampedEnd);
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
    const agg = getOrCreateAgg(byModel, li.modelId!);
    applyDemandLine(agg, li, p, clampedStart, clampedEnd);
  }

  return byModel;
}

// ─── Sweep-line: real day-by-day overlap, not "anywhere in range" pooling ─────

type ConflictSegment = { start: number; end: number; overByProject: Map<string, number> };

/** A stable string key for "which projects are over by how much" — used to
 *  merge adjacent time segments that reached the identical outcome, so one
 *  continuous conflict reports as ONE row instead of fragmenting at every
 *  claim's start/end boundary. */
function segmentSignature(overByProject: Map<string, number>): string {
  return [...overByProject.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([id, qty]) => `${id}:${qty}`)
    .join("|");
}

function mergeAdjacentSegments(segments: ConflictSegment[]): ConflictSegment[] {
  if (segments.length === 0) return [];
  const merged: ConflictSegment[] = [];
  let current: ConflictSegment = { start: segments[0].start, end: segments[0].end, overByProject: segments[0].overByProject };
  let currentSig = segmentSignature(current.overByProject);
  for (let i = 1; i < segments.length; i++) {
    const seg = segments[i];
    const sig = segmentSignature(seg.overByProject);
    if (seg.start === current.end + 1 && sig === currentSig) {
      current = { ...current, end: seg.end };
    } else {
      merged.push(current);
      current = { start: seg.start, end: seg.end, overByProject: seg.overByProject };
      currentSig = sig;
    }
  }
  merged.push(current);
  return merged;
}

type ConflictEntry = { projectId: string; claim: ProjectClaim; layer: "hard" | "pencilled" };

/** The claims active at `segStart`, split by layer — a claim is active on a
 *  segment iff the segment's (breakpoint-derived, constant-active-set) start
 *  point falls inside its inclusive [start, end]. */
function activeClaimsAt(entries: ConflictEntry[], segStart: number): { activeHard: Map<string, ProjectClaim>; activePencilled: Map<string, ProjectClaim> } {
  const activeHard = new Map<string, ProjectClaim>();
  const activePencilled = new Map<string, ProjectClaim>();
  for (const e of entries) {
    if (e.claim.start <= segStart && e.claim.end >= segStart) {
      (e.layer === "hard" ? activeHard : activePencilled).set(e.projectId, e.claim);
    }
  }
  return { activeHard, activePencilled };
}

/** FCFS-allocates one sweep segment's active claims — hard claims always
 *  allocate before pencilled ones, so pencilled capacity at this segment is
 *  `effectiveStock` minus whatever hard demand is active RIGHT HERE, not the
 *  claim's global hard total. */
function allocateSegment(
  segStart: number,
  segEnd: number,
  entries: ConflictEntry[],
  effectiveStock: number,
): { hard?: ConflictSegment; pencilled?: ConflictSegment } {
  const { activeHard, activePencilled } = activeClaimsAt(entries, segStart);
  if (activeHard.size === 0 && activePencilled.size === 0) return {};

  const activeHardQtyTotal = [...activeHard.values()].reduce((sum, c) => sum + c.qty, 0);
  const hardOverBy = allocateFifo(activeHard, effectiveStock);
  const pencilledOverBy = allocateFifo(activePencilled, Math.max(0, effectiveStock - activeHardQtyTotal));

  return {
    hard: hardOverBy.size > 0 ? { start: segStart, end: segEnd, overByProject: hardOverBy } : undefined,
    pencilled: pencilledOverBy.size > 0 ? { start: segStart, end: segEnd, overByProject: pencilledOverBy } : undefined,
  };
}

/**
 * Sweep-line over one model's hard + pencilled claims: only claims that are
 * ACTUALLY active on the same day compete for the same stock. Returns merged,
 * non-adjacent-duplicate segments per layer — each one a genuine, date-bounded
 * conflict.
 */
function sweepModelConflicts(
  hardClaims: Map<string, ProjectClaim>,
  pencilledClaims: Map<string, ProjectClaim>,
  effectiveStock: number,
): { hardSegments: ConflictSegment[]; pencilledSegments: ConflictSegment[] } {
  const entries: ConflictEntry[] = [
    ...[...hardClaims].map(([projectId, claim]): ConflictEntry => ({ projectId, claim, layer: "hard" })),
    ...[...pencilledClaims].map(([projectId, claim]): ConflictEntry => ({ projectId, claim, layer: "pencilled" })),
  ];
  if (entries.length === 0) return { hardSegments: [], pencilledSegments: [] };

  // Breakpoints: every claim's start, and one tick past every claim's end
  // (claims are inclusive [start, end], so `end + 1` is the exclusive
  // boundary) — between two consecutive breakpoints, the active set never
  // changes, so sampling at the segment's own start point is exact.
  const breakpoints = [...new Set(entries.flatMap((e) => [e.claim.start, e.claim.end + 1]))].sort((a, b) => a - b);

  const rawHard: ConflictSegment[] = [];
  const rawPencilled: ConflictSegment[] = [];

  for (let i = 0; i < breakpoints.length - 1; i++) {
    const segStart = breakpoints[i];
    const segEnd = breakpoints[i + 1] - 1;
    if (segEnd < segStart) continue;

    const { hard, pencilled } = allocateSegment(segStart, segEnd, entries, effectiveStock);
    if (hard) rawHard.push(hard);
    if (pencilled) rawPencilled.push(pencilled);
  }

  return { hardSegments: mergeAdjacentSegments(rawHard), pencilledSegments: mergeAdjacentSegments(rawPencilled) };
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

function shortageRow(modelId: string, m: BoardModel, segment: ConflictSegment, projectById: Map<string, BoardProject>): GearShortageRow {
  return {
    modelId,
    modelName: m.name,
    qty: [...segment.overByProject.values()].reduce((sum, v) => sum + v, 0),
    spanStart: segment.start,
    spanEnd: segment.end,
    projects: [...segment.overByProject.keys()].map((id) => projectRef(projectById.get(id))),
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

    // Day-sliced FCFS (2026-09): only claims that are ACTUALLY active on the
    // same day compete for the same stock, and only the claim(s) that don't
    // fit are listed — not every project sharing the model, and not a project
    // whose window never overlaps the other claimant's at all. A model can
    // produce more than one row here if it has multiple distinct conflict
    // windows within `range`.
    const { hardSegments, pencilledSegments } = sweepModelConflicts(agg.hardClaims, agg.pencilledClaims, effectiveStock);
    for (const seg of hardSegments) hard.push(shortageRow(modelId, m, seg, projectById));
    for (const seg of pencilledSegments) pencilled.push(shortageRow(modelId, m, seg, projectById));
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
