/**
 * The Schedule's Gear grid (UX Phase 18, D81, spec §9o.4): the free count per
 * model per day. PURE: no ctx, no clock. It is NOT a second availability
 * formula. Stock is `stockBreakdownForModel` (`availabilityCore`'s
 * `computeStockBreakdown`), demand is the Overbookings board's own per-project
 * claims (`aggregateDemandByModel`: `stockBackedQty`, sub-hire / SALE / cancelled
 * lines out, held statuses from `HARD_PROJECT_STATUSES`), and a day just sums
 * the claims active on it:
 *
 *   free      = effective − held
 *   short     = max(0, held − effective)                  (a hard shortfall)
 *   atRisk    = max(0, pencilled − max(0, effective − held))
 *
 * `atRisk` is exactly the board's pencilled FCFS overage summed over claims
 * (`allocateFifo`'s overBys telescope to this), so the grid and the clash words
 * can never disagree. A cell whose inputs were not read in full is `unknown`
 * and carries no number: the whole model when its stock was beyond the budget,
 * every model on the days an unread job covers, everything when the alive scan
 * was cut.
 */
import { getProjectWindow } from "./projectWindow";
import {
  aggregateDemandByModel,
  candidateBoardProjects,
  groupByModelId,
  stockBreakdownForModel,
  type BoardProject,
} from "./overbookingBoard";
import type { ScheduleFlagInput } from "./scheduleBoard";

const DAY_MS = 86_400_000;

export interface GearCell {
  /** True when the inputs for this cell were not read in full: no number below means anything. */
  unknown: boolean;
  free: number;
  held: number;
  pencilled: number;
  short: number;
  atRisk: number;
}

/** One job's claim on a model (the model-day sheet lists the ones active on its day). */
export interface GearClaim {
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

export interface GearRow {
  modelId: string;
  name: string;
  categoryId: string | null;
  /** Active units owned, and how many are out of service (maintenance, lost, retired, sold). */
  owned: number;
  inService: number;
  /** True when the model's stock could not be read in full: every cell is unknown. */
  unknown: boolean;
  cells: GearCell[];
  claims: GearClaim[];
}

const UNKNOWN_CELL: GearCell = { unknown: true, free: 0, held: 0, pencilled: 0, short: 0, atRisk: 0 };

/** The sum of the claims that cover a day, split by layer. */
function demandOn(claims: GearClaim[], dayStart: number): { held: number; pencilled: number } {
  const dayEnd = dayStart + DAY_MS - 1;
  let held = 0;
  let pencilled = 0;
  for (const c of claims) {
    if (c.startMs > dayEnd || c.endMs < dayStart) continue;
    if (c.layer === "hard") held += c.qty;
    else pencilled += c.qty;
  }
  return { held, pencilled };
}

/** One day of one model: the three numbers above from the day's demand and the model's effective stock. */
export function cellFor(effective: number, held: number, pencilled: number): GearCell {
  return {
    unknown: false,
    free: effective - held,
    held,
    pencilled,
    short: Math.max(0, held - effective),
    atRisk: Math.max(0, pencilled - Math.max(0, effective - held)),
  };
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

function claimsOf(agg: { hardClaims: Map<string, { qty: number; start: number; end: number }>; pencilledClaims: Map<string, { qty: number; start: number; end: number }> }, byId: Map<string, BoardProject & { projectManagerId?: string | null }>): GearClaim[] {
  const out: GearClaim[] = [];
  for (const [layer, claims] of [["hard", agg.hardClaims], ["pencilled", agg.pencilledClaims]] as const) {
    for (const [pid, c] of claims) {
      const p = byId.get(pid);
      out.push({
        projectId: pid, projectNumber: p?.projectNumber ?? "", name: p?.name ?? "", status: p?.status ?? "",
        projectManagerId: p?.projectManagerId ?? null, layer, qty: c.qty, startMs: c.start, endMs: c.end,
      });
    }
  }
  return out.sort((a, b) => a.startMs - b.startMs || a.projectNumber.localeCompare(b.projectNumber, undefined, { numeric: true }));
}

/** One row per model that has a held or pencilled claim in the range, cells per day. */
export function deriveGearGrid(input: ScheduleFlagInput & { projects: (BoardProject & { projectManagerId?: string | null })[]; models: { id: string; name: string; categoryId?: string | null; assetType?: string | null }[] }, dayStarts: number[]): GearRow[] {
  const alive = candidateBoardProjects(input.projects, input.range) as (BoardProject & { projectManagerId?: string | null })[];
  const byId = new Map(alive.map((p) => [p.id, p]));
  const byModel = aggregateDemandByModel(input.range, input.lines, byId);
  const modelById = new Map(input.models.map((m) => [m.id, m]));
  const assetMap = groupByModelId(input.assets);
  const bulkMap = groupByModelId(input.bulkAssets);
  const blind = unreadDays(alive, input.unreadProjectIds, dayStarts);

  const rows: GearRow[] = [];
  for (const [modelId, agg] of byModel) {
    const m = modelById.get(modelId);
    const unknown = !m || input.unknownModelIds.has(modelId) || !input.claimsComplete;
    const stock = m && !unknown ? stockBreakdownForModel(m, assetMap.get(modelId) ?? [], bulkMap.get(modelId) ?? []) : null;
    const claims = claimsOf(agg, byId);
    const cells = dayStarts.map((d) => {
      if (!stock || blind.has(d)) return UNKNOWN_CELL;
      const { held, pencilled } = demandOn(claims, d);
      return cellFor(stock.effectiveStock, held, pencilled);
    });
    rows.push({
      modelId, name: m?.name ?? "Unknown model", categoryId: (m as { categoryId?: string | null } | undefined)?.categoryId ?? null,
      owned: stock?.totalStock ?? 0, inService: stock?.unavailable ?? 0, unknown: !stock, cells, claims,
    });
  }
  return rows.sort((a, b) => a.name.localeCompare(b.name));
}
