"use client";

import * as React from "react";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { StatusWord } from "@/components/ui/status-word";
import { useIsMobile } from "@/hooks/use-mobile";
import { displayDate, keyOfMs } from "@/lib/crew-planner";
import { formatDateDayMonth, formatWeekdayDayMonth } from "@/lib/formatters";
import { clashWord, jobFrom, jobHold, jobsOnDay, jobsWord, jobTo, type ScheduleJob } from "@/lib/schedule";
import { intentStyles, getStatusIntent } from "@/lib/status-colors";
import { projectStatusLabels } from "@/lib/status-labels";
import { cn } from "@/lib/utils";

/**
 * The Schedule's two side sheets (spec §9o.3): the JOB sheet (a bar or label
 * opens it) and the DAY sheet (a day header opens it). A bottom sheet on a
 * phone. Both are driven by the URL (`?job=`, `?day=`) and read the LIVE data
 * every render, so a job that left the range closes its sheet.
 */
export const jobHref = (id: string, tab?: string) => `/projects/${id}${tab ? `?tab=${tab}` : ""}`;

const span = (from: string, to: string): string =>
  from === to ? formatDateDayMonth(displayDate(from)) : `${formatDateDayMonth(displayDate(from))} – ${formatDateDayMonth(displayDate(to))}`;

function statusOf(j: ScheduleJob) {
  return { label: projectStatusLabels[j.status] ?? j.status, intent: getStatusIntent("project", j.status) };
}

function holdSentence(j: ScheduleJob): string {
  const h = jobHold(j);
  if (h === "held") return "holds its gear";
  if (h === "pencilled") return "pencilled · holds nothing";
  return "finished · holds nothing";
}

function gearLine(j: ScheduleJob): string {
  if (j.lineCount == null || j.unitCount == null || j.modelCount == null) return "Not read";
  const models = `${j.modelCount} ${j.modelCount === 1 ? "model" : "models"}`;
  const units = `${j.unitCount} ${j.unitCount === 1 ? "unit" : "units"}`;
  const lines = `${j.lineCount} ${j.lineCount === 1 ? "line" : "lines"}`;
  return `${models} · ${units} · ${lines}`;
}

function ClashRows({ job }: { job: ScheduleJob }) {
  if (job.clash === "unknown") {
    return (
      <p className="text-ui-text text-muted">
        Not checked. This job&apos;s gear is more than the Schedule reads at once, so a clash can&apos;t be ruled out. Open the job to see it.
      </p>
    );
  }
  if (job.clashes.length === 0) return null;
  return (
    <section aria-label="Clashes" className="flex flex-col gap-2">
      <h3 className="text-caption font-medium uppercase tracking-wide text-muted">Clashes</h3>
      <ul className="flex flex-col gap-1.5">
        {job.clashes.map((r) => {
          const word = r.layer === "hard" ? "short" : "would be short";
          const others = r.with.map((w) => w.projectNumber).join(", ");
          return (
            <li key={`${r.modelId}-${r.startMs}-${r.layer}`} className="text-ui-text text-ink">
              <span className={cn("font-medium", r.layer === "hard" ? intentStyles.error.text : intentStyles.warning.text)}>
                {word} {r.short}
              </span>
              {" · "}
              {r.modelName}
              {others && ` · with ${others}`}
              {" · "}
              <span className="text-muted">{span(keyOfMs(r.startMs), keyOfMs(r.endMs))}</span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function Facts({ job, pmName }: { job: ScheduleJob; pmName: string | undefined }) {
  return (
    <dl className="grid grid-cols-[96px_1fr] gap-x-3 gap-y-2 text-ui-text">
      <dt className="text-muted">When</dt>
      <dd className="text-ink">{span(jobFrom(job), jobTo(job))}</dd>
      {job.clientName && (
        <>
          <dt className="text-muted">Client</dt>
          <dd className="text-ink">{job.clientName}</dd>
        </>
      )}
      {pmName && (
        <>
          <dt className="text-muted">PM</dt>
          <dd className="text-ink">{pmName}</dd>
        </>
      )}
      <dt className="text-muted">Gear</dt>
      <dd className="text-ink">{gearLine(job)}</dd>
    </dl>
  );
}

function useSheetSide(): "bottom" | "right" {
  return useIsMobile() ? "bottom" : "right";
}

export function JobSheet({ job, pmName, onClose }: { job: ScheduleJob | null; pmName: string | undefined; onClose: () => void }) {
  const side = useSheetSide();
  const word = job ? clashWord(job) : null;
  return (
    <Sheet open={!!job} onOpenChange={(o) => !o && onClose()}>
      <SheetContent side={side} className="overflow-y-auto sm:max-w-md">
        {job && (
          <div className="flex flex-col gap-5 p-1">
            <SheetHeader>
              <SheetTitle>
                <span className="font-mono">{job.projectNumber}</span> {job.name}
              </SheetTitle>
              <SheetDescription className="flex flex-wrap items-center gap-x-2">
                <StatusWord status={statusOf(job)} />
                <span>{holdSentence(job)}</span>
                {word && job.clash !== "unknown" && <span className={cn("font-medium", intentStyles[word.intent].text)}>{word.label}</span>}
              </SheetDescription>
            </SheetHeader>
            <Facts job={job} pmName={pmName} />
            <ClashRows job={job} />
            <SheetFooter className="flex-col gap-2 sm:flex-col">
              <Button asChild>
                <Link href={jobHref(job.id)}>Open job</Link>
              </Button>
              <Button asChild variant="line">
                <Link href={jobHref(job.id, "equipment")}>Equipment ›</Link>
              </Button>
              <Button asChild variant="line">
                <Link href={jobHref(job.id, "logistics")}>Logistics ›</Link>
              </Button>
            </SheetFooter>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

export function DaySheet({ day, jobs, onOpenJob, onClose }: { day: string | null; jobs: ScheduleJob[]; onOpenJob: (id: string) => void; onClose: () => void }) {
  const side = useSheetSide();
  const on = day ? jobsOnDay(jobs, day) : [];
  return (
    <Sheet open={!!day} onOpenChange={(o) => !o && onClose()}>
      <SheetContent side={side} className="overflow-y-auto sm:max-w-md">
        {day && (
          <div className="flex flex-col gap-5 p-1">
            <SheetHeader>
              <SheetTitle>{formatWeekdayDayMonth(displayDate(day))}</SheetTitle>
              <SheetDescription>{on.length === 0 ? "Nothing booked this day." : jobsWord(on.length)}</SheetDescription>
            </SheetHeader>
            <ul className="flex flex-col divide-y divide-line">
              {on.map((j) => {
                const w = clashWord(j);
                return (
                  <li key={j.id}>
                    <button type="button" onClick={() => onOpenJob(j.id)} className="flex min-h-11 w-full flex-col gap-0.5 py-2 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red">
                      <span className="flex items-center gap-2 text-ui-text text-ink">
                        <span className="font-mono font-medium">{j.projectNumber}</span>
                        <span className="truncate">{j.name}</span>
                        {w && <span className={cn("shrink-0 text-caption font-medium", intentStyles[w.intent].text)}>{w.label}</span>}
                      </span>
                      <span className="flex items-center gap-2 text-caption text-muted">
                        {j.clientName && <span className="truncate">{j.clientName}</span>}
                        <StatusWord status={statusOf(j)} />
                        <span>{span(jobFrom(j), jobTo(j))}</span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
