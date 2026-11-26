/**
 * The Schedule's derived facts (UX Phase 18, spec §9o). PURE: no ctx, no
 * clock. A job's `clash` / `would clash` is read off the SAME claim math the
 * Overbookings board and the confirm gate run (`aggregateDemandByModel` →
 * `sweepModelConflicts`, FCFS, hard before pencilled), never a second formula.
 * Demand is `stockBackedQty` (via the shared demand predicate); stock is
 * `effectiveStockForModel` (`availabilityCore`).
 *
 * ONE rule for the words:
 * - `clash`       — a job that HOLDS its gear (confirmed or later) has a claim
 *                   that does not fit the stock on some day (a hard row).
 * - `wouldClash`  — a job that does NOT hold its gear (pencilled) has a claim
 *                   that would not fit if it were confirmed (a pencilled row).
 *                   A held job's own optional line never prints either word.
 * - `unknown`     — the check could not run for this job (its lines, or a
 *                   model's stock, were beyond the read budget). Never "none".
 */
import { isConfirmedOrLater } from "./availabilityCore";
import {
  aggregateDemandByModel,
  candidateBoardProjects,
  effectiveStockForModel,
  groupByModelId,
  isRelevantDemandLine,
  sweepModelConflicts,
  type BoardAsset,
  type BoardBulkAsset,
  type BoardLineItem,
  type BoardModel,
  type BoardProject,
  type DateRange,
  type ProjectClaim,
} from "./overbookingBoard";
import { stockBackedQty } from "./stockBackedQty";

export type ClashState = "clash" | "wouldClash" | "none" | "unknown";

export interface ClashRow {
  layer: "hard" | "pencilled";
  modelId: string;
  modelName: string;
  /** This job's own shortfall on the model over the run. */
  short: number;
  /** The run, epoch ms (the first and last instant the shortfall holds). */
  startMs: number;
  endMs: number;
  /** The other jobs holding or pencilling the same model over the run (hard first, at most 5). */
  with: { id: string; projectNumber: string }[];
}

export interface JobFacts {
  state: ClashState;
  rows: ClashRow[];
  /** Distinct models, stock-demand lines and stock-backed units; null when the job's lines were not read. */
  modelCount: number | null;
  /** The distinct models the job holds or pencils (the Model filter reads these). */
  modelIds: string[];
  lineCount: number | null;
  unitCount: number | null;
}

export interface ScheduleFlagInput {
  range: DateRange;
  /** Every project the schedule read (alive or not); only the alive ones whose window overlaps the range are checked. */
  projects: BoardProject[];
  /** Live lines of the projects whose lines were read in full. */
  lines: BoardLineItem[];
  /** Alive projects whose lines were NOT read in full. */
  unreadProjectIds: ReadonlySet<string>;
  models: BoardModel[];
  assets: BoardAsset[];
  bulkAssets: BoardBulkAsset[];
  /** Models whose stock could not be read in full. */
  unknownModelIds: ReadonlySet<string>;
}

type Ref = { id: string; projectNumber: string };

function others(layers: Map<string, ProjectClaim>[], self: string, seg: { start: number; end: number }, ref: Map<string, Ref>): Ref[] {
  const out: Ref[] = [];
  for (const layer of layers) {
    for (const [pid, c] of layer) {
      if (pid === self || c.start > seg.end || c.end < seg.start) continue;
      if (out.some((o) => o.id === pid)) continue;
      out.push({ id: pid, projectNumber: ref.get(pid)?.projectNumber ?? "" });
    }
  }
  return out.slice(0, 5);
}

/** Clash rows per project id, from the shared claim sweep. */
function clashRows(input: ScheduleFlagInput, projectById: Map<string, BoardProject>): Map<string, ClashRow[]> {
  const modelById = new Map(input.models.map((m) => [m.id, m]));
  const assetMap = groupByModelId(input.assets);
  const bulkMap = groupByModelId(input.bulkAssets);
  const byModel = aggregateDemandByModel(input.range, input.lines, projectById);
  const rows = new Map<string, ClashRow[]>();
  for (const [modelId, agg] of byModel) {
    const m = modelById.get(modelId);
    if (!m || input.unknownModelIds.has(modelId)) continue;
    const stock = effectiveStockForModel(m, assetMap.get(modelId) ?? [], bulkMap.get(modelId) ?? []);
    const { hardSegments, pencilledSegments } = sweepModelConflicts(agg.hardClaims, agg.pencilledClaims, stock);
    const emit = (layer: ClashRow["layer"], segs: typeof hardSegments) => {
      for (const seg of segs) {
        for (const [pid, over] of seg.overByProject) {
          const p = projectById.get(pid);
          if (!p) continue;
          // A held job's own optional line never prints a word (one rule, above).
          if (layer === "pencilled" && isConfirmedOrLater(p.status)) continue;
          const row: ClashRow = {
            layer, modelId, modelName: m.name, short: over, startMs: seg.start, endMs: seg.end,
            with: others([agg.hardClaims, agg.pencilledClaims], pid, seg, projectById),
          };
          rows.set(pid, [...(rows.get(pid) ?? []), row]);
        }
      }
    };
    emit("hard", hardSegments);
    emit("pencilled", pencilledSegments);
  }
  return rows;
}

/** Facts per project id, for every project in `input.projects`. */
export function deriveJobFacts(input: ScheduleFlagInput): Map<string, JobFacts> {
  const alive = candidateBoardProjects(input.projects, input.range);
  const projectById = new Map(alive.map((p) => [p.id, p]));
  const modelById = new Map(input.models.map((m) => [m.id, m]));
  const rows = clashRows(input, projectById);

  const out = new Map<string, JobFacts>();
  for (const p of input.projects) {
    const mine = rows.get(p.id) ?? [];
    const unread = input.unreadProjectIds.has(p.id);
    const own = unread ? [] : input.lines.filter((l) => l.projectId === p.id && isRelevantDemandLine(l, projectById));
    const touchesUnknown = own.some((l) => !modelById.has(l.modelId!) || input.unknownModelIds.has(l.modelId!));
    let state: ClashState = "none";
    if (!projectById.has(p.id)) state = "none";
    else if (mine.some((r) => r.layer === "hard")) state = "clash";
    else if (mine.length > 0) state = "wouldClash";
    else if (unread || touchesUnknown) state = "unknown";
    const read = !unread && projectById.has(p.id);
    out.set(p.id, {
      state,
      rows: mine,
      modelCount: read ? new Set(own.map((l) => l.modelId)).size : null,
      modelIds: read ? [...new Set(own.map((l) => l.modelId!))] : [],
      lineCount: read ? own.length : null,
      unitCount: read ? own.reduce((n, l) => n + stockBackedQty(l), 0) : null,
    });
  }
  return out;
}
