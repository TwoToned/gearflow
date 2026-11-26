/**
 * The Schedule's derived facts (UX Phase 18, spec §9o). Pure: no React, no
 * router, no clock. The timeline, the strip, the day chips, the sheets and the
 * phone day list all read these, so a count, a word or a bar has ONE
 * definition. The clash words themselves are decided on the server
 * (`convex/lib/scheduleBoard.ts`, the overbooking claim math); this module only
 * places and counts what that read returned.
 *
 * Days are `YYYY-MM-DD` keys in UTC, like the crew planner (a rental date is
 * stored at UTC midnight of its day). Only "today" is the viewer's local day.
 */
import type { FunctionReturnType } from "convex/server";

import type { api } from "../../convex/_generated/api";
import { addDays, keyOfMs, weekOf, weekDays, defaultWeek, type WeekStart } from "@/lib/crew-planner";
import type { ColorIntent } from "@/lib/status-colors";

export type ScheduleData = FunctionReturnType<typeof api.scheduleBoard.jobs>;
export type ScheduleJob = ScheduleData["jobs"][number];
export type ScheduleZoom = "week" | "month";

const DAY_MS = 86_400_000;
const msOfKey = (key: string): number => Date.parse(`${key}T00:00:00.000Z`);

// ─── The range ───────────────────────────────────────────────────────────────

export interface ScheduleRange {
  zoom: ScheduleZoom;
  /** First day shown (the week's first day, or the 1st of the month). */
  start: string;
  days: string[];
}

/** The first of the month `key` falls in. */
export const monthStart = (key: string): string => `${key.slice(0, 7)}-01`;

function monthDays(first: string): string[] {
  const out: string[] = [];
  for (let d = first; d.slice(0, 7) === first.slice(0, 7); d = addDays(d, 1)) out.push(d);
  return out;
}

/** The range an anchor day opens: its week by the org's week start, or its real calendar month (D83). */
export function scheduleRange(zoom: ScheduleZoom, anchor: string, startsOn: WeekStart): ScheduleRange {
  if (zoom === "month") {
    const start = monthStart(anchor);
    return { zoom, start, days: monthDays(start) };
  }
  const start = weekOf(anchor, startsOn);
  return { zoom, start, days: weekDays(start) };
}

/** Where the page opens: this week (the next working week on a weekend, like the crew planner) or this month. */
export function defaultAnchor(zoom: ScheduleZoom, todayKey: string, startsOn: WeekStart): string {
  return zoom === "month" ? monthStart(todayKey) : defaultWeek(todayKey, startsOn);
}

/** `‹ ›` : a week steps 7 days, a month steps a calendar month. `0` is Today. */
export function stepRange(range: ScheduleRange, n: number, todayKey: string, startsOn: WeekStart): string {
  if (n === 0) return defaultAnchor(range.zoom, todayKey, startsOn);
  if (range.zoom === "week") return addDays(range.start, 7 * n);
  const [y, m] = range.start.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return d.toISOString().slice(0, 10);
}

/** The query window for a range: first day 00:00 UTC to the last day 23:59:59.999 UTC (stable args, a subscription key). */
export function rangeQueryMs(range: ScheduleRange): { startMs: number; endMs: number } {
  const startMs = msOfKey(range.start);
  return { startMs, endMs: msOfKey(range.days[range.days.length - 1]) + DAY_MS - 1 };
}

// ─── A job on the days ───────────────────────────────────────────────────────

export const jobFrom = (j: ScheduleJob): string => keyOfMs(j.rentalStart);
export const jobTo = (j: ScheduleJob): string => keyOfMs(j.rentalEnd);

export const jobOnDay = (j: ScheduleJob, day: string): boolean => jobFrom(j) <= day && day <= jobTo(j);

/** Jobs on `day`, in the timeline's order. */
export const jobsOnDay = (jobs: ScheduleJob[], day: string): ScheduleJob[] => jobs.filter((j) => jobOnDay(j, day)).sort(byStart);

export function byStart(a: ScheduleJob, b: ScheduleJob): number {
  return a.rentalStart - b.rentalStart || a.projectNumber.localeCompare(b.projectNumber, undefined, { numeric: true });
}

export interface Bar {
  /** 0-based column of the first day in view, and how many columns it spans. */
  col: number;
  span: number;
  /** False when the job continues past that edge of the range (a square edge). */
  capStart: boolean;
  capEnd: boolean;
}

/** One bar per job across its rental window, clamped to the days shown; null when it is outside them. */
export function barFor(j: ScheduleJob, days: string[]): Bar | null {
  const first = days[0];
  const last = days[days.length - 1];
  const from = jobFrom(j);
  const to = jobTo(j);
  if (to < first || from > last) return null;
  const a = from < first ? first : from;
  const b = to > last ? last : to;
  const col = days.indexOf(a);
  return { col, span: days.indexOf(b) - col + 1, capStart: from >= first, capEnd: to <= last };
}

