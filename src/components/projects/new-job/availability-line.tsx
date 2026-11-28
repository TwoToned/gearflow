"use client";

import { eachDayOfInterval, endOfMonth, endOfWeek, format, startOfMonth, startOfWeek } from "date-fns";
import { useAuthedQuery } from "@/hooks/use-authed-query";
import { useStableNow } from "@/hooks/use-stable-now";
import { fromDateStr } from "@/lib/project-form-dates";
import { useOrgWeekStartsOn } from "@/lib/use-org-country";
import { api } from "../../../../convex/_generated/api";

/**
 * The wizard's dates-and-availability facts (spec 7c.3), all derived on read from ONE
 * subscription, `projects.windowOverlap`, over the calendar's VISIBLE month grid joined
 * with the rental dates: the line under the field filters that result to the rental
 * dates, the dots read it per day. Same window rule as every availability read. Never stored.
 */
const DAY_MS = 86_400_000;

interface OverlapJob { id: string; number: string; status: string; start: number; end: number; hard: boolean }
export interface Overlap { total: number; truncated: boolean; jobs: OverlapJob[] }

/** The one read's window as ms: the visible month's grid, widened to take in the rental dates. Args change only when the month or the dates do. */
function useReadWindow(month: Date | undefined, rentalStart: string | undefined, rentalEnd: string | undefined) {
  const now = useStableNow();
  // The same week start the calendar grid lays out, or the read would miss a leading/trailing day.
  const weekStartsOn = useOrgWeekStartsOn();
  const start = fromDateStr(rentalStart);
  const end = fromDateStr(rentalEnd) ?? start;
  const visible = month ?? start ?? new Date(now);
  const from = startOfWeek(startOfMonth(visible), { weekStartsOn }).getTime();
  const to = endOfWeek(endOfMonth(visible), { weekStartsOn }).getTime();
  const rental = start && end ? { start: start.getTime(), end: end.getTime() + DAY_MS - 1 } : null;
  return { rental, window: { start: Math.min(from, rental?.start ?? from), end: Math.max(to, rental?.end ?? to) } };
}

/** The result narrowed to the jobs overlapping the rental dates (the line's count). */
function overlapWith(read: Overlap, rental: { start: number; end: number }): Overlap {
  const jobs = read.jobs.filter((j) => j.start <= rental.end && j.end >= rental.start);
  return { total: jobs.length, truncated: read.truncated, jobs };
}

/** `yyyy-MM-dd` → the jobs there, for the calendar's titled dots. */
function busyDayTitles(jobs: OverlapJob[]): Map<string, string> {
  const byDay = new Map<string, string[]>();
  for (const j of jobs) {
    for (const d of eachDayOfInterval({ start: new Date(j.start), end: new Date(j.end) })) {
      const key = format(d, "yyyy-MM-dd");
      byDay.set(key, [...(byDay.get(key) ?? []), j.number]);
    }
  }
  return new Map([...byDay].map(([k, nums]) => [k, `Gear out on ${nums.join(", ")}`]));
}

export function useWizardAvailability(
  orgId: string | undefined, draftId: string | undefined, rentalStart: string | undefined, rentalEnd: string | undefined, month: Date | undefined,
) {
  const { rental, window } = useReadWindow(month, rentalStart, rentalEnd);
  const read = useAuthedQuery(api.projects.windowOverlap, orgId ? { orgId, excludeProjectId: draftId, ...window } : "skip");
  return {
    others: read && rental ? overlapWith(read, rental) : null,
    busyDays: read ? busyDayTitles(read.jobs) : undefined,
  };
}

/** The sentence under the rental field. `lines` is the draft's own gear read (null = not read yet / none). */
export function AvailabilityLine({
  hasDates, others, shortLines, lineCount,
}: {
  hasDates: boolean;
  others: Overlap | null;
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

function othersText(others: Overlap | null): string {
  if (others == null) return "Checking other jobs…";
  if (others.total === 0) return "No other jobs in these dates";
  const named = others.jobs.slice(0, 3).map((j) => j.number).join(" ");
  const count = others.truncated ? `${others.total}+ other jobs` : plural(others.total, "other job");
  return `${count} in these dates ${named}${others.total > 3 ? " …" : ""}`;
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
