"use client";

import { useMemo } from "react";
import { useFocusPolledQuery } from "@/hooks/use-focus-polled-query";
import { api } from "../../convex/_generated/api";
import { resolvePrimaryDateRange, type DateLike } from "@/lib/project-dates";

export type DayRailHue = "purple" | "green" | "blue";

export interface DayRailEntry {
  key: string;
  hue: DayRailHue;
  time: string | null;
  title: string;
  subtitle: string;
  href: string;
  sortKey: number;
}

interface MyProjectForRail {
  id: string;
  name: string;
  projectNumber: string;
  rentalStartDate: DateLike;
  rentalEndDate: DateLike;
}

const DAY_MS = 24 * 60 * 60 * 1000;

function isToday(dateMs: number | null | undefined, startOfToday: number): boolean {
  return dateMs != null && dateMs >= startOfToday && dateMs < startOfToday + DAY_MS;
}

function projectDatesToday(project: MyProjectForRail, startOfToday: number): DayRailEntry[] {
  const dates = resolvePrimaryDateRange(project);
  const out: DayRailEntry[] = [];
  const start = dates.start ? new Date(dates.start).getTime() : null;
  const end = dates.end ? new Date(dates.end).getTime() : null;
  if (isToday(start, startOfToday)) {
    out.push({
      key: `proj-start-${project.id}`, hue: "blue", time: null,
      title: `${project.name} starts today`, subtitle: "", href: `/projects/${project.id}`, sortKey: 0,
    });
  }
  if (isToday(end, startOfToday) && end !== start) {
    out.push({
      key: `proj-end-${project.id}`, hue: "blue", time: null,
      title: `${project.name} ends today`, subtitle: "", href: `/projects/${project.id}`, sortKey: 1,
    });
  }
  return out;
}

function timeToMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return (Number.isFinite(h) ? h : 0) * 60 + (Number.isFinite(m) ? m : 0);
}

/**
 * Today's day rail (work-layer phase 0.5, #1242) — crew shifts, project
 * start/end and services scheduled today, module-hued per DESIGN.md §3.7
 * (crew purple, services green, project windows blue). One-shot, refreshed
 * on focus + a slow interval (see useFocusPolledQuery) — never a live
 * subscription (§10.7/R13). Composed entirely from existing readers:
 * crewDashboard.upcomingShifts (org-wide, scoped to projects I manage —
 * upcomingShifts doesn't echo the assignment's crewMemberId, only the
 * resolved name, so "my day" here means the PM sense: shifts on MY jobs) and
 * projectServices.list (org-wide, filtered to my projects + today client-side).
 */
export function useTodayDayRail(
  orgId: string | undefined,
  now: number,
  myProjects: MyProjectForRail[] | undefined,
): { entries: DayRailEntry[] | undefined; asOf: number | undefined; refresh: () => void } {
  const startOfToday = useMemo(() => new Date(now).setHours(0, 0, 0, 0), [now]);

  const shifts = useFocusPolledQuery(api.crewDashboard.upcomingShifts, orgId ? { orgId, nowMs: now } : "skip");
  const services = useFocusPolledQuery(api.projectServices.list, orgId ? { orgId } : "skip");

  const myProjectIds = useMemo(() => new Set((myProjects ?? []).map((p) => p.id)), [myProjects]);
  // upcomingShifts's project join carries {name, projectNumber}, not the id —
  // match on projectNumber (org-unique) to scope the rail to shifts on jobs I manage.
  const myProjectNumbers = useMemo(() => new Set((myProjects ?? []).map((p) => p.projectNumber)), [myProjects]);

  const entries = useMemo<DayRailEntry[] | undefined>(() => {
    if (!orgId || shifts.data === undefined || services.data === undefined) return undefined;
    const out: DayRailEntry[] = [];

    for (const s of shifts.data) {
      const project = s.assignment?.project;
      if (!project || !myProjectNumbers.has(project.projectNumber)) continue;
      const shiftDateMs = s.date ? new Date(s.date).getTime() : null;
      if (!isToday(shiftDateMs, startOfToday)) continue;
      out.push({
        key: `shift-${s.id}`,
        hue: "purple",
        time: s.callTime ?? null,
        title: project.name,
        subtitle: [s.assignment?.crewMember ? `${s.assignment.crewMember.firstName} ${s.assignment.crewMember.lastName}` : null, s.location].filter(Boolean).join(" · "),
        href: "/crew/planner",
        sortKey: 2 * 24 * 60 + (s.callTime ? timeToMinutes(s.callTime) : 0),
      });
    }

    for (const s of services.data) {
      if (!myProjectIds.has(s.projectId)) continue;
      if (!isToday(s.date ?? null, startOfToday) && !isToday(s.endDate ?? null, startOfToday)) continue;
      out.push({
        key: `service-${s.id}`,
        hue: "green",
        time: s.startTime ?? s.scheduledTime ?? null,
        title: s.title,
        subtitle: s.type,
        href: `/projects/${s.projectId}`,
        sortKey: s.startTime ? timeToMinutes(s.startTime) : 12 * 60,
      });
    }

    for (const p of myProjects ?? []) out.push(...projectDatesToday(p, startOfToday));

    return out.sort((a, b) => a.sortKey - b.sortKey);
  }, [orgId, shifts.data, services.data, myProjects, myProjectIds, myProjectNumbers, startOfToday]);

  return {
    entries,
    asOf: shifts.asOf && services.asOf ? Math.min(shifts.asOf, services.asOf) : undefined,
    refresh: () => {
      shifts.refresh();
      services.refresh();
    },
  };
}
