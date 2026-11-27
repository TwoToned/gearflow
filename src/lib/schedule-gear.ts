/**
 * The Schedule's Gear view facts (UX Phase 18, D81, spec §9o.4). Pure: no React,
 * no router. The numbers are decided on the server (`convex/lib/gearGrid.ts`,
 * the overbooking claim math); this module only words, filters and counts what
 * `scheduleBoard.grid` returned, so a cell, a strip count and a day header
 * share ONE definition.
 */
import type { FunctionReturnType } from "convex/server";

import type { api } from "../../convex/_generated/api";
import { toCsv } from "@/lib/csv";
import { keyOfMs } from "@/lib/crew-planner";
import type { ScheduleFilters } from "@/lib/schedule";
import type { ColorIntent } from "@/lib/status-colors";

export type GearData = FunctionReturnType<typeof api.scheduleBoard.grid>;
export type GearRow = GearData["rows"][number];
export type GearCell = GearRow["cells"][number];
export type GearClaim = GearRow["claims"][number];

const DAY_MS = 86_400_000;

export interface CellWord {
  /** The main text of the cell: `short 2`, `7`, `—`. */
  text: string;
  /** Under it: `held 10`, `pencilled −2`, `not checked`. */
  sub: string | null;
  intent: ColorIntent | null;
  /** True when nothing holds or pencils the model that day (printed faint). */
  quiet: boolean;
  kind: "unknown" | "short" | "risk" | "free";
}

/**
 * What a cell prints (§9o.4): a shortfall is a red flag-word `short 2` with
 * `held 10` under it; a pencilled risk is the free number in amber with
 * `pencilled −2` (confirming would take it below zero); a plain day is just the
 * number. A cell the read could not cover in full prints no number at all.
 */
export function cellWord(c: GearCell): CellWord {
  if (c.unknown) return { text: "—", sub: "not checked", intent: "neutral", quiet: false, kind: "unknown" };
  if (c.short > 0) return { text: `short ${c.short}`, sub: `held ${c.held}`, intent: "error", quiet: false, kind: "short" };
  if (c.atRisk > 0) return { text: String(c.free), sub: `pencilled −${c.atRisk}`, intent: "warning", quiet: false, kind: "risk" };
  return { text: String(c.free), sub: null, intent: null, quiet: c.held === 0 && c.pencilled === 0, kind: "free" };
}

/** Month zoom shrinks a cell to the number, `−2` red for a shortfall (the sub-line is dropped). */
export function slimCellText(c: GearCell): string {
  if (c.unknown) return "—";
  return c.short > 0 ? `−${c.short}` : String(c.free);
}

const rowIsShort = (r: GearRow): boolean => r.cells.some((c) => !c.unknown && c.short > 0);
const rowIsAtRisk = (r: GearRow): boolean => r.cells.some((c) => !c.unknown && c.atRisk > 0);

export interface GearStrip {
  all: number;
  short: number;
  atRisk: number;
}

/** `All · Short · At risk`: counts of models, following the range and the filters (not the strip). */
export function gearStrip(rows: GearRow[]): GearStrip {
  return { all: rows.length, short: rows.filter(rowIsShort).length, atRisk: rows.filter(rowIsAtRisk).length };
}

const anyClaim = (r: GearRow, ok: (c: GearClaim) => boolean): boolean => r.claims.some(ok);

/** Search: the model's name, or the number or name of a job that holds or pencils it. */
function matchesQuery(r: GearRow, q: string): boolean {
  const needle = q.trim().toLowerCase();
  if (!needle) return true;
  return r.name.toLowerCase().includes(needle) || anyClaim(r, (c) => `${c.projectNumber} ${c.name}`.toLowerCase().includes(needle));
}

function matchesGear(r: GearRow, f: ScheduleFilters): boolean {
  if (f.model.length && !f.model.includes(r.modelId)) return false;
  if (f.category.length && !f.category.includes(r.categoryId ?? "")) return false;
  // Status and PM narrow the rows to models those jobs hold; the numbers stay the whole org's (§9o.2).
  if (f.status.length && !anyClaim(r, (c) => f.status.includes(c.status))) return false;
  if (f.pm.length && !anyClaim(r, (c) => !!c.projectManagerId && f.pm.includes(c.projectManagerId))) return false;
  return matchesQuery(r, f.q);
}

