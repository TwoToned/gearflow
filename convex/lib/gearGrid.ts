/**
 * The Schedule's Gear grid (UX Phase 18, D81, spec §9o.4): the free count per
 * model per day. PURE: no ctx, no clock. It is NOT a second availability
 * formula, and it never sums a day as one lump. Stock is
 * `stockBreakdownForModel` (`availabilityCore`'s `computeStockBreakdown`),
 * demand is the Overbookings board's own per-project claims
 * (`aggregateDemandByModel`: `stockBackedQty`, sub-hire / SALE / cancelled lines
 * out, held statuses from `HARD_PROJECT_STATUSES`), and the shortfall is the
 * board's own sweep (`sweepModelConflicts`: real datetime intervals, FCFS, hard
 * before pencilled). A cell is read off those over the day's interval:
 *
 *   held      = PEAK concurrent held demand inside the day
 *   free      = effective − held
 *   short     = the board's peak hard overage inside the day   (0 ⇔ no board row)
 *   atRisk    = the board's peak pencilled overage inside the day
 *
 * So "short on D" holds exactly when the Overbookings board and the Jobs `clash`
 * word have a conflict overlapping D: stock 1, A ends 10:00, B starts 14:00 is
 * NOT short (they never hold the unit at once). Parity is pinned against
 * `computeGearShortageBoard` over random datetime windows.
 *
 * A cell whose inputs were not read in full is `unknown` and carries no number:
 * the whole model when its stock was beyond the budget, every model on the days
 * an unread job covers, everything when the alive scan was cut.
 */
import { getProjectWindow } from "./projectWindow";
import {
  aggregateDemandByModel,
  candidateBoardProjects,
  groupByModelId,
  stockBreakdownForModel,
  sweepModelConflicts,
  type BoardProject,
  type ConflictSegment,
  type ProjectClaim,
} from "./overbookingBoard";
import type { ScheduleFlagInput } from "./scheduleBoard";

const DAY_MS = 86_400_000;

interface GearCell {
  /** True when the inputs for this cell were not read in full: no number below means anything. */
  unknown: boolean;
  free: number;
  held: number;
  pencilled: number;
  short: number;
  atRisk: number;
}

/** One job's claim on a model (the model-day sheet lists the ones active on its day). */
interface GearClaim {
  projectId: string;
  projectNumber: string;
  name: string;
  status: string;
  projectManagerId: string | null;
  layer: "hard" | "pencilled";
  qty: number;
  startMs: number;
  endMs: number;
}

/** One stretch the board's sweep found over stock, and which jobs do not fit in it (`qty` is each one's own shortfall). */
interface GearSegment {
  startMs: number;
  endMs: number;
  over: { projectId: string; qty: number }[];
}

interface GearRow {
  modelId: string;
  name: string;
  categoryId: string | null;
  /** Active units owned, and how many are out of service (maintenance, lost, retired, sold). */
  owned: number;
  inService: number;
  /** True when the model's stock could not be read in full (or the model was not loaded): every cell is unknown. */
  unknown: boolean;
  cells: GearCell[];
  claims: GearClaim[];
  /** The board's hard and pencilled conflict stretches for this model, for the sheet's `Sub-hire` and `would be short`. */
  shortSegments: GearSegment[];
  riskSegments: GearSegment[];
}

const UNKNOWN_CELL: GearCell = { unknown: true, free: 0, held: 0, pencilled: 0, short: 0, atRisk: 0 };

/** The PEAK concurrent demand of one layer inside `[from, to]`: the sum at the interval's start and at every claim start inside it. */
function peak(claims: GearClaim[], layer: GearClaim["layer"], from: number, to: number): number {
  const mine = claims.filter((c) => c.layer === layer && c.startMs <= to && c.endMs >= from);
  const times = [from, ...mine.map((c) => c.startMs).filter((t) => t > from)];
  return Math.max(0, ...times.map((t) => mine.filter((c) => c.startMs <= t && c.endMs >= t).reduce((n, c) => n + c.qty, 0)));
}

/** The largest total overage among the stretches that overlap `[from, to]`. */
function peakOver(segs: GearSegment[], from: number, to: number): number {
  return Math.max(0, ...segs.filter((s) => s.startMs <= to && s.endMs >= from).map((s) => s.over.reduce((n, o) => n + o.qty, 0)));
}

function toSegments(segs: ConflictSegment[]): GearSegment[] {
  return segs.map((s) => ({ startMs: s.start, endMs: s.end, over: [...s.overByProject].map(([projectId, qty]) => ({ projectId, qty })) }));
}

/** The days an unread alive job covers: no model's number on those days can be trusted. */
function unreadDays(projects: BoardProject[], unread: ReadonlySet<string>, dayStarts: number[]): Set<number> {
  const out = new Set<number>();
  for (const p of projects) {
    if (!unread.has(p.id)) continue;
    const { start, end } = getProjectWindow(p);
    for (const d of dayStarts) if (start != null && end != null && start <= d + DAY_MS - 1 && end >= d) out.add(d);
  }
  return out;
}

type ClaimBook = Map<string, ProjectClaim>;
type GearProject = BoardProject & { projectManagerId?: string | null };
type GearModel = { id: string; name: string; categoryId?: string | null; assetType?: string | null };

function claimRow(layer: GearClaim["layer"], pid: string, c: { qty: number; start: number; end: number }, p: GearProject | undefined): GearClaim {
  return {
    projectId: pid, projectNumber: p?.projectNumber ?? "", name: p?.name ?? "", status: p?.status ?? "",
    projectManagerId: p?.projectManagerId ?? null, layer, qty: c.qty, startMs: c.start, endMs: c.end,
  };
}

