"use client";

import { eachDayOfInterval, format } from "date-fns";
import { useAuthedQuery } from "@/hooks/use-authed-query";
import { useStableNow } from "@/hooks/use-stable-now";
import { fromDateStr } from "@/lib/project-form-dates";
import { api } from "../../../../convex/_generated/api";

/**
 * The wizard's dates-and-availability facts (spec 7c.3), all derived on read:
 * which other jobs have gear out in the rental dates (`projects.windowOverlap`,
 * the same window rule every availability read uses), the calendar's busy-day
 * dots, and what the draft's own lines say about the dates. Never stored.
 */
const DAY_MS = 86_400_000;
const PAD_DAYS = 45;

interface OverlapJob { id: string; number: string; status: string; start: number; end: number; hard: boolean }

/** The two dated reads (the rental dates, and a window around them for the dots), as ms. Args only change when the DATES do. */
function useOverlapWindows(rentalStart: string | undefined, rentalEnd: string | undefined) {
  const now = useStableNow();
  const start = fromDateStr(rentalStart);
  const end = fromDateStr(rentalEnd) ?? start;
  const rental = start && end ? { start: start.getTime(), end: end.getTime() + DAY_MS - 1 } : null;
  const anchor = start?.getTime() ?? now;
  return { rental, around: { start: anchor - PAD_DAYS * DAY_MS, end: anchor + PAD_DAYS * DAY_MS } };
}

/** `yyyy-MM-dd` → the jobs there, for the calendar's titled dots. */
export function busyDayTitles(jobs: OverlapJob[]): Map<string, string> {
  const byDay = new Map<string, string[]>();
  for (const j of jobs) {
    for (const d of eachDayOfInterval({ start: new Date(j.start), end: new Date(j.end) })) {
      const key = format(d, "yyyy-MM-dd");
      byDay.set(key, [...(byDay.get(key) ?? []), j.number]);
    }
  }
  return new Map([...byDay].map(([k, nums]) => [k, `Gear out on ${nums.join(", ")}`]));
}

export function useWizardAvailability(orgId: string | undefined, draftId: string | undefined, rentalStart: string | undefined, rentalEnd: string | undefined) {
  const { rental, around } = useOverlapWindows(rentalStart, rentalEnd);
  const base = { orgId: orgId ?? "", excludeProjectId: draftId };
  const inDates = useAuthedQuery(api.projects.windowOverlap, orgId && rental ? { ...base, ...rental } : "skip");
  const nearby = useAuthedQuery(api.projects.windowOverlap, orgId ? { ...base, ...around } : "skip");
  return {
    others: inDates ?? null,
    busyDays: nearby ? busyDayTitles(nearby.jobs) : undefined,
  };
}

/** The sentence under the rental field. `lines` is the draft's own gear read (null = not read yet / none). */
export function AvailabilityLine({
  hasDates, others, shortLines, lineCount,
}: {
  hasDates: boolean;
  others: { total: number; jobs: OverlapJob[] } | null;
  shortLines: number;
  lineCount: number;
}) {
  if (!hasDates) {
    return <p className="t-micro text-muted">Availability not checked. Set dates to see what else is out.</p>;
  }
  const busy = (others?.total ?? 0) > 0;
  const gear = gearFact(shortLines, lineCount);
  return (
    <div className="space-y-0.5 text-table-cell">
      <p className={busy ? "text-ink" : "text-muted"}>
        <Dot tone={busy ? "warn" : "ok"} />
        {othersText(others)}
      </p>
      <p className="text-muted">
        <Dot tone={gear.tone} />
        {gear.text}
      </p>
    </div>
  );
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

function othersText(others: { total: number; jobs: { number: string }[] } | null): string {
  if (others == null) return "Checking other jobs…";
  if (others.total === 0) return "No other jobs in these dates";
  const named = others.jobs.slice(0, 3).map((j) => j.number).join(" ");
  return `${plural(others.total, "other job")} in these dates ${named}${others.total > 3 ? " …" : ""}`;
}

function gearFact(short: number, lines: number): { tone: "ok" | "bad" | "muted"; text: string } {
  if (lines === 0) return { tone: "muted", text: "Gear not checked yet" };
  if (short > 0) return { tone: "bad", text: `${plural(short, "line")} short` };
  return { tone: "ok", text: `All ${plural(lines, "line")} free` };
}

function Dot({ tone }: { tone: "ok" | "warn" | "bad" | "muted" }) {
  const cls = { ok: "bg-ok", warn: "bg-warn", bad: "bg-t-out", muted: "bg-muted" }[tone];
  return <span aria-hidden className={`mr-2 inline-block size-1.5 rounded-full align-middle ${cls}`} />;
}