/** The rows the view draws: filters + search, then the strip segment. */
export function shownGearRows(rows: GearRow[], f: ScheduleFilters): { filtered: GearRow[]; shown: GearRow[] } {
  const filtered = rows.filter((r) => matchesGear(r, f));
  if (f.seg === "short") return { filtered, shown: filtered.filter(rowIsShort) };
  if (f.seg === "atrisk") return { filtered, shown: filtered.filter(rowIsAtRisk) };
  return { filtered, shown: filtered };
}

/** `1 short` over a day column: how many models are short that day. */
export function shortOnDay(rows: GearRow[], dayIndex: number): number {
  return rows.filter((r) => !r.cells[dayIndex].unknown && r.cells[dayIndex].short > 0).length;
}

export interface GearGroup {
  key: string;
  label: string;
  rows: GearRow[];
}

/** Models grouped by category (`Lighting 5`), groups by name, `Uncategorised` last. */
export function groupByCategory(rows: GearRow[], categoryName: (id: string) => string | null): GearGroup[] {
  const groups = new Map<string, GearGroup>();
  for (const r of rows) {
    const label = (r.categoryId && categoryName(r.categoryId)) || "Uncategorised";
    const g = groups.get(label) ?? { key: label, label, rows: [] };
    g.rows.push(r);
    groups.set(label, g);
  }
  return [...groups.values()].sort((a, b) => (a.label === "Uncategorised" ? 1 : b.label === "Uncategorised" ? -1 : a.label.localeCompare(b.label)));
}

/** The claims that cover one day: held first, then pencilled (the sheet's `Held by` and `Pencilled, holds nothing`). */
export function claimsOnDay(row: GearRow, dayStart: number): { held: GearClaim[]; pencilled: GearClaim[] } {
  const on = row.claims.filter((c) => c.startMs <= dayStart + DAY_MS - 1 && c.endMs >= dayStart);
  return { held: on.filter((c) => c.layer === "hard"), pencilled: on.filter((c) => c.layer === "pencilled") };
}

type GearSegment = GearRow["shortSegments"][number];

/** Each job the board's sweep leaves short in the stretches that touch the day, with its largest shortfall there. */
function overOn(segs: GearSegment[], dayStart: number): { projectId: string; qty: number }[] {
  const to = dayStart + DAY_MS - 1;
  const by = new Map<string, number>();
  for (const s of segs) {
    if (s.startMs > to || s.endMs < dayStart) continue;
    for (const o of s.over) by.set(o.projectId, Math.max(by.get(o.projectId) ?? 0, o.qty));
  }
  return [...by].map(([projectId, qty]) => ({ projectId, qty }));
}

/** The jobs that do not fit on a hard-short day (exactly the ones the board lists), each with its own shortfall. */
export const shortfallsOn = (row: GearRow, dayStart: number) => overOn(row.shortSegments, dayStart);

/** The pencilled jobs that would not fit on a day if confirmed (exactly the ones the board lists as pencilled collisions). */
export const risksOn = (row: GearRow, dayStart: number) => overOn(row.riskSegments, dayStart);

/** A cell by model and day key; null when the model or the day is not in the grid. */
export function cellAt(data: GearData, modelId: string, day: string): { row: GearRow; cell: GearCell; dayStart: number } | null {
  const row = data.rows.find((r) => r.modelId === modelId);
  const i = data.dayStarts.findIndex((d) => keyOfMs(d) === day);
  return row && i >= 0 ? { row, cell: row.cells[i], dayStart: data.dayStarts[i] } : null;
}

/** The grid as CSV (through `toCsv`, the formula guard): one row per model, one column per day; a cell that was not checked is blank. */
export function gearCsv(data: GearData, rows: GearRow[]): string {
  const head = ["Model", "Owned", "In service", ...data.dayStarts.map((d) => keyOfMs(d))];
  const body = rows.map((r) => [r.name, String(r.owned), String(r.inService), ...r.cells.map((c) => (c.unknown ? "" : String(c.free)))]);
  return toCsv(head, body);
}
