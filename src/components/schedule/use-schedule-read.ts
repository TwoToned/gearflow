"use client";

import * as React from "react";

import { api } from "../../../convex/_generated/api";
import { useAuthedQuery } from "@/hooks/use-authed-query";
import { useCategories } from "@/hooks/use-categories";
import type { ListFilterDef } from "@/components/ui/list-page-parts";
import { rangeQueryMs, shownJobs, stripCounts, type FilterContext, type ScheduleData } from "@/lib/schedule";
import { projectStatusLabels } from "@/lib/status-labels";
import type { ScheduleUrl } from "./use-schedule-url";

const STATUS_OPTIONS = Object.entries(projectStatusLabels)
  .filter(([k]) => k !== "CANCELLED")
  .map(([value, label]) => ({ value, label }));

function useFilterDefs(data: ScheduleData | undefined, orgId: string | undefined, pm: { id: string; name: string }[]): ListFilterDef[] {
  const categories = useCategories(orgId);
  return React.useMemo(() => {
    const models = data?.models ?? [];
    const used = new Set(models.map((m) => m.categoryId).filter((c): c is string => !!c));
    return [
      { key: "status", label: "Status", options: STATUS_OPTIONS },
      { key: "category", label: "Category", options: (categories ?? []).filter((c) => used.has(c.id)).map((c) => ({ value: c.id, label: c.name })) },
      { key: "model", label: "Model", options: models.map((m) => ({ value: m.id, label: m.name })).sort((a, b) => a.label.localeCompare(b.label)) },
      { key: "pm", label: "PM", options: pm.map((p) => ({ value: p.id, label: p.name })) },
    ];
  }, [data, categories, pm]);
}

/**
 * Everything the Jobs view reads for the URL's range: the live `scheduleBoard.jobs`
 * subscription (its args are the range's first and last millisecond, so the key
 * is stable), the filter words, the jobs that pass the filters (what the strip
 * counts) and the ones the strip segment shows.
 */
export function useScheduleRead(orgId: string | undefined, url: ScheduleUrl, pm: { id: string; name: string }[]) {
  const range = React.useMemo(() => rangeQueryMs(url.range), [url.range]);
  const data = useAuthedQuery(api.scheduleBoard.jobs, orgId ? { orgId, ...range } : "skip") as ScheduleData | undefined;
  const defs = useFilterDefs(data, orgId, pm);
  const ctx: FilterContext = React.useMemo(() => {
    const byId = new Map((data?.models ?? []).map((m) => [m.id, m]));
    return { modelName: (id) => byId.get(id)?.name ?? "", modelCategory: (id) => byId.get(id)?.categoryId ?? null };
  }, [data]);
  const { filtered, shown } = React.useMemo(() => shownJobs(data?.jobs ?? [], url.filters, ctx), [data, url.filters, ctx]);
  const counts = data ? stripCounts(filtered) : undefined;
  return { data, defs, filtered, shown, counts };
}
