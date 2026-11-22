/**
 * The crew planner's URL state (UX Phase 15, spec §9h.3, D11): week, strip,
 * search and the Role / Skill / Job / Availability filters are query params,
 * so the find-cover deep link (#1246, `?week&role&avail`), Back and a pasted
 * link all land on the same planner. Strip, search and filters go through the
 * shared list codec (`list-url-state.ts`); the week is the one extra param.
 * Other params (`sheet=roles`) are never touched.
 *
 * Legacy forms kept for old links: `week=<epoch ms>` (the #1246 deep link) and
 * the old availability values (`AVAILABLE`, `ASSIGNED`, `UNAVAILABLE`,
 * `TENTATIVE`, `PREFERRED`).
 */
import { z } from "zod";

import { AVAIL_KEYS, defaultWeek, keyOfMs, weekOf, type AvailKey, type PlannerFilters } from "@/lib/crew-planner";
import type { ListUrlSpec, ListUrlState } from "@/lib/list-url-state";

export const PLANNER_SPEC: ListUrlSpec = {
  segments: ["all", "needs", "unconfirmed", "mine"],
  filters: ["role", "skill", "job", "avail"],
  sorts: ["name"],
  defaultSort: "name:asc",
};

export const WEEK_PARAM = "week";

const DayKey = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((s) => !Number.isNaN(Date.parse(`${s}T00:00:00Z`)));
const EpochMs = z.coerce.number().int().min(0).max(8.64e15);

/** `?week=` as the Monday it falls in; junk falls back to the default week. */
export function parseWeek(raw: string | null, todayKey: string): string {
  const key = DayKey.safeParse(raw);
  if (key.success) return weekOf(key.data);
  const ms = raw ? EpochMs.safeParse(raw) : null;
  if (ms?.success) return weekOf(keyOfMs(ms.data));
  return defaultWeek(todayKey);
}

/** The week param to write: omitted for the default week. */
export function weekParam(week: string, todayKey: string): string | null {
  return week === defaultWeek(todayKey) ? null : week;
}

const LEGACY_AVAIL: Record<string, AvailKey> = {
  AVAILABLE: "free",
  ASSIGNED: "booked",
  UNAVAILABLE: "unavailable",
  TENTATIVE: "pencilled",
  PREFERRED: "preferred",
};

const isAvailKey = (v: string): v is AvailKey => (AVAIL_KEYS as readonly string[]).includes(v);

/** Availability values as the planner reads them (legacy values mapped, junk dropped). */
export function normalizeAvail(values: readonly string[] | undefined): AvailKey[] {
  const out = new Set<AvailKey>();
  for (const v of values ?? []) {
    const k = LEGACY_AVAIL[v] ?? v;
    if (isAvailKey(k)) out.add(k);
  }
  return [...out];
}

/** The list state as the planner's filters. */
export function plannerFilters(state: ListUrlState): PlannerFilters {
  return {
    seg: state.seg,
    q: state.q,
    role: state.filters.role ?? [],
    skill: state.filters.skill ?? [],
    job: state.filters.job ?? [],
    avail: normalizeAvail(state.filters.avail),
  };
}

/** The list state with legacy availability values rewritten, so a filter word reads `Free`, not `AVAILABLE`. */
export function canonicalState(state: ListUrlState): ListUrlState {
  const raw = state.filters.avail;
  if (!raw) return state;
  const avail = normalizeAvail(raw);
  const filters = { ...state.filters };
  if (avail.length) filters.avail = avail;
  else delete filters.avail;
  return { ...state, filters };
}
