"use client";

import * as React from "react";

import { ActionMenu } from "@/components/ui/action-menu";
import { Checkbox } from "@/components/ui/checkbox";
import { StatusWord } from "@/components/ui/status-word";
import { displayDate } from "@/lib/crew-planner";
import { formatDateDayMonth, formatWeekday } from "@/lib/formatters";
import type { ActionMenuSpec } from "@/lib/primitives/types";
import { clashWord, dayFacts, jobFrom, jobsOnDay, jobsWord, jobTo, type ScheduleJob, type ScheduleRange } from "@/lib/schedule";
import { getStatusIntent, intentStyles } from "@/lib/status-colors";
import { projectStatusLabels } from "@/lib/status-labels";
import { cn } from "@/lib/utils";
import type { JobSelection } from "./jobs-timeline";

/**
 * The Schedule on a phone (spec §9o.6, D82): day mode IS the agenda. Day chips
 * for the week (`Wed 12 · clash` red, or `3 jobs`), then the jobs of ONE day as
 * 60 px cards (status word, `clash` / `would clash` under it, ⋯ at 40 px). A
 * card opens the job sheet. A day holds a handful of jobs, so there is no
 * paging; stepping the week reaches every other job.
 */
interface Props {
  jobs: ScheduleJob[];
  range: ScheduleRange;
  day: string;
  onDay: (day: string) => void;
  onOpenJob: (id: string) => void;
  menuFor: (job: ScheduleJob) => ActionMenuSpec;
  selection: JobSelection;
}

function Chips({ jobs, range, day, onDay }: Pick<Props, "jobs" | "range" | "day" | "onDay">) {
  return (
    <div role="tablist" aria-label="Days" className="flex gap-2 overflow-x-auto pb-1">
      {dayFacts(jobs, range.days).map((f) => {
        const d = displayDate(f.day);
        const on = f.day === day;
        const word = f.clash ? "clash" : f.wouldClash ? "would clash" : f.count > 0 ? jobsWord(f.count) : "";
        return (
          <button
            key={f.day}
            type="button"
            role="tab"
            aria-selected={on}
            onClick={() => onDay(f.day)}
            className={cn(
              "flex min-h-11 shrink-0 flex-col items-center justify-center rounded-[var(--r)] border px-3 text-caption",
              on ? "border-ink text-ink" : "border-line-2 text-muted",
            )}
          >
            <span className="font-medium">{`${formatWeekday(d)} ${d.getDate()}`}</span>
            <span className={cn("font-mono", f.clash ? intentStyles.error.text : f.wouldClash ? intentStyles.warning.text : "")}>{word}</span>
          </button>
        );
      })}
    </div>
  );
}

function Card({ job, onOpen, menu, ticked, onTick }: { job: ScheduleJob; onOpen: () => void; menu: ActionMenuSpec; ticked: boolean; onTick: () => void }) {
  const word = clashWord(job);
  return (
    <li className="flex min-h-[60px] items-center gap-1 rounded-[var(--r)] border border-line-2 bg-card pl-1 pr-1">
      <Checkbox aria-label={`Select ${job.projectNumber}`} className="min-h-11 min-w-11" checked={ticked} onClick={onTick} />
      <button type="button" onClick={onOpen} className="flex min-h-11 min-w-0 flex-1 flex-col justify-center py-2 text-left">
        <span className="flex min-w-0 items-center gap-1.5 text-ui-text text-ink">
          <span className="font-mono font-medium">{job.projectNumber}</span>
          <span className="truncate">{job.name}</span>
        </span>
        <span className="truncate text-caption text-muted">
          {job.clientName ? `${job.clientName} · ` : ""}
          {jobFrom(job) === jobTo(job) ? formatDateDayMonth(displayDate(jobFrom(job))) : `${formatDateDayMonth(displayDate(jobFrom(job)))} – ${formatDateDayMonth(displayDate(jobTo(job)))}`}
        </span>
      </button>
      <span className="flex shrink-0 flex-col items-end text-caption">
        <StatusWord status={{ label: projectStatusLabels[job.status] ?? job.status, intent: getStatusIntent("project", job.status) }} />
        {word && <span className={cn("font-medium", intentStyles[word.intent].text)}>{word.label}</span>}
      </span>
      <ActionMenu spec={menu} label={`${job.projectNumber} actions`} />
    </li>
  );
}

export function PhoneSchedule({ jobs, range, day, onDay, onOpenJob, menuFor, selection }: Props) {
  const on = jobsOnDay(jobs, day);
  return (
    <div className="flex flex-col gap-3">
      <Chips jobs={jobs} range={range} day={day} onDay={onDay} />
      {on.length === 0 ? (
        <p className="py-6 text-center text-ui-text text-muted">Nothing booked this day.</p>
      ) : (
        <ul className="flex flex-col gap-2" aria-label={`Jobs on ${day}`}>
          {on.map((j) => (
            <Card key={j.id} job={j} onOpen={() => onOpenJob(j.id)} menu={menuFor(j)} ticked={selection.ids.has(j.id)} onTick={() => selection.onToggle(j.id, false)} />
          ))}
        </ul>
      )}
    </div>
  );
}