// ─── What a job is ───────────────────────────────────────────────────────────

const PENCILLED = new Set(["ENQUIRY", "QUOTING", "QUOTED"]);

/** Held (holds its gear), pencilled (holds nothing yet) or done (returned / completed / invoiced). */
export function jobHold(j: ScheduleJob): "held" | "pencilled" | "done" {
  if (j.holds) return "held";
  return PENCILLED.has(j.status) ? "pencilled" : "done";
}

export interface ClashWord {
  label: string;
  intent: ColorIntent;
}

/**
 * The word a job prints beside its name, or null. `clash` (a held job over
 * stock) is red, `would clash` (a pencilled job that would overbook if
 * confirmed) amber, `not checked` muted (the server could not run the check:
 * never read as "no clash").
 */
export function clashWord(j: ScheduleJob): ClashWord | null {
  if (j.clash === "clash") return { label: "clash", intent: "error" };
  if (j.clash === "wouldClash") return { label: "would clash", intent: "warning" };
  if (j.clash === "unknown") return { label: "not checked", intent: "neutral" };
  return null;
}

// ─── Filters, strip, search ──────────────────────────────────────────────────

export interface ScheduleFilters {
  seg: string;
  q: string;
  status: string[];
  pm: string[];
  category: string[];
  model: string[];
}

export interface FilterContext {
  /** Names to search by (job number, name, client are on the job; model names come from here). */
  modelName: (id: string) => string;
  modelCategory: (id: string) => string | null;
}

function matchesSeg(j: ScheduleJob, seg: string): boolean {
  if (seg === "confirmed") return jobHold(j) === "held";
  if (seg === "pencilled") return jobHold(j) === "pencilled";
  if (seg === "clashes") return j.clash === "clash";
  return true;
}

function matchesSearch(j: ScheduleJob, q: string, ctx: FilterContext): boolean {
  const needle = q.trim().toLowerCase();
  if (!needle) return true;
  const hay = [j.projectNumber, j.name, j.clientName ?? "", ...j.modelIds.map(ctx.modelName)];
  return hay.some((h) => h.toLowerCase().includes(needle));
}

/** Everything but the strip: filters and search, the counts the strip shows follow these. */
export function matchesFilters(j: ScheduleJob, f: ScheduleFilters, ctx: FilterContext): boolean {
  if (f.status.length && !f.status.includes(j.status)) return false;
  if (f.pm.length && !(j.projectManagerId && f.pm.includes(j.projectManagerId))) return false;
  if (f.model.length && !j.modelIds.some((m) => f.model.includes(m))) return false;
  if (f.category.length && !j.modelIds.some((m) => f.category.includes(ctx.modelCategory(m) ?? ""))) return false;
  return matchesSearch(j, f.q, ctx);
}

export interface StripCounts {
  all: number;
  confirmed: number;
  pencilled: number;
  clashes: number;
}

/** `All · Confirmed · Pencilled · Clashes`, over the jobs that pass the filters (not the strip). */
export function stripCounts(jobs: ScheduleJob[]): StripCounts {
  return {
    all: jobs.length,
    confirmed: jobs.filter((j) => matchesSeg(j, "confirmed")).length,
    pencilled: jobs.filter((j) => matchesSeg(j, "pencilled")).length,
    clashes: jobs.filter((j) => matchesSeg(j, "clashes")).length,
  };
}

/** The jobs the view draws: filters + search, then the strip segment. */
export function shownJobs(jobs: ScheduleJob[], f: ScheduleFilters, ctx: FilterContext): { filtered: ScheduleJob[]; shown: ScheduleJob[] } {
  const filtered = jobs.filter((j) => matchesFilters(j, f, ctx)).sort(byStart);
  return { filtered, shown: filtered.filter((j) => matchesSeg(j, f.seg)) };
}

// ─── Day chips ───────────────────────────────────────────────────────────────

export interface DayFact {
  day: string;
  count: number;
  /** A held job on this day is over stock. */
  clash: boolean;
  /** A pencilled job on this day would overbook if confirmed. */
  wouldClash: boolean;
}

/** One fact per day: `3 jobs`, and whether a clash falls on it. Day headers, month dots and the phone chips read this. */
export function dayFacts(jobs: ScheduleJob[], days: string[]): DayFact[] {
  return days.map((day) => {
    const on = jobs.filter((j) => jobOnDay(j, day));
    const runs = (j: ScheduleJob) => j.clashes.some((r) => keyOfMs(r.startMs) <= day && day <= keyOfMs(r.endMs));
    return {
      day,
      count: on.length,
      clash: on.some((j) => j.clash === "clash" && runs(j)),
      wouldClash: on.some((j) => j.clash === "wouldClash" && runs(j)),
    };
  });
}

/** `1 job`, `3 jobs`. */
export const jobsWord = (n: number): string => `${n} ${n === 1 ? "job" : "jobs"}`;
