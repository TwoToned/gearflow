"use client";

import * as React from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

import { useListUrlState } from "@/hooks/use-list-url-state";
import { addDays, defaultWeek } from "@/lib/crew-planner";
import { canonicalState, parseWeek, plannerFilters, weekParam, PLANNER_SPEC, WEEK_PARAM } from "@/lib/crew-planner-url";
import { clearFilters, setFilter, withPatch } from "@/lib/list-url-state";
import { useOrgWeekStartsOn } from "@/lib/use-org-country";

/**
 * The planner's state IS the URL (D11): strip, search and filters through the
 * shared list codec, the week as its own param. Every write keeps the params
 * it does not own (`sheet=roles`). `todayKey` is the viewer's local day,
 * snapshotted once (never `Date.now()` in render).
 */
export function usePlannerUrl(todayKey: string) {
  // The org's week start (#1086): D46 fixes ONE week, not which day it starts on.
  const startsOn = useOrgWeekStartsOn();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const raw = params.toString();
  const { state: rawState, setState } = useListUrlState(PLANNER_SPEC);
  const state = React.useMemo(() => canonicalState(rawState), [rawState]);
  const filters = React.useMemo(() => plannerFilters(state), [state]);
  const week = React.useMemo(() => parseWeek(new URLSearchParams(raw).get(WEEK_PARAM), todayKey, startsOn), [raw, todayKey, startsOn]);

  const setWeek = React.useCallback(
    (next: string) => {
      const p = new URLSearchParams(raw);
      const w = weekParam(next, todayKey, startsOn);
      if (w) p.set(WEEK_PARAM, w);
      else p.delete(WEEK_PARAM);
      const qs = p.toString();
      router.push(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [raw, todayKey, startsOn, router, pathname],
  );

  return {
    state,
    filters,
    week,
    stepWeek: (n: number) => setWeek(n === 0 ? defaultWeek(todayKey, startsOn) : addDays(week, 7 * n)),
    setSeg: (seg: string) => setState(withPatch(state, { seg })),
    setSearch: (q: string) => setState(withPatch(state, { q }), "replace"),
    setFilter: (key: string, values: string[]) => setState(setFilter(state, key, values)),
    clear: () => setState(clearFilters(state)),
  };
}

export type PlannerUrl = ReturnType<typeof usePlannerUrl>;
