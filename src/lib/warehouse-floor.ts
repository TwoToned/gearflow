/**
 * The floor's pure client logic (spec §9c.2, §9c.3, D11): the URL contract,
 * the scope predicate, flags, the card's text and the column sort. The stage
 * itself comes from the server (`warehouseStage()`, convex/lib/warehouseStage.ts
 * — the ONE derivation); nothing here re-derives it.
 */
import { z } from "zod";
import { formatDateDayMonth, formatWeekday, formatWeekdayDayMonth } from "@/lib/formatters";
import type { FunctionReturnType } from "convex/server";
import type { api } from "../../convex/_generated/api";
import { FLOOR_STAGE_KEYS, type FloorStage } from "../../convex/lib/warehouseStage";

export type FloorJob = FunctionReturnType<typeof api.warehouseList.bundle>["projects"][number];

// ─── URL (D11) ─────────────────────────────────────────────────────────────

export const FLOOR_SCOPES = ["today", "week", "mine", "all"] as const;
export type FloorScope = (typeof FLOOR_SCOPES)[number];
const FLOOR_MODES = ["floor", "returning"] as const;
export type FloorMode = (typeof FLOOR_MODES)[number];

/** Each field falls back to its default on a bad value, never throws. */
const floorUrlSchema = z.object({
  mode: z.enum(FLOOR_MODES).catch("floor"),
  scope: z.enum(FLOOR_SCOPES).catch("week"),
  /** Phone only: desktop shows all five columns and ignores it (plan Q16). */
  stage: z.enum(FLOOR_STAGE_KEYS).nullable().catch(null),
  q: z.string().max(128).catch(""),
});
export type FloorUrlState = z.output<typeof floorUrlSchema>;

const FLOOR_URL_DEFAULTS: FloorUrlState = { mode: "floor", scope: "week", stage: null, q: "" };

export function parseFloorUrl(params: { get: (k: string) => string | null }): FloorUrlState {
  return floorUrlSchema.parse({
    mode: params.get("mode") ?? undefined,
    scope: params.get("scope") ?? undefined,
    stage: params.get("stage") ?? null,
    q: params.get("q") ?? "",
  });
}

/** Defaults are omitted, so the bare `/warehouse` stays the canonical link. */
export function serializeFloorUrl(s: FloorUrlState): string {
  const out = new URLSearchParams();
  if (s.mode !== FLOOR_URL_DEFAULTS.mode) out.set("mode", s.mode);
  if (s.scope !== FLOOR_URL_DEFAULTS.scope) out.set("scope", s.scope);
  if (s.stage) out.set("stage", s.stage);
  if (s.q) out.set("q", s.q);
  const qs = out.toString();
  return qs ? `?${qs}` : "";
}

// ─── Dates ─────────────────────────────────────────────────────────────────

const DAY = 86_400_000;

