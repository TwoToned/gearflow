/**
 * The Schedule's URL state (UX Phase 18, spec §9o, D11): zoom, the date it
 * opens on, the strip, search and the Status / PM / Category / Model filters,
 * and which sheet is open (`day`, `job`) are query params, so Back, a pasted
 * link and the ⌘K "Schedule at <date>" row all land on the same view. The
 * strip, search and filters go through the shared list codec
 * (`list-url-state.ts`); the rest is ONE Zod schema here. Junk is dropped,
 * never thrown on. Params the page does not own are never touched.
 */
import { z } from "zod";

import { weekOf, type WeekStart } from "@/lib/crew-planner";
import type { ListUrlSpec } from "@/lib/list-url-state";
import { defaultAnchor, monthStart, type ScheduleZoom } from "@/lib/schedule";

export const SCHEDULE_SPEC: ListUrlSpec = {
  segments: ["all", "confirmed", "pencilled", "clashes"],
  filters: ["status", "pm", "category", "model"],
  sorts: ["start"],
  defaultSort: "start:asc",
};

const DayKey = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((s) => !Number.isNaN(Date.parse(`${s}T00:00:00Z`)));

/** The params the page owns beyond the list codec. `.catch` is what drops junk. */
export const ScheduleParamsSchema = z.object({
  zoom: z.enum(["week", "month"]).catch("week"),
  date: DayKey.optional().catch(undefined),
  day: DayKey.optional().catch(undefined),
  job: z.string().min(1).max(64).optional().catch(undefined),
});

export const SCHEDULE_PARAM_KEYS = ["zoom", "date", "day", "job"] as const;

export interface ScheduleView {
  zoom: ScheduleZoom;
  /** Normalised to the range's first day: the week's start (by the org) or the 1st of the month. */
  anchor: string;
  day: string | null;
  job: string | null;
}

/** The view the params describe. A legacy `?search=` (global-search deep link) is read as `q` by the caller. */
export function parseScheduleView(params: URLSearchParams, todayKey: string, startsOn: WeekStart): ScheduleView {
  const p = ScheduleParamsSchema.parse(Object.fromEntries(SCHEDULE_PARAM_KEYS.map((k) => [k, params.get(k) ?? undefined])));
  const anchor = p.date ? (p.zoom === "month" ? monthStart(p.date) : weekOf(p.date, startsOn)) : defaultAnchor(p.zoom, todayKey, startsOn);
  return { zoom: p.zoom, anchor, day: p.day ?? null, job: p.job ?? null };
}

/**
 * The params to write for a change: the defaults (week zoom, the default
 * anchor) are omitted so a plain `/availability` stays plain. `null` deletes.
 */
export function viewPatch(next: Partial<ScheduleView>, current: ScheduleView, todayKey: string, startsOn: WeekStart): Record<string, string | null> {
  const merged = { ...current, ...next };
  const out: Record<string, string | null> = {};
  out.zoom = merged.zoom === "week" ? null : merged.zoom;
  out.date = merged.anchor === defaultAnchor(merged.zoom, todayKey, startsOn) ? null : merged.anchor;
  out.day = merged.day;
  out.job = merged.job;
  return out;
}
