"use client";

import * as React from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

import { clearFilters, listParamKeys, parseListState, serializeListState, setFilter, withPatch, type ListUrlState } from "@/lib/list-url-state";
import { scheduleRange, stepRange, type ScheduleFilters, type ScheduleZoom } from "@/lib/schedule";
import { parseScheduleView, segmentFor, SCHEDULE_SPEC, viewPatch, type ScheduleView, type ScheduleViewKey } from "@/lib/schedule-url";
import { useOrgWeekStartsOn } from "@/lib/use-org-country";

/** A global-search deep link (`?search=`) is rewritten once into the page's own `?q=`. */
function useLegacySearch(legacySearch: string | null, raw: string) {
  const router = useRouter();
  const pathname = usePathname();
  React.useEffect(() => {
    if (!legacySearch) return;
    const p = new URLSearchParams(raw);
    p.delete("search");
    if (!p.get("q")) p.set("q", legacySearch.slice(0, 200));
    router.replace(`${pathname}?${p.toString()}`, { scroll: false });
  }, [legacySearch, raw, router, pathname]);
}

/**
 * The Schedule's state IS the URL (D11): view (Jobs / Gear), strip, search and
 * filters through the shared list codec; zoom, date and the open sheets
 * through `schedule-url.ts`. EVERY write goes through `commit`, so a change
 * to both halves (switching view clears the strip and the open sheets) is ONE
 * history entry, and params the page does not own are kept. `todayKey` is the
 * viewer's local day, snapshotted once (never `Date.now()` in render). A phone
 * shows one week at a time whatever `zoom` says (spec §9o.6).
 */
export function useScheduleUrl(todayKey: string, phone: boolean) {
  const startsOn = useOrgWeekStartsOn();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const raw = params.toString();
  const state = React.useMemo(() => parseListState(new URLSearchParams(raw), SCHEDULE_SPEC), [raw]);
  const view: ScheduleView = React.useMemo(
    () => parseScheduleView(new URLSearchParams(raw), todayKey, startsOn, phone ? "week" : undefined),
    [raw, todayKey, startsOn, phone],
  );
  const range = React.useMemo(() => scheduleRange(view.zoom, view.anchor, startsOn), [view.zoom, view.anchor, startsOn]);
  const mode: ScheduleViewKey = state.view === "gear" ? "gear" : "jobs";

  useLegacySearch(params.get("search"), raw);

  const commit = React.useCallback(
    (nextState: ListUrlState, next: Partial<ScheduleView>, how: "push" | "replace" = "push") => {
      const p = new URLSearchParams(raw);
      for (const k of listParamKeys(SCHEDULE_SPEC)) p.delete(k);
      for (const [k, v] of serializeListState(nextState, SCHEDULE_SPEC)) p.set(k, v);
      for (const [k, v] of Object.entries(viewPatch(next, view, todayKey, startsOn))) {
        if (v) p.set(k, v);
        else p.delete(k);
      }
      const qs = p.toString();
      const href = qs ? `${pathname}?${qs}` : pathname;
      if (how === "replace") router.replace(href, { scroll: false });
      else router.push(href, { scroll: false });
    },
    [raw, view, todayKey, startsOn, router, pathname],
  );

  const filters: ScheduleFilters = {
    seg: segmentFor(mode, state.seg),
    q: state.q,
    status: state.filters.status ?? [],
    pm: state.filters.pm ?? [],
    category: state.filters.category ?? [],
    model: state.filters.model ?? [],
  };
  const shut = { day: null, job: null, cell: null };

  return {
    view,
    mode,
    range,
    state,
    filters,
    startsOn,
    step: (n: number) => commit(state, { anchor: stepRange(range, n, todayKey, startsOn), ...shut }),
    setZoom: (zoom: ScheduleZoom) => commit(state, { zoom, anchor: range.start, ...shut }),
    setMode: (next: ScheduleViewKey) => commit(withPatch(state, { view: next, seg: "all" }), shut),
    openDay: (day: string | null) => commit(state, { day, job: null, cell: null }),
    openJob: (job: string | null) => commit(state, { job, day: null, cell: null }),
    openCell: (cell: string | null) => commit(state, { cell, day: null, job: null }),
    setSeg: (seg: string) => commit(withPatch(state, { seg }), {}),
    setSearch: (next: string) => commit(withPatch(state, { q: next }), {}, "replace"),
    setFilter: (key: string, values: string[]) => commit(setFilter(state, key, values), {}),
    clear: () => commit(clearFilters(state), {}),
  };
}

export type ScheduleUrl = ReturnType<typeof useScheduleUrl>;
