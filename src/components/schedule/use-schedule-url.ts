"use client";

import * as React from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

import { useListUrlState } from "@/hooks/use-list-url-state";
import { clearFilters, setFilter, withPatch } from "@/lib/list-url-state";
import { scheduleRange, stepRange, type ScheduleFilters, type ScheduleZoom } from "@/lib/schedule";
import { parseScheduleView, SCHEDULE_SPEC, viewPatch, type ScheduleView } from "@/lib/schedule-url";
import { useOrgWeekStartsOn } from "@/lib/use-org-country";

/**
 * The Schedule's state IS the URL (D11): strip, search and filters through the
 * shared list codec; zoom, date and the open sheets through `schedule-url.ts`.
 * Every write keeps the params it does not own. `todayKey` is the viewer's
 * local day, snapshotted once (never `Date.now()` in render). A phone shows one
 * week at a time whatever `zoom` says (spec §9o.6: zoom and the grid are hidden).
 */
export function useScheduleUrl(todayKey: string, phone: boolean) {
  const startsOn = useOrgWeekStartsOn();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const raw = params.toString();
  const { state, setState } = useListUrlState(SCHEDULE_SPEC);
  const view: ScheduleView = React.useMemo(
    () => parseScheduleView(new URLSearchParams(raw), todayKey, startsOn, phone ? "week" : undefined),
    [raw, todayKey, startsOn, phone],
  );
  const range = React.useMemo(() => scheduleRange(view.zoom, view.anchor, startsOn), [view.zoom, view.anchor, startsOn]);

  // A global-search deep link (`?search=`) is rewritten once into the page's own `?q=`.
  const legacySearch = params.get("search");
  React.useEffect(() => {
    if (!legacySearch) return;
    const p = new URLSearchParams(raw);
    p.delete("search");
    if (!p.get("q")) p.set("q", legacySearch.slice(0, 200));
    router.replace(`${pathname}?${p.toString()}`, { scroll: false });
  }, [legacySearch, raw, router, pathname]);
  const q = state.q;

  const write = React.useCallback(
    (next: Partial<ScheduleView>, mode: "push" | "replace" = "push") => {
      const p = new URLSearchParams(raw);
      for (const [k, v] of Object.entries(viewPatch(next, view, todayKey, startsOn))) {
        if (v) p.set(k, v);
        else p.delete(k);
      }
      const qs = p.toString();
      const href = qs ? `${pathname}?${qs}` : pathname;
      if (mode === "replace") router.replace(href, { scroll: false });
      else router.push(href, { scroll: false });
    },
    [raw, view, todayKey, startsOn, router, pathname],
  );

  const filters: ScheduleFilters = {
    seg: state.seg,
    q,
    status: state.filters.status ?? [],
    pm: state.filters.pm ?? [],
    category: state.filters.category ?? [],
    model: state.filters.model ?? [],
  };

  return {
    view,
    range,
    state,
    filters,
    startsOn,
    step: (n: number) => write({ anchor: stepRange(range, n, todayKey, startsOn), day: null, job: null }),
    setZoom: (zoom: ScheduleZoom) => write({ zoom, anchor: range.start, day: null, job: null }),
    openDay: (day: string | null) => write({ day, job: null }),
    openJob: (job: string | null) => write({ job, day: null }),
    setSeg: (seg: string) => setState(withPatch(state, { seg })),
    setSearch: (next: string) => setState(withPatch(state, { q: next }), "replace"),
    setFilter: (key: string, values: string[]) => setState(setFilter(state, key, values)),
    clear: () => setState(clearFilters(state)),
  };
}

export type ScheduleUrl = ReturnType<typeof useScheduleUrl>;
