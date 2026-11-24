"use client";

import { useEffect, useMemo, useState } from "react";
import { useAuthedQuery } from "@/hooks/use-authed-query";
import { splitDateQuery, type PaletteDate } from "@/lib/palette/date-query";
import { dateSections, recordRow, ROWS_PER_GROUP, type PaletteRow, type PaletteSection, type DateJob } from "@/lib/palette/model";
import type { GlobalSearchResponse } from "@/hooks/use-global-search";
import { api } from "../../../../convex/_generated/api";

const GEAR_TYPES = ["model", "asset", "bulk-asset", "kit"];

/** The gear matching the words after a date (`14 nov aura`), each opening on that date. */
function useDatedGear(search: (q: string) => Promise<GlobalSearchResponse>, words: string, iso: string | null) {
  const [rows, setRows] = useState<PaletteRow[]>([]);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    if (!iso || words.length < 2) {
      setRows([]);
      return;
    }
    setLoading(true);
    let aborted = false;
    const timer = setTimeout(() => {
      search(words)
        .then((data) => {
          if (aborted) return;
          const gear = data.results.filter((r) => GEAR_TYPES.includes(r.type));
          setRows(gear.map((r) => ({ ...recordRow(r), id: `date-${recordRow(r).id}`, href: `${r.href}?date=${iso}` })));
        })
        .catch(() => !aborted && setRows([]))
        .finally(() => !aborted && setLoading(false));
    }, 200);
    return () => {
      aborted = true;
      clearTimeout(timer);
    };
  }, [search, words, iso]);
  return { rows, loading };
}

/**
 * A date at the start of the input (`14/11`, `14 nov`, also after `@`) lists
 * that day's jobs through the EXISTING Jobs list query (`projects.listPage`
 * with the day as its date window; no new read), the dated gear for any words
 * after it, and the Schedule for the day. The window comes from the typed
 * words and a stable `now` (the year), never a fresh clock read in the args.
 */
export function useDateMode(opts: {
  raw: string;
  enabled: boolean;
  now: number;
  orgId: string | undefined;
  canReadJobs: boolean;
  search: (q: string) => Promise<GlobalSearchResponse>;
}) {
  const split = useMemo(() => (opts.enabled ? splitDateQuery(opts.raw, opts.now) : null), [opts.enabled, opts.raw, opts.now]);
  const { date, rest } = split ?? { date: null, rest: "" };
  const jobsFor = date && opts.orgId && opts.canReadJobs ? { orgId: opts.orgId, date } : null;
  const jobs = useAuthedQuery(api.projects.listPage, dayJobsArgs(jobsFor));
  const gear = useDatedGear(opts.search, rest, date ? date.iso : null);
  const sections = useMemo(() => sectionsFor(date, jobs, gear.rows), [date, jobs, gear.rows]);
  return { date, sections, loading: gear.loading || (jobsFor !== null && jobs === undefined) };
}

function sectionsFor(date: PaletteDate | null, jobs: { items: unknown[]; total: number } | undefined, gear: PaletteRow[]): PaletteSection[] {
  if (!date) return [];
  return dateSections(date, jobs ? { rows: jobs.items as DateJob[], total: jobs.total } : undefined, gear);
}

/** The Jobs list query for one day (its date window, first four by start), or skip. */
function dayJobsArgs(q: { orgId: string; date: PaletteDate } | null) {
  if (!q) return "skip" as const;
  return { orgId: q.orgId, dateFrom: q.date.dayStart, dateTo: q.date.dayEnd, page: 1, pageSize: ROWS_PER_GROUP, sortBy: "rentalStartDate", sortOrder: "asc" as const };
}
