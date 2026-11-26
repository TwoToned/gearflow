"use client";

import * as React from "react";

import { api } from "../../../convex/_generated/api";
import { useAuthedQuery } from "@/hooks/use-authed-query";
import { useCategories } from "@/hooks/use-categories";
import type { ListFilterDef } from "@/components/ui/list-page-parts";
import { rangeQueryMs, shownJobs, stripCounts, type FilterContext, type ScheduleData } from "@/lib/schedule";
import { gearStrip, shownGearRows, type GearData } from "@/lib/schedule-gear";
import { projectStatusLabels } from "@/lib/status-labels";
import type { ScheduleUrl } from "./use-schedule-url";

const STATUS_OPTIONS = Object.entries(projectStatusLabels)
  .filter(([k]) => k !== "CANCELLED")
  .map(([value, label]) => ({ value, label }));

interface ModelRef {
  id: string;
  name: string;
  categoryId: string | null;
}

function useFilterDefs(models: ModelRef[], orgId: string | undefined, pm: { id: string; name: string }[]): ListFilterDef[] {
  const categories = useCategories(orgId);
  return React.useMemo(() => {
    const used = new Set(models.map((m) => m.categoryId).filter((c): c is string => !!c));
    return [
      { key: "status", label: "Status", options: STATUS_OPTIONS },
      { key: "category", label: "Category", options: (categories ?? []).filter((c) => used.has(c.id)).map((c) => ({ value: c.id, label: c.name })) },
      { key: "model", label: "Model", options: models.map((m) => ({ value: m.id, label: m.name })).sort((a, b) => a.label.localeCompare(b.label)) },
      { key: "pm", label: "PM", options: pm.map((p) => ({ value: p.id, label: p.name })) },
    ];
  }, [models, categories, pm]);
}

function useJobsRead(orgId: string | undefined, url: ScheduleUrl, range: { startMs: number; endMs: number }) {
  // The jobs read also feeds the job sheet a Gear cell opens, so it runs for a `?job=` too.
  const on = url.mode === "jobs" || !!url.view.job;
  const data = useAuthedQuery(api.scheduleBoard.jobs, orgId && on ? { orgId, ...range } : "skip") as ScheduleData | undefined;
  const ctx: FilterContext = React.useMemo(() => {
    const byId = new Map((data?.models ?? []).map((m) => [m.id, m]));
    return { modelName: (id) => byId.get(id)?.name ?? "", modelCategory: (id) => byId.get(id)?.categoryId ?? null };
  }, [data]);
  const { filtered, shown } = React.useMemo(() => shownJobs(data?.jobs ?? [], url.filters, ctx), [data, url.filters, ctx]);
  return { data, filtered, shown, counts: data ? stripCounts(filtered) : undefined };
}

function useGearRead(orgId: string | undefined, url: ScheduleUrl, range: { startMs: number; endMs: number }) {
  const data = useAuthedQuery(api.scheduleBoard.grid, orgId && url.mode === "gear" ? { orgId, ...range } : "skip") as GearData | undefined;
  const { filtered, shown } = React.useMemo(() => shownGearRows(data?.rows ?? [], url.filters), [data, url.filters]);
  return { data, filtered, shown, counts: data ? gearStrip(filtered) : undefined };
}

/**
 * Everything the Schedule reads for the URL's range, as live subscriptions: the
 * Jobs read (`scheduleBoard.jobs`) in Jobs, the Gear grid (`scheduleBoard.grid`) in
 * Gear — one at a time, so the bounded read is never paid twice. The args are
 * the range's first and last millisecond, so the key is stable (never `Date.now()`).
 */
export function useScheduleRead(orgId: string | undefined, url: ScheduleUrl, pm: { id: string; name: string }[]) {
  const range = React.useMemo(() => rangeQueryMs(url.range), [url.range]);
  const jobs = useJobsRead(orgId, url, range);
  const gear = useGearRead(orgId, url, range);
  const models = React.useMemo<ModelRef[]>(
    () => (url.mode === "gear" ? (gear.data?.rows ?? []).map((r) => ({ id: r.modelId, name: r.name, categoryId: r.categoryId })) : (jobs.data?.models ?? [])),
    [url.mode, gear.data, jobs.data],
  );
  const defs = useFilterDefs(models, orgId, pm);
  const categories = useCategories(orgId);
  const categoryName = React.useCallback((id: string) => categories?.find((c) => c.id === id)?.name ?? null, [categories]);
  return { jobs, gear, defs, categoryName, truncated: (url.mode === "gear" ? gear.data?.truncated : jobs.data?.truncated) ?? false };
}