function claimsOf(agg: { hardClaims: ClaimBook; pencilledClaims: ClaimBook }, byId: Map<string, GearProject>): GearClaim[] {
  const hard = [...agg.hardClaims].map(([pid, c]) => claimRow("hard", pid, c, byId.get(pid)));
  const pencilled = [...agg.pencilledClaims].map(([pid, c]) => claimRow("pencilled", pid, c, byId.get(pid)));
  return [...hard, ...pencilled].sort((a, b) => a.startMs - b.startMs || a.projectNumber.localeCompare(b.projectNumber, undefined, { numeric: true }));
}

interface RowContext {
  models: Map<string, GearModel>;
  assets: ReturnType<typeof groupByModelId<ScheduleFlagInput["assets"][number]>>;
  bulks: ReturnType<typeof groupByModelId<ScheduleFlagInput["bulkAssets"][number]>>;
  unknownModelIds: ReadonlySet<string>;
  claimsComplete: boolean;
  blind: Set<number>;
  byId: Map<string, GearProject>;
  dayStarts: number[];
}

/** A model's stock, or null when it could not be read in full (not loaded, over the unit cap, or the alive scan was cut). */
function stockOf(modelId: string, c: RowContext) {
  const m = c.models.get(modelId);
  if (!m || c.unknownModelIds.has(modelId) || !c.claimsComplete) return null;
  return stockBreakdownForModel(m, c.assets.get(modelId) ?? [], c.bulks.get(modelId) ?? []);
}

interface DayInput {
  effective: number;
  claims: GearClaim[];
  short: GearSegment[];
  risk: GearSegment[];
}

/** One day of one model, read off the claims and the board's sweep over the day's interval. */
function cellOf(d: DayInput, dayStart: number): GearCell {
  const to = dayStart + DAY_MS - 1;
  const held = peak(d.claims, "hard", dayStart, to);
  return {
    unknown: false,
    free: d.effective - held,
    held,
    pencilled: peak(d.claims, "pencilled", dayStart, to),
    short: peakOver(d.short, dayStart, to),
    atRisk: peakOver(d.risk, dayStart, to),
  };
}

/** The per-day inputs for a model whose stock was read: the claims and the board's sweep over them. */
function dayInputOf(stock: { effectiveStock: number }, claims: GearClaim[], agg: { hardClaims: ClaimBook; pencilledClaims: ClaimBook }): DayInput {
  const sweep = sweepModelConflicts(agg.hardClaims, agg.pencilledClaims, stock.effectiveStock);
  return { effective: stock.effectiveStock, claims, short: toSegments(sweep.hardSegments), risk: toSegments(sweep.pencilledSegments) };
}

/** A cell per day: unknown when the model's stock was not read, or an unread job covers the day. */
function cellsOf(day: DayInput | null, c: RowContext): GearCell[] {
  return c.dayStarts.map((d) => (day && !c.blind.has(d) ? cellOf(day, d) : UNKNOWN_CELL));
}

/** The row's identity and stock: a model that was not loaded is named neutrally, one whose stock was not read is unknown. */
function headOf(m: GearModel | undefined, stock: ReturnType<typeof stockOf>) {
  return {
    name: m?.name ?? "Model not loaded",
    categoryId: m?.categoryId ?? null,
    owned: stock?.totalStock ?? 0,
    inService: stock?.unavailable ?? 0,
    unknown: !stock,
  };
}

/** One model's row: its stock (null when it could not be read in full), a cell per day, and its claims. */
function rowFor(modelId: string, agg: { hardClaims: ClaimBook; pencilledClaims: ClaimBook }, c: RowContext): GearRow {
  const stock = stockOf(modelId, c);
  const claims = claimsOf(agg, c.byId);
  const day = stock ? dayInputOf(stock, claims, agg) : null;
  return {
    modelId, ...headOf(c.models.get(modelId), stock),
    cells: cellsOf(day, c), claims,
    shortSegments: day ? day.short : [],
    riskSegments: day ? day.risk : [],
  };
}

/** True when a row has a claim inside the days the view shows (the claim range is wider, so a model that only the widening reached has no row). */
function inView(r: GearRow, dayStarts: number[]): boolean {
  const from = dayStarts[0];
  const to = dayStarts[dayStarts.length - 1] + DAY_MS - 1;
  return r.claims.some((c) => c.startMs <= to && c.endMs >= from);
}

/** One row per model that has a held or pencilled claim in the days shown, cells per day. */
export function deriveGearGrid(input: ScheduleFlagInput & { projects: GearProject[]; models: GearModel[] }, dayStarts: number[]): GearRow[] {
  const alive = candidateBoardProjects(input.projects, input.range) as GearProject[];
  const byId = new Map(alive.map((p) => [p.id, p]));
  const byModel = aggregateDemandByModel(input.range, input.lines, byId);
  const ctx: RowContext = {
    models: new Map(input.models.map((m) => [m.id, m])),
    assets: groupByModelId(input.assets),
    bulks: groupByModelId(input.bulkAssets),
    unknownModelIds: input.unknownModelIds,
    claimsComplete: input.claimsComplete,
    blind: unreadDays(alive, input.unreadProjectIds, dayStarts),
    byId,
    dayStarts,
  };
  return [...byModel]
    .map(([modelId, agg]) => rowFor(modelId, agg, ctx))
    .filter((r) => inView(r, dayStarts))
    .sort((a, b) => a.name.localeCompare(b.name));
}
