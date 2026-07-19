"use client";
// use-client: live Convex data via client subscription (useQuery) (R-8.1.1)

import { useState, useMemo, useEffect, Suspense } from "react";
import { useServerQuery } from "@/hooks/use-server-query";
import { useRouter, useSearchParams } from "next/navigation";
import {
  ChevronLeft,
  ChevronRight,
  CalendarDays,
  CalendarRange,
  List,
  X,
} from "lucide-react";
import {
  format,
  startOfMonth,
  endOfMonth,
  startOfWeek,
  endOfWeek,
  addMonths,
  addDays,
  isSameMonth,
  isSameDay,
  isWithinInterval,
  isAfter,
  isBefore,
  max as maxDate,
  min as minDate,
  differenceInCalendarDays,
} from "date-fns";

import { useConvex, useConvexAuth } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import type { CalendarProject } from "@/lib/availability-types";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusIndicator } from "@/components/ui/status-indicator";
import { SectionHeader } from "@/components/layout/page-layouts";
import { FadeIn } from "@/components/ui/motion";
import { cn } from "@/lib/utils";

import { getStatusColor } from "@/lib/status-colors";
import { projectStatusLabels } from "@/lib/status-labels";

import { RequirePermission } from "@/components/auth/require-permission";
import { useActiveOrganization } from "@/lib/auth-client";

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/** Normalise a project's rental window to whole-day local bounds. */
function projectBounds(p: CalendarProject): { start: Date; end: Date } | null {
  if (!p.rentalStartDate || !p.rentalEndDate) return null;
  const start = new Date(p.rentalStartDate);
  const end = new Date(p.rentalEndDate);
  start.setHours(0, 0, 0, 0);
  end.setHours(23, 59, 59, 999);
  return { start, end };
}

function getProjectsForDay(
  projects: CalendarProject[],
  day: Date,
): CalendarProject[] {
  return projects.filter((p) => {
    const b = projectBounds(p);
    if (!b) return false;
    return isWithinInterval(day, b);
  });
}

/**
 * Busy-day intensity tint (RVLT soft fills, no gradients).
 * 0 → none, 1–2 → blue/warn soft, 3+ → red soft (heaviest).
 */
function dayIntensity(count: number): string {
  if (count === 0) return "";
  if (count === 1) return "bg-blue-soft/40";
  if (count === 2) return "bg-warn-soft/50";
  if (count <= 4) return "bg-red-soft/60";
  return "bg-red-soft";
}

/**
 * A project's bar within a single week row: which column it starts at (0–6),
 * how many columns it spans, and whether the true rental start/end fall inside
 * this week (rounded cap) or continue past the week edge (square cap).
 */
interface WeekBar {
  project: CalendarProject;
  colStart: number; // 0-indexed grid column
  span: number; // number of columns
  capStart: boolean; // true rental start lands in this week
  capEnd: boolean; // true rental end lands in this week
  lane: number; // vertical lane within the week
}

/**
 * Lay projects out as continuous spanning bars per week (Wrike/Asana timeline
 * pattern). Each project gets a stable lane assignment for the whole month so a
 * bar stays on the same row as it crosses week boundaries; lanes pack greedily
 * by project order (already sorted by start date upstream).
 */
function buildWeekBars(
  weeks: Date[][],
  projects: CalendarProject[],
): { bars: WeekBar[][]; laneCount: number } {
  // Stable lane per project across the whole month grid.
  const laneOf = new Map<string, number>();
  // Track, per lane, the last day index (across the flattened grid) it's busy to.
  const laneEnds: number[] = [];

  const gridStart = weeks[0][0];

  const withBounds = projects
    .map((p) => ({ p, b: projectBounds(p) }))
    .filter((x): x is { p: CalendarProject; b: { start: Date; end: Date } } => x.b !== null)
    .sort((a, b) => a.b.start.getTime() - b.b.start.getTime());

  for (const { p, b } of withBounds) {
    const startIdx = Math.max(0, differenceInCalendarDays(b.start, gridStart));
    const endIdx = differenceInCalendarDays(b.end, gridStart);
    let lane = laneEnds.findIndex((end) => end < startIdx);
    if (lane === -1) {
      lane = laneEnds.length;
      laneEnds.push(endIdx);
    } else {
      laneEnds[lane] = endIdx;
    }
    laneOf.set(p.id, lane);
  }

  const laneCount = laneEnds.length;

  const bars: WeekBar[][] = weeks.map((week) => {
    const weekStart = week[0];
    const weekEnd = week[6];
    const rowBars: WeekBar[] = [];

    for (const { p, b } of withBounds) {
      // Does this project intersect this week at all?
      if (isAfter(b.start, weekEnd) || isBefore(b.end, weekStart)) continue;

      const clampedStart = maxDate([b.start, weekStart]);
      const clampedEnd = minDate([b.end, weekEnd]);
      const colStart = differenceInCalendarDays(clampedStart, weekStart);
      const span = differenceInCalendarDays(clampedEnd, clampedStart) + 1;

      rowBars.push({
        project: p,
        colStart: Math.max(0, Math.min(6, colStart)),
        span: Math.max(1, Math.min(7 - Math.max(0, colStart), span)),
        capStart: !isBefore(b.start, weekStart),
        capEnd: !isAfter(b.end, weekEnd),
        lane: laneOf.get(p.id) ?? 0,
      });
    }

    return rowBars;
  });

  return { bars, laneCount };
}

