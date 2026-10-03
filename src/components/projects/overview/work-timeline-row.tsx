"use client";

import { useMemo } from "react";
import { useAuthedQuery } from "@/hooks/use-authed-query";
import { useProjectCrew } from "@/hooks/use-project-crew";
import { useProjectWorkData } from "@/hooks/use-project-work-data";
import { useProjectDetail } from "@/hooks/use-project-detail";
import { api } from "../../../../convex/_generated/api";
import { Panel } from "@/components/ui/card";
import { cn } from "@/lib/utils";

/**
 * Overview → Timeline row (#1244, design §8.3): "one week strip with rows
 * for gear window, services, crew, and work." Read-only in this phase —
 * drag-to-reschedule is a later agenda-engine phase (design §8.3/§10.7).
 *
 * A plain 7-day strip, not a full calendar grid — same reasoning as the Work
 * tab's calendar view: no date-grid/calendar library exists in the tree, and
 * a project's own timeline doesn't need one to answer "what's on which day
 * this week". The week shown is the CURRENT calendar week (Mon–Sun, local
 * time) — a fixed anchor rather than "the project's own week" so it reads
 * the same way regardless of where in the job's life you're looking at it.
 */

interface DayCell {
  key: string; // YYYY-MM-DD
  label: string; // "Mon 15"
  isToday: boolean;
}

function startOfWeek(d: Date): Date {
  const day = d.getDay(); // 0 Sun..6 Sat
  const diff = (day === 0 ? -6 : 1) - day; // Monday-start
  const start = new Date(d);
  start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() + diff);
  return start;
}

function buildWeek(): DayCell[] {
  const start = startOfWeek(new Date());
  const todayKey = new Date().toISOString().slice(0, 10);
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(start);
    d.setDate(d.getDate() + i);
    const key = d.toISOString().slice(0, 10);
    return { key, label: d.toLocaleDateString(undefined, { weekday: "short", day: "numeric" }), isToday: key === todayKey };
  });
}

function dayKeyFromMs(ms: number | null | undefined): string | null {
  return ms != null ? new Date(ms).toISOString().slice(0, 10) : null;
}

function TimelineTrack({ label, activeDays, dotClassName }: { label: string; activeDays: Set<string>; dotClassName: string }) {
  const week = useMemo(() => buildWeek(), []);
  return (
    <div className="grid grid-cols-[80px_repeat(7,1fr)] items-center gap-1 px-4 py-1.5">
      <span className="text-caption text-muted">{label}</span>
      {week.map((day) => (
        <div key={day.key} className="flex h-5 items-center justify-center">
          {activeDays.has(day.key) && <span className={cn("size-2 rounded-full", dotClassName)} aria-hidden />}
        </div>
      ))}
    </div>
  );
}

export function WorkTimelineRow({ projectId, orgId }: { projectId: string; orgId: string }) {
  const week = useMemo(() => buildWeek(), []);
  const { data: project } = useProjectDetail(projectId);
  const services = useAuthedQuery(api.projectServices.listByProject, { projectId, orgId }) as
    | { date?: number; endDate?: number }[]
    | undefined;
  const { data: crew } = useProjectCrew(projectId, orgId) as {
    data: { shifts?: { date?: string | null }[] }[] | undefined;
  };
  const { tasks } = useProjectWorkData(projectId);

  const weekKeys = new Set(week.map((d) => d.key));

  const gearDays = useMemo(() => {
    const start = project?.rentalStartDate as number | null | undefined;
    const end = project?.rentalEndDate as number | null | undefined;
    if (!start) return new Set<string>();
    const days = new Set<string>();
    const from = new Date(start);
    from.setHours(0, 0, 0, 0);
    const to = end ? new Date(end) : from;
    for (let d = new Date(from); d <= to; d.setDate(d.getDate() + 1)) {
      const key = d.toISOString().slice(0, 10);
      if (weekKeys.has(key)) days.add(key);
    }
    return days;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project?.rentalStartDate, project?.rentalEndDate]);

  const serviceDays = useMemo(() => {
    const days = new Set<string>();
    for (const s of services ?? []) {
      const key = dayKeyFromMs(s.date);
      if (key && weekKeys.has(key)) days.add(key);
    }
    return days;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [services]);

  const crewDays = useMemo(() => {
    const days = new Set<string>();
    for (const a of crew ?? []) {
      for (const shift of a.shifts ?? []) {
        const key = shift.date ? String(shift.date).slice(0, 10) : null;
        if (key && weekKeys.has(key)) days.add(key);
      }
    }
    return days;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [crew]);

  const workDays = useMemo(() => {
    const days = new Set<string>();
    for (const t of tasks) {
      const key = t.dueDate ? t.dueDate.slice(0, 10) : null;
      if (key && weekKeys.has(key)) days.add(key);
    }
    return days;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tasks]);

  const hasAnything = gearDays.size + serviceDays.size + crewDays.size + workDays.size > 0;

  return (
    <Panel padding="default" className="p-0">
      <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-3">
        <h2 className="text-card-title font-bold tracking-tight text-ink">Timeline</h2>
        <span className="t-micro text-muted">This week</span>
      </div>
      <div className="grid grid-cols-[80px_repeat(7,1fr)] gap-1 border-b border-line px-4 py-1.5">
        <span />
        {week.map((day) => (
          <span
            key={day.key}
            className={cn("text-center text-badge font-medium", day.isToday ? "text-ink" : "text-faint")}
          >
            {day.label}
          </span>
        ))}
      </div>
      {hasAnything ? (
        <div className="py-1">
          <TimelineTrack label="Gear window" activeDays={gearDays} dotClassName="bg-blue" />
          <TimelineTrack label="Services" activeDays={serviceDays} dotClassName="bg-ok" />
          <TimelineTrack label="Crew" activeDays={crewDays} dotClassName="bg-rep" />
          <TimelineTrack label="Work" activeDays={workDays} dotClassName="bg-warn" />
        </div>
      ) : (
        <p className="px-4 py-3 text-caption text-muted">Nothing scheduled this week.</p>
      )}
    </Panel>
  );
}