function startOfDay(ms: number): number {
  const d = new Date(ms);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

const windowStart = (j: FloorJob) => j.projectStartDate ?? j.rentalStartDate;
const windowEnd = (j: FloorJob) => j.projectEndDate ?? j.rentalEndDate;

/** When the gear leaves: the outbound truck's day, else the job start. */
function dispatchAt(j: FloorJob): number | null {
  return j.outbound?.date ?? windowStart(j) ?? null;
}

/** Whole days past the job's end, for gear still out. 0 = not overdue. */
export function overdueDays(j: FloorJob, now: number): number {
  const end = windowEnd(j);
  if (end == null || j.counts.out === 0) return 0;
  const days = Math.floor((startOfDay(now) - startOfDay(end)) / DAY);
  return Math.max(0, days);
}

// ─── Scope (§9c.2) ─────────────────────────────────────────────────────────

const PRE_OUT: readonly FloorStage[] = ["topick", "prepping", "ready"];

/**
 * Today = leaves within today + tomorrow (live's window), plus gear due back by
 * then and everything returning. This week = the same over 7 days. A job that
 * should already have left stays in view (its dispatch date is in the past).
 * Mine = I am the PM (no packer field yet). All = everything.
 */
export function inScope(j: FloorJob, scope: FloorScope, ctx: { now: number; userId?: string }): boolean {
  if (scope === "all") return true;
  if (scope === "mine") return !!ctx.userId && j.projectManagerId === ctx.userId;
  const horizon = startOfDay(ctx.now) + (scope === "today" ? 2 : 7) * DAY;
  if (j.stage === "returning") return true;
  if (j.stage === "out") return (windowEnd(j) ?? Infinity) < horizon;
  const at = dispatchAt(j);
  return PRE_OUT.includes(j.stage) && (at == null || at < horizon);
}

/** Text filter from the dock: number, name or client. */
export function matchesQuery(j: FloorJob, q: string): boolean {
  const s = q.trim().toLowerCase();
  if (!s) return true;
  return [j.projectNumber, j.name, j.client?.name ?? ""].some((v) => v.toLowerCase().includes(s));
}

// ─── Card text ─────────────────────────────────────────────────────────────

export type FloorFlag = { key: "overdue" | "pay" | "damaged" | "missing"; label: string; tone: "error" | "warning" };

/** v1 flags (plan Q3): overdue · awaiting payment · damaged · missing. */
export function floorFlags(j: FloorJob, now: number): FloorFlag[] {
  const flags: FloorFlag[] = [];
  const late = overdueDays(j, now);
  if (late > 0) flags.push({ key: "overdue", label: `${late}d overdue`, tone: "error" });
  if (j.status === "AWAITING_PAYMENT") flags.push({ key: "pay", label: "awaiting payment", tone: "warning" });
  if (j.counts.damaged > 0) flags.push({ key: "damaged", label: `${j.counts.damaged} damaged`, tone: "warning" });
  if (j.counts.missing > 0) flags.push({ key: "missing", label: `${j.counts.missing} missing`, tone: "error" });
  return flags;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** The progress line and its 4 px bar (0–1), by column. */
export function progressOf(j: FloorJob): { text: string; ratio: number } {
  const c = j.counts;
  if (j.stage === "returning") {
    const total = c.out + c.back;
    return { text: `${c.back} of ${plural(total, "item")} back`, ratio: total ? c.back / total : 0 };
  }
  if (j.stage === "out") return { text: `${plural(c.out, "item")} out`, ratio: 1 };
  const pick = c.linesToPick > 0 ? `${c.linesToPick} to pick` : "all picked";
  return { text: `${plural(c.lines, "line")} · ${pick}`, ratio: c.items ? c.packed / c.items : 1 };
}

/** `Truck Tue 06:30 · Van 2` · `Client collects Tue 10:00` · `Out Tue 12 Nov`. */
export function dispatchText(j: FloorJob): string | null {
  const o = j.outbound;
  if (!o) {
    const start = windowStart(j);
    return start == null ? null : `Out ${formatWeekdayDayMonth(start)}`;
  }
  const when = [o.date == null ? null : formatWeekday(o.date), o.time].filter(Boolean).join(" ");
  const head = o.kind === "client" ? "Client collects" : "Truck";
  return [`${head}${when ? ` ${when}` : ""}`, o.vehicle].filter(Boolean).join(" · ");
}

/** The head's `next out …`: the earliest job still to leave, from today on. */
export function nextOutText(jobs: readonly FloorJob[], now: number): string | null {
  const today = startOfDay(now);
  let next: FloorJob | null = null;
  for (const j of jobs) {
    const at = dispatchAt(j);
    if (!PRE_OUT.includes(j.stage) || at == null || at < today) continue;
    if (!next || at < (dispatchAt(next) ?? Infinity)) next = j;
  }
  return next ? `next out #${next.projectNumber} ${formatWeekday(dispatchAt(next))}` : null;
}

/** `client · 12 – 14 Nov` (the window falls back to rental dates when unset). */
export function windowText(j: FloorJob): string {
  const s = windowStart(j);
  const e = windowEnd(j);
  const range = s == null ? "" : e == null || startOfDay(e) === startOfDay(s) ? formatDateDayMonth(new Date(s)) : `${new Date(s).getDate()} – ${formatDateDayMonth(new Date(e))}`;
  return [j.client?.name, range].filter(Boolean).join(" · ");
}

// ─── Board ─────────────────────────────────────────────────────────────────

/** Jobs per column, each column sorted by when the gear leaves (or is due back). */
export function byStage(jobs: readonly FloorJob[]): Record<FloorStage, FloorJob[]> {
  const cols = Object.fromEntries(FLOOR_STAGE_KEYS.map((k) => [k, [] as FloorJob[]])) as Record<FloorStage, FloorJob[]>;
  for (const j of jobs) cols[j.stage].push(j);
  const key = (j: FloorJob) => (PRE_OUT.includes(j.stage) ? dispatchAt(j) : windowEnd(j)) ?? Infinity;
  for (const k of FLOOR_STAGE_KEYS) cols[k].sort((a, b) => key(a) - key(b));
  return cols;
}

/** A job can be closed out once its gear is back (server re-checks; cap 25). */
export function isCloseable(j: FloorJob): boolean {
  return j.status === "RETURNED";
}