export default function AvailabilityPageWrapper() {
  return (
    <Suspense>
      <AvailabilityPage />
    </Suspense>
  );
}

type ViewMode = "month" | "agenda";

function AvailabilityPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const convex = useConvex();
  const { isAuthenticated } = useConvexAuth();
  const { data: activeOrg } = useActiveOrganization();
  const orgId = activeOrg?.id;
  const today = useMemo(() => new Date(), []);
  const [view, setView] = useState<ViewMode>("month");

  // Parse ?date=YYYY-MM-DD and ?search=term query params for deep-linking from search
  const initialDate = useMemo(() => {
    const dateParam = searchParams.get("date");
    if (!dateParam) return null;
    // Parse as local date to avoid UTC off-by-one in positive UTC offsets
    const parts = dateParam.split("-").map(Number);
    if (parts.length !== 3 || parts.some(isNaN)) return null;
    const parsed = new Date(parts[0], parts[1] - 1, parts[2]);
    return isNaN(parsed.getTime()) ? null : parsed;
  }, [searchParams]);

  const [currentMonth, setCurrentMonth] = useState(startOfMonth(initialDate || today));
  const [selectedDay, setSelectedDay] = useState<Date | null>(initialDate);

  // Update when navigating to same page with a new date
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const initialDateTime = initialDate?.getTime();
  useEffect(() => {
    if (initialDate) {
      setCurrentMonth(startOfMonth(initialDate));
      setSelectedDay(initialDate);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialDateTime]);

  // Query range: full calendar grid (might include days from prev/next months)
  const gridStart = startOfWeek(startOfMonth(currentMonth), { weekStartsOn: 1 });
  const gridEnd = endOfWeek(endOfMonth(currentMonth), { weekStartsOn: 1 });

  const { data: projects = [], isLoading } = useServerQuery({
    queryKey: ["calendar", orgId, format(currentMonth, "yyyy-MM")],
    enabled: !!orgId && isAuthenticated,
    queryFn: () =>
      convex.query(api.availability.calendarData, {
        orgId: orgId!,
        startMs: gridStart.getTime(),
        endMs: gridEnd.getTime(),
      }),
  });

  // Build the 6-week grid of days
  const weeks = useMemo(() => {
    const result: Date[][] = [];
    let day = gridStart;
    while (day <= gridEnd) {
      const week: Date[] = [];
      for (let i = 0; i < 7; i++) {
        week.push(day);
        day = addDays(day, 1);
      }
      result.push(week);
    }
    return result;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gridStart.toISOString(), gridEnd.toISOString()]);

  const { bars: weekBars } = useMemo(
    () => buildWeekBars(weeks, projects),
    [weeks, projects],
  );

  const selectedProjects = selectedDay
    ? getProjectsForDay(projects, selectedDay)
    : [];

  // Agenda view: days in the visible month that actually have projects.
  const agendaDays = useMemo(() => {
    if (view !== "agenda") return [];
    const monthDays: Date[] = [];
    let d = startOfMonth(currentMonth);
    const monthEnd = endOfMonth(currentMonth);
    while (d <= monthEnd) {
      monthDays.push(d);
      d = addDays(d, 1);
    }
    return monthDays
      .map((day) => ({ day, projects: getProjectsForDay(projects, day) }))
      .filter((g) => g.projects.length > 0);
  }, [view, currentMonth, projects]);

  return (
    <RequirePermission resource="asset" action="read">
      <div className="space-y-5">
        {/* ── Header ──────────────────────────────────────────────── */}
        <FadeIn>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <p className="t-overline text-muted mb-1">Schedule</p>
              <div className="flex flex-wrap items-center gap-2">
                {/* The 200px floor plus the 44px month-nav buttons overflows 375px. */}
                <h1 className="t-title text-ink sm:min-w-[200px]">
                  {format(currentMonth, "MMMM yyyy")}
                </h1>
                <div className="flex items-center gap-1">
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label="Previous month"
                    className="size-11 sm:size-9"
                    onClick={() => setCurrentMonth(addMonths(currentMonth, -1))}
                  >
                    <ChevronLeft className="size-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label="Next month"
                    className="size-11 sm:size-9"
                    onClick={() => setCurrentMonth(addMonths(currentMonth, 1))}
                  >
                    <ChevronRight className="size-4" />
                  </Button>
                  <Button
                    variant="line"
                    size="sm"
                    onClick={() => {
                      setCurrentMonth(startOfMonth(today));
                      setSelectedDay(today);
                    }}
                  >
                    Today
                  </Button>
                </div>
              </div>
              <p className="t-small text-muted mt-1.5">
                When projects are live and gear is committed.
              </p>
            </div>

            {/* View toggle — month timeline vs agenda list */}
            <div className="inline-flex items-center gap-1 rounded-[var(--r)] border border-line-2 bg-card p-1 shadow-[var(--sh-card)]">
              <ViewToggleButton
                active={view === "month"}
                onClick={() => setView("month")}
                icon={<CalendarRange className="size-4" />}
                label="Timeline"
              />
              <ViewToggleButton
                active={view === "agenda"}
                onClick={() => setView("agenda")}
                icon={<List className="size-4" />}
                label="Agenda"
              />
            </div>
          </div>
        </FadeIn>

        <FadeIn delay={0.06}>
          <div className="flex flex-col gap-5 lg:flex-row">
            {/* ── Main column ─────────────────────────────────────── */}
            <div className="min-w-0 flex-1 space-y-3">
              {/* Legend */}
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 t-micro text-muted">
                <span className="text-faint">Busy days</span>
                <LegendSwatch className="bg-blue-soft/40 border-blue/30" label="1 project" />
                <LegendSwatch className="bg-warn-soft/50 border-warn/30" label="2 projects" />
                <LegendSwatch className="bg-red-soft border-red/40" label="3+ projects" />
              </div>

              {isLoading ? (
                <CalendarSkeleton />
              ) : view === "month" ? (
                <MonthGrid
                  weeks={weeks}
                  weekBars={weekBars}
                  projects={projects}
                  currentMonth={currentMonth}
                  today={today}
                  selectedDay={selectedDay}
                  onSelectDay={setSelectedDay}
                  onSelectProject={(p) => setSelectedDay(projectBounds(p)?.start ?? today)}
                />
              ) : (
                <AgendaView
                  groups={agendaDays}
                  today={today}
                  onOpenProject={(id) => router.push(`/projects/${id}`)}
                />
              )}
            </div>

            {/* ── Day detail panel ────────────────────────────────── */}
            <div className="lg:w-[340px] lg:shrink-0">
              <div className="rounded-[var(--r-lg)] border border-line-2 bg-card shadow-[var(--sh-card)] lg:sticky lg:top-4">
                <div className="p-4">
                  {selectedDay ? (
                    <div className="space-y-3">
                      <div className="flex items-start justify-between gap-2">
                        <SectionHeader label={format(selectedDay, "EEEE, d MMMM")} />
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label="Close day detail"
                          className="touch-target -mt-1 -mr-1 size-7 shrink-0"
                          onClick={() => setSelectedDay(null)}
                        >
                          <X className="size-3.5" />
                        </Button>
                      </div>

                      {selectedProjects.length === 0 ? (
                        <div className="flex flex-col items-center gap-2 py-8 text-center">
                          <div className="grid size-11 place-items-center rounded-[10px] border-2 border-line-2 text-faint shadow-[var(--sh-card)]">
                            <CalendarDays className="size-5" />
                          </div>
                          <p className="t-micro text-muted">Nothing booked this day.</p>
                        </div>
                      ) : (
                        <div className="space-y-2">
                          <p className="t-micro text-muted">
                            {selectedProjects.length} project
                            {selectedProjects.length !== 1 ? "s" : ""} live
                          </p>
                          {selectedProjects.map((p) => (
                            <DayProjectCard
                              key={p.id}
                              project={p}
                              onClick={() => router.push(`/projects/${p.id}`)}
                            />
                          ))}
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="flex flex-col items-center gap-2 py-10 text-center">
                      <div className="grid size-11 place-items-center rounded-[10px] border-2 border-line-2 text-faint shadow-[var(--sh-card)]">
                        <CalendarDays className="size-5" />
                      </div>
                      <p className="t-heading text-ink">Pick a day</p>
                      <p className="t-micro text-muted">
                        Tap a bar or a date to see what&apos;s on.
                      </p>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </FadeIn>
      </div>
    </RequirePermission>
  );
}

/* ── View toggle button ──────────────────────────────────────────── */

function ViewToggleButton({
  active,
  onClick,
  icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "inline-flex h-8 items-center gap-1.5 rounded-[10px] px-3 t-small transition-colors",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red focus-visible:ring-offset-2 focus-visible:ring-offset-paper",
        active
          ? "bg-elev text-ink shadow-[var(--sh-card)]"
          : "text-muted hover:text-ink",
      )}
    >
      {icon}
      {label}
    </button>
  );
}

function LegendSwatch({ className, label }: { className: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={cn("inline-block size-3 rounded-[4px] border", className)} />
      {label}
    </span>
  );
}

/* ── Month grid with spanning bars (Wrike / Asana timeline pattern) ── */

const BAR_H = 20; // px height of a project bar
const BAR_GAP = 3; // px vertical gap between lanes
const DAYNUM_H = 26; // px reserved for the day-number row
const MIN_LANES = 1;

function MonthGrid({
  weeks,
  weekBars,
  projects,
  currentMonth,
  today,
  selectedDay,
  onSelectDay,
  onSelectProject,
}: {
  weeks: Date[][];
  weekBars: WeekBar[][];
  projects: CalendarProject[];
  currentMonth: Date;
  today: Date;
  selectedDay: Date | null;
  onSelectDay: (d: Date) => void;
  onSelectProject: (p: CalendarProject) => void;
}) {
  return (
    <div className="overflow-hidden rounded-[var(--r-lg)] border border-line-2 bg-card shadow-[var(--sh-card)]">
      {/* Weekday header */}
      <div className="grid grid-cols-7 border-b border-line">
        {WEEKDAYS.map((d) => (
          <div key={d} className="py-2 text-center t-micro text-muted">
            {d}
          </div>
        ))}
      </div>

      {/* Week rows */}
      <div>
        {weeks.map((week, wi) => {
          const rowBars = weekBars[wi];
          const lanesUsed =
            rowBars.length > 0
              ? Math.max(...rowBars.map((b) => b.lane)) + 1
              : 0;
          const visibleLanes = Math.min(lanesUsed, 3);
          const rowHeight =
            DAYNUM_H +
            Math.max(MIN_LANES, visibleLanes) * (BAR_H + BAR_GAP) +
            6;

          return (
            <div
              key={wi}
              className="relative border-b border-line last:border-b-0"
              style={{ minHeight: rowHeight }}
            >
              {/* Day cells (background: intensity tint, day number, click target) */}
              <div className="grid grid-cols-7">
                {week.map((day) => {
                  const inMonth = isSameMonth(day, currentMonth);
                  const isToday = isSameDay(day, today);
                  const isSelected = selectedDay && isSameDay(day, selectedDay);
                  const count = getProjectsForDay(projects, day).length;
                  return (
                    <button
                      key={day.toISOString()}
                      type="button"
                      onClick={() => onSelectDay(day)}
                      style={{ minHeight: rowHeight }}
                      className={cn(
                        "group relative border-r border-line text-left transition-colors last:border-r-0",
                        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-red",
                        "hover:bg-paper-2/60",
                        dayIntensity(count),
                        !inMonth && "opacity-40",
                        isSelected && "ring-2 ring-inset ring-red",
                      )}
                    >
                      <span className="absolute left-1.5 top-1.5 flex items-center gap-1">
                        <span
                          className={cn(
                            "grid size-[22px] place-items-center rounded-full t-mono text-[12px] leading-none tabular-nums",
                            isToday
                              ? "bg-red font-semibold text-white"
                              : inMonth
                                ? "text-ink-2"
                                : "text-faint",
                          )}
                        >
                          {format(day, "d")}
                        </span>
                      </span>
                    </button>
                  );
                })}
              </div>

              {/* Spanning project bars overlay */}
              <div
                className="pointer-events-none absolute inset-x-0"
                style={{ top: DAYNUM_H }}
              >
                {rowBars
                  .filter((b) => b.lane < 3)
                  .map((bar) => {
                    const colors = getStatusColor("project", bar.project.status);
                    return (
                      <button
                        key={`${bar.project.id}-${wi}`}
                        type="button"
                        title={`${bar.project.projectNumber} · ${bar.project.name}`}
                        onClick={() => onSelectProject(bar.project)}
                        className={cn(
                          "pointer-events-auto absolute flex items-center gap-1.5 overflow-hidden px-2 t-micro font-medium text-ink",
                          "border border-line-2/60 bg-card/40 backdrop-blur-[1px] transition-[transform,box-shadow]",
                          "hover:z-10 hover:-translate-y-px hover:shadow-[var(--sh-card)]",
                          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red",
                          bar.capStart ? "rounded-l-[7px]" : "rounded-l-none border-l-0",
                          bar.capEnd ? "rounded-r-[7px]" : "rounded-r-none border-r-0",
                        )}
                        style={{
                          left: `calc(${(bar.colStart / 7) * 100}% + 3px)`,
                          width: `calc(${(bar.span / 7) * 100}% - 6px)`,
                          top: bar.lane * (BAR_H + BAR_GAP),
                          height: BAR_H,
                        }}
                      >
                        {/* status colour rail */}
                        <span
                          className={cn(
                            "h-full w-1 shrink-0 rounded-full",
                            colors.dot,
                          )}
                        />
                        <span className="t-mono text-[10px] text-ink-2">
                          {bar.project.projectNumber}
                        </span>
                        <span className="truncate text-ink-2">
                          {bar.project.name}
                        </span>
                      </button>
                    );
                  })}

                {/* "+N more" overflow per day when lanes exceed 3 */}
                <WeekOverflow week={week} projects={projects} onSelectDay={onSelectDay} />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** Shows a "+N" chip on days whose project count exceeds the 3 visible lanes. */
function WeekOverflow({
  week,
  projects,
  onSelectDay,
}: {
  week: Date[];
  projects: CalendarProject[];
  onSelectDay: (d: Date) => void;
}) {
  return (
    <>
      {week.map((day, ci) => {
        const count = getProjectsForDay(projects, day).length;
        if (count <= 3) return null;
        return (
          <button
            key={`ovf-${day.toISOString()}`}
            type="button"
            onClick={() => onSelectDay(day)}
            className={cn(
              "pointer-events-auto absolute t-micro text-muted hover:text-ink",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red rounded-[6px] px-1",
            )}
            style={{
              left: `calc(${(ci / 7) * 100}% + 4px)`,
              top: 3 * (BAR_H + BAR_GAP) + 1,
            }}
          >
            +{count - 3} more
          </button>
        );
      })}
    </>
  );
}

/* ── Agenda view (grouped-by-day list) ───────────────────────────── */

function AgendaView({
  groups,
  today,
  onOpenProject,
}: {
  groups: { day: Date; projects: CalendarProject[] }[];
  today: Date;
  onOpenProject: (id: string) => void;
}) {
  if (groups.length === 0) {
    return (
      <div className="flex flex-col items-center gap-3 rounded-[var(--r-lg)] border border-line-2 bg-card py-16 text-center shadow-[var(--sh-card)]">
        <div className="grid size-11 place-items-center rounded-[10px] border-2 border-line-2 text-faint shadow-[var(--sh-card)]">
          <CalendarDays className="size-5" />
        </div>
        <div>
          <p className="t-heading text-ink">No projects this month</p>
          <p className="t-micro text-muted">Nothing&apos;s booked in. Quiet month.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {groups.map(({ day, projects: dayProjects }) => {
        const isToday = isSameDay(day, today);
        return (
          <div
            key={day.toISOString()}
            className="overflow-hidden rounded-[var(--r-lg)] border border-line-2 bg-card shadow-[var(--sh-card)]"
          >
            <div
              className={cn(
                "flex items-center gap-3 border-b border-line px-4 py-2.5",
                isToday && "bg-red-soft/40",
              )}
            >
              <span
                className={cn(
                  "grid size-9 shrink-0 flex-col place-items-center rounded-[10px] leading-none",
                  isToday ? "bg-red text-white" : "bg-elev text-ink",
                )}
              >
                <span className="t-overline">{format(day, "EEE")}</span>
                <span className="t-mono text-[14px] font-semibold tabular-nums">
                  {format(day, "d")}
                </span>
              </span>
              <div className="min-w-0">
                <p className="t-small text-ink">{format(day, "EEEE, d MMMM")}</p>
                <p className="t-micro text-muted">
                  {dayProjects.length} project{dayProjects.length !== 1 ? "s" : ""} live
                </p>
              </div>
            </div>
            <div className="divide-y divide-line">
              {dayProjects.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => onOpenProject(p.id)}
                  className={cn(
                    "group relative flex w-full items-center gap-3 px-4 py-3 text-left transition-colors",
                    "hover:bg-paper-2/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-red",
                  )}
                >
                  {/* left-edge status rail */}
                  <span
                    className={cn(
                      "absolute inset-y-0 left-0 w-[3px] opacity-0 transition-opacity group-hover:opacity-100",
                      getStatusColor("project", p.status).dot,
                    )}
                  />
                  <span
                    className={cn(
                      "size-2 shrink-0 rounded-full",
                      getStatusColor("project", p.status).dot,
                    )}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="t-mono text-[11px] text-muted">
                        {p.projectNumber}
                      </span>
                      <span className="truncate t-small text-ink">{p.name}</span>
                    </div>
                    <div className="mt-0.5 flex items-center gap-2 t-micro text-muted">
                      {p.clientName && <span className="truncate">{p.clientName}</span>}
                      <span className="text-faint">·</span>
                      <span className="tabular-nums">
                        {format(new Date(p.rentalStartDate), "d MMM")} –{" "}
                        {format(new Date(p.rentalEndDate), "d MMM")}
                      </span>
                    </div>
                  </div>
                  <StatusIndicator
                    category="project"
                    value={p.status}
                    label={projectStatusLabels[p.status] || p.status}
                    variant="pill"
                  />
                </button>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* ── Day-detail project card ──────────────────────────────────────── */

function DayProjectCard({
  project: p,
  onClick,
}: {
  project: CalendarProject;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "group relative w-full space-y-1.5 overflow-hidden rounded-[var(--r)] border border-line-2 bg-paper-2 p-3 text-left transition-[transform,box-shadow]",
        "hover:-translate-y-px hover:shadow-[var(--sh-card)]",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red focus-visible:ring-offset-2 focus-visible:ring-offset-card",
      )}
    >
      <span
        className={cn(
          "absolute inset-y-0 left-0 w-1",
          getStatusColor("project", p.status).dot,
        )}
      />
      <div className="flex items-center justify-between gap-2 pl-1.5">
        <span className="t-mono text-[11px] text-muted">{p.projectNumber}</span>
        <StatusIndicator
          category="project"
          value={p.status}
          label={projectStatusLabels[p.status] || p.status}
          variant="pill"
        />
      </div>
      <p className="truncate pl-1.5 t-small text-ink">{p.name}</p>
      {p.clientName && (
        <p className="truncate pl-1.5 t-micro text-muted">{p.clientName}</p>
      )}
      <div className="flex items-center justify-between pl-1.5 t-micro text-muted">
        <span className="tabular-nums">
          {format(new Date(p.rentalStartDate), "d MMM")} –{" "}
          {format(new Date(p.rentalEndDate), "d MMM")}
        </span>
        <span className="t-mono">{p.lineItemCount} items</span>
      </div>
    </button>
  );
}

/* ── Loading skeleton ─────────────────────────────────────────────── */

function CalendarSkeleton() {
  return (
    <div className="overflow-hidden rounded-[var(--r-lg)] border border-line-2 bg-card shadow-[var(--sh-card)]">
      <div className="grid grid-cols-7 border-b border-line">
        {WEEKDAYS.map((d) => (
          <div key={d} className="py-2 text-center t-micro text-muted">
            {d}
          </div>
        ))}
      </div>
      {Array.from({ length: 5 }).map((_, r) => (
        <div
          key={r}
          className="grid grid-cols-7 border-b border-line last:border-b-0"
        >
          {Array.from({ length: 7 }).map((_, c) => (
            <div key={c} className="min-h-[84px] border-r border-line p-1.5 last:border-r-0">
              <Skeleton className="size-[22px] rounded-full" />
              {(r + c) % 3 === 0 && <Skeleton className="mt-2 h-[18px] w-full rounded-[7px]" />}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
