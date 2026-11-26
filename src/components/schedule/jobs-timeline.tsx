"use client";

import * as React from "react";

import { ActionMenu } from "@/components/ui/action-menu";
import { StatusWord } from "@/components/ui/status-word";
import { displayDate, isWeekend } from "@/lib/crew-planner";
import { formatWeekday } from "@/lib/formatters";
import type { ActionMenuSpec } from "@/lib/primitives/types";
import { barFor, clashWord, dayFacts, jobHold, jobsWord, type Bar as BarShape, type ClashWord, type ScheduleJob, type ScheduleRange } from "@/lib/schedule";
import { intentStyles, getStatusIntent } from "@/lib/status-colors";
import { projectStatusLabels } from "@/lib/status-labels";
import { cn } from "@/lib/utils";

/**
 * The Jobs timeline (spec §9o.3): rows are jobs in start order, columns days.
 * One bar per job across its rental window; it keeps ONE row however busy the
 * day (no lane cap, no `+n more`), and a square edge means it continues past
 * the range. Held = a quiet raised block with a hairline; pencilled = no fill,
 * a hatched hairline and muted text (it holds nothing). Colour lives only in
 * the status dot-word and in the `clash` / `would clash` word, never on the bar.
 * Week and Month are the same grid with a different number of columns (D83).
 */
const LABEL_PX = 264;

interface Props {
  jobs: ScheduleJob[];
  range: ScheduleRange;
  today: string;
  onOpenJob: (id: string) => void;
  onOpenDay: (day: string) => void;
  menuFor: (job: ScheduleJob) => ActionMenuSpec;
}

const HATCH = "repeating-linear-gradient(135deg, transparent 0 5px, var(--line-2) 5px 6px)";

function dayCellClass(day: string, today: string): string {
  return cn("min-h-11 border-l border-line", isWeekend(day) && "bg-paper-2/50", day === today && "border-x border-x-ink/40");
}

function Header({ range, today, jobs, onOpenDay, cols }: { range: ScheduleRange; today: string; jobs: ScheduleJob[]; onOpenDay: (d: string) => void; cols: string }) {
  const month = range.zoom === "month";
  const facts = dayFacts(jobs, range.days);
  return (
    <div role="row" className="grid border-b border-line-2" style={{ gridTemplateColumns: cols }}>
      <div className="sticky left-0 z-20 bg-card px-3 py-2 text-caption text-muted">{jobsWord(jobs.length)}</div>
      {facts.map((f) => {
        const d = displayDate(f.day);
        return (
          <button
            key={f.day}
            type="button"
            role="columnheader"
            aria-label={`${formatWeekday(d)} ${d.getDate()}, ${jobsWord(f.count)}${f.clash ? ", clash" : ""}`}
            onClick={() => onOpenDay(f.day)}
            className={cn("flex flex-col items-center gap-0.5 py-2 hover:bg-paper-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-red", dayCellClass(f.day, today))}
          >
            <span className="inline-flex items-center gap-1 font-mono text-caption font-medium text-ink">
              {(f.clash || f.wouldClash) && <span aria-hidden="true" className={cn("size-1.5 rounded-full", f.clash ? intentStyles.error.dot : intentStyles.warning.dot)} />}
              {month ? `${formatWeekday(d).slice(0, 1)} ${d.getDate()}` : `${formatWeekday(d)} ${d.getDate()}`}
            </span>
            {!month && <span className="font-mono text-caption text-muted">{f.count > 0 ? jobsWord(f.count) : ""}</span>}
          </button>
        );
      })}
    </div>
  );
}

function barClass(bar: BarShape, pencilled: boolean): string {
  return cn(
    "z-10 my-1 flex min-w-0 items-center gap-1.5 overflow-hidden border px-2 text-caption focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red",
    pencilled ? "border-dashed border-line-2 text-muted" : "border-line-2 bg-elev text-ink",
    bar.capStart ? "rounded-l-[7px]" : "rounded-l-none border-l-0",
    bar.capEnd ? "rounded-r-[7px]" : "rounded-r-none border-r-0",
  );
}

/** The bar's words: the number always; name and clash word at Week zoom, a dot before the number at Month. */
function BarText({ job, word, month }: { job: ScheduleJob; word: ClashWord | null; month: boolean }) {
  if (month) {
    return (
      <>
        {word && <span aria-hidden="true" className={cn("size-1.5 shrink-0 rounded-full", intentStyles[word.intent].dot)} />}
        <span className="font-mono">{job.projectNumber}</span>
      </>
    );
  }
  return (
    <>
      <span className="font-mono">{job.projectNumber}</span>
      <span className="truncate">{job.name}</span>
      {word && <span className={cn("shrink-0 font-medium", intentStyles[word.intent].text)}>{word.label}</span>}
    </>
  );
}

function Bar({ job, range, onOpen }: { job: ScheduleJob; range: ScheduleRange; onOpen: () => void }) {
  const bar = barFor(job, range.days);
  if (!bar) return null;
  const word = clashWord(job);
  const pencilled = jobHold(job) === "pencilled";
  return (
    <button
      type="button"
      title={`${job.projectNumber} ${job.name}${word ? ` · ${word.label}` : ""}`}
      aria-label={`${job.projectNumber} ${job.name}`}
      onClick={onOpen}
      data-pencilled={pencilled ? "true" : undefined}
      className={barClass(bar, pencilled)}
      style={{ gridColumn: `${bar.col + 2} / span ${bar.span}`, gridRow: 1, backgroundImage: pencilled ? HATCH : undefined }}
    >
      <BarText job={job} word={word} month={range.zoom === "month"} />
    </button>
  );
}

function Label({ job, onOpen, menu }: { job: ScheduleJob; onOpen: () => void; menu: ActionMenuSpec }) {
  const pencilled = jobHold(job) === "pencilled";
  return (
    <div className="sticky left-0 z-20 flex items-center gap-1 bg-card pl-3 pr-1" style={{ gridRow: 1, gridColumn: 1 }}>
      <button type="button" onClick={onOpen} className="flex min-w-0 flex-1 flex-col py-1 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red">
        <span className="flex min-w-0 items-center gap-1.5 text-ui-text text-ink">
          <span className="font-mono font-medium">{job.projectNumber}</span>
          <span className="truncate">{job.name}</span>
        </span>
        <span className="flex min-w-0 items-center gap-1.5 text-caption text-muted">
          {job.clientName && <span className="truncate">{job.clientName}</span>}
          <StatusWord status={{ label: projectStatusLabels[job.status] ?? job.status, intent: getStatusIntent("project", job.status) }} />
          {pencilled && <span>· pencilled</span>}
        </span>
      </button>
      <ActionMenu spec={menu} label={`${job.projectNumber} actions`} />
    </div>
  );
}

export function JobsTimeline({ jobs, range, today, onOpenJob, onOpenDay, menuFor }: Props) {
  const cols = `${LABEL_PX}px repeat(${range.days.length}, minmax(${range.zoom === "month" ? 34 : 88}px, 1fr))`;
  return (
    <div className="overflow-x-auto rounded-[var(--r-lg)] border border-line-2 bg-card" data-testid="schedule-timeline">
      <div role="table" aria-label="Jobs by day" style={{ minWidth: LABEL_PX + range.days.length * (range.zoom === "month" ? 34 : 88) }}>
        <Header range={range} today={today} jobs={jobs} onOpenDay={onOpenDay} cols={cols} />
        {jobs.map((job) => (
          <div key={job.id} role="row" className="grid border-b border-line last:border-b-0" style={{ gridTemplateColumns: cols }}>
            <Label job={job} onOpen={() => onOpenJob(job.id)} menu={menuFor(job)} />
            {range.days.map((d, i) => (
              <div key={d} role="cell" aria-hidden="true" className={dayCellClass(d, today)} style={{ gridRow: 1, gridColumn: i + 2 }} />
            ))}
            <Bar job={job} range={range} onOpen={() => onOpenJob(job.id)} />
          </div>
        ))}
      </div>
    </div>
  );
}
