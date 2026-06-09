"use client";

import { useState, useMemo, useEffect, Suspense } from "react";
import { useQuery } from "@tanstack/react-query";
import { useRouter, useSearchParams } from "next/navigation";
import {
  ChevronLeft,
  ChevronRight,
  CalendarDays,
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
} from "date-fns";

import { getCalendarData, type CalendarProject } from "@/server/availability";
import { Button } from "@/components/ui/button";
import { StatusIndicator } from "@/components/ui/status-indicator";
import { SectionHeader } from "@/components/layout/page-layouts";
import { FadeIn } from "@/components/ui/motion";

import { RequirePermission } from "@/components/auth/require-permission";
import { useActiveOrganization } from "@/lib/auth-client";

const statusColors: Record<string, string> = {
  ENQUIRY: "bg-gray-400",
  QUOTING: "bg-blue-400",
  QUOTED: "bg-blue-400",
  CONFIRMED: "bg-green-400",
  PREPPING: "bg-amber-400",
  CHECKED_OUT: "bg-teal-500",
  ON_SITE: "bg-teal-500",
  RETURNED: "bg-teal-400",
  COMPLETED: "bg-green-400",
  INVOICED: "bg-green-400",
};

const statusLabels: Record<string, string> = {
  ENQUIRY: "Enquiry",
  QUOTING: "Quoting",
  QUOTED: "Quoted",
  CONFIRMED: "Confirmed",
  PREPPING: "Prepping",
  CHECKED_OUT: "Deployed",
  ON_SITE: "On Site",
  RETURNED: "Returned",
  COMPLETED: "Completed",
  INVOICED: "Invoiced",
};


function getProjectsForDay(
  projects: CalendarProject[],
  day: Date
): CalendarProject[] {
  return projects.filter((p) => {
    if (!p.rentalStartDate || !p.rentalEndDate) return false;
    const start = new Date(p.rentalStartDate);
    const end = new Date(p.rentalEndDate);
    start.setHours(0, 0, 0, 0);
    end.setHours(23, 59, 59, 999);
    return isWithinInterval(day, { start, end });
  });
}

/** Intensity of the day based on how many projects overlap — gradient heat stripe */
function dayIntensity(count: number): string {
  if (count === 0) return "";
  if (count === 1)
    return "bg-gradient-to-b from-blue-500/5 to-blue-500/15 dark:from-blue-500/10 dark:to-blue-500/20";
  if (count === 2)
    return "bg-gradient-to-b from-amber-500/5 to-amber-500/15 dark:from-amber-500/10 dark:to-amber-500/20";
  if (count <= 4)
    return "bg-gradient-to-b from-red-500/8 to-red-500/20 dark:from-red-500/12 dark:to-red-500/25";
  return "bg-gradient-to-b from-red-500/15 to-red-500/30 dark:from-red-500/20 dark:to-red-500/35";
}

export default function AvailabilityPageWrapper() {
  return (
    <Suspense>
      <AvailabilityPage />
    </Suspense>
  );
}

function AvailabilityPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { data: activeOrg } = useActiveOrganization();
  const orgId = activeOrg?.id;
  const today = useMemo(() => new Date(), []);

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

  const { data: projects = [], isLoading } = useQuery({
    queryKey: [
      "calendar",
      orgId,
      format(currentMonth, "yyyy-MM"),
    ],
    queryFn: () =>
      getCalendarData({
        startDate: gridStart.toISOString(),
        endDate: gridEnd.toISOString(),
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
  // eslint-disable-next-line react-hooks/use-memo
  }, [gridStart.toISOString(), gridEnd.toISOString()]);

  const selectedProjects = selectedDay
    ? getProjectsForDay(projects, selectedDay)
    : [];

  return (
    <RequirePermission resource="asset" action="read">
    <div className="space-y-4">
      {/* Header — contextual month with overline */}
      <FadeIn>
        <div>
          <p className="t-overline text-primary mb-1">Availability</p>
          <div className="flex items-center gap-3">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setCurrentMonth(addMonths(currentMonth, -1))}
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <h1 className="t-title text-fg min-w-[220px]">
              {format(currentMonth, "MMMM yyyy")}
            </h1>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setCurrentMonth(addMonths(currentMonth, 1))}
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setCurrentMonth(startOfMonth(today));
                setSelectedDay(today);
              }}
            >
              Today
            </Button>
          </div>
          <p className="text-fg-3 mt-1">
            See when projects are active and equipment is out.
          </p>
        </div>
      </FadeIn>

      {/* Legend */}
      <FadeIn delay={0.05}>
        <div className="flex items-center gap-4 text-xs text-fg-3">
          <div className="flex items-center gap-1.5">
            <span className="inline-block h-3 w-3 rounded-sm bg-gradient-to-b from-blue-500/5 to-blue-500/15 border border-blue-500/30" />
            1 project
          </div>
          <div className="flex items-center gap-1.5">
            <span className="inline-block h-3 w-3 rounded-sm bg-gradient-to-b from-amber-500/5 to-amber-500/15 border border-amber-500/30" />
            2 projects
          </div>
          <div className="flex items-center gap-1.5">
            <span className="inline-block h-3 w-3 rounded-sm bg-gradient-to-b from-red-500/8 to-red-500/20 border border-red-500/30" />
            3+ projects
          </div>
        </div>
      </FadeIn>

      <FadeIn delay={0.1}>
        <div className="flex gap-4 flex-col lg:flex-row">
          {/* Calendar Grid — borderless, no surface wrapper */}
          <div className="flex-1">
            {isLoading ? (
              <div className="py-20 text-center text-fg-3">
                Loading...
              </div>
            ) : (
              <div>
                {/* Day headers */}
                <div className="grid grid-cols-7 mb-1">
                  {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map(
                    (d) => (
                      <div
                        key={d}
                        className="text-center text-xs font-medium text-fg-3 py-2"
                      >
                        {d}
                      </div>
                    )
                  )}
                </div>

                {/* Weeks */}
                {weeks.map((week, wi) => (
                  <div key={wi} className="grid grid-cols-7">
                    {week.map((day) => {
                      const inMonth = isSameMonth(day, currentMonth);
                      const isToday = isSameDay(day, today);
                      const isSelected =
                        selectedDay && isSameDay(day, selectedDay);
                      const dayProjects = getProjectsForDay(projects, day);
                      const count = dayProjects.length;

                      return (
                        <button
                          key={day.toISOString()}
                          onClick={() => setSelectedDay(day)}
                          className={`
                            relative flex flex-col items-center justify-start
                            min-h-[60px] sm:min-h-[72px] p-1 border border-border/50
                            transition-colors hover:bg-accent/50 cursor-pointer
                            ${!inMonth ? "opacity-30" : ""}
                            ${isSelected ? "ring-2 ring-primary ring-inset" : ""}
                            ${dayIntensity(count)}
                          `}
                        >
                          <span
                            className={`
                              text-sm tabular-nums leading-none
                              ${isToday ? "bg-primary text-primary-foreground rounded-full w-6 h-6 flex items-center justify-center font-bold" : ""}
                              ${!isToday && inMonth ? "text-fg" : ""}
                            `}
                          >
                            {format(day, "d")}
                          </span>

                          {/* Project dots */}
                          {count > 0 && (
                            <div className="flex flex-wrap gap-0.5 mt-1 justify-center">
                              {dayProjects.slice(0, 4).map((p) => (
                                <span
                                  key={p.id}
                                  className={`inline-block h-1.5 w-1.5 rounded-full ${statusColors[p.status] || "bg-gray-400"}`}
                                />
                              ))}
                              {count > 4 && (
                                <span className="text-[9px] text-fg-3 leading-none">
                                  +{count - 4}
                                </span>
                              )}
                            </div>
                          )}

                          {/* Short project names on larger screens */}
                          <div className="hidden sm:flex flex-col gap-0.5 w-full mt-0.5 overflow-hidden">
                            {dayProjects.slice(0, 2).map((p) => (
                              <div
                                key={p.id}
                                className={`text-[9px] leading-tight truncate rounded px-0.5 ${statusColors[p.status] || "bg-gray-400"} text-white`}
                              >
                                {p.projectNumber}
                              </div>
                            ))}
                            {count > 2 && (
                              <div className="text-[9px] text-fg-3 text-center">
                                +{count - 2} more
                              </div>
                            )}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Day Detail Panel — keeps surface treatment */}
          <div className="rounded-lg bg-bg-surface surface-ring lg:w-[340px] shrink-0">
            <div className="p-4">
              {selectedDay ? (
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <SectionHeader label={format(selectedDay, "EEEE, d MMMM")} />
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 shrink-0 ml-2"
                      onClick={() => setSelectedDay(null)}
                    >
                      <X className="h-3.5 w-3.5" />
                    </Button>
                  </div>

                  {selectedProjects.length === 0 ? (
                    <p className="text-sm text-fg-3 py-4 text-center">
                      No projects on this day.
                    </p>
                  ) : (
                    <div className="space-y-2">
                      <p className="text-xs text-fg-3">
                        {selectedProjects.length} project
                        {selectedProjects.length !== 1 ? "s" : ""} active
                      </p>
                      {selectedProjects.map((p) => (
                        <button
                          key={p.id}
                          onClick={() => router.push(`/projects/${p.id}`)}
                          className="w-full text-left rounded-lg border p-3 hover:bg-accent/50 transition-colors cursor-pointer space-y-1.5"
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className="font-medium text-sm">
                              {p.projectNumber}
                            </span>
                            <StatusIndicator category="project" value={p.status} label={statusLabels[p.status] || p.status} variant="pill" />
                          </div>
                          <p className="text-sm truncate">{p.name}</p>
                          {p.clientName && (
                            <p className="text-xs text-fg-3">
                              {p.clientName}
                            </p>
                          )}
                          <div className="flex items-center justify-between text-xs text-fg-3">
                            <span>
                              {format(new Date(p.rentalStartDate), "d MMM")} —{" "}
                              {format(new Date(p.rentalEndDate), "d MMM")}
                            </span>
                            <span>{p.lineItemCount} items</span>
                          </div>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              ) : (
                <div className="py-8 text-center text-sm text-fg-3">
                  <CalendarDays className="mx-auto mb-2 h-8 w-8 opacity-50" />
                  Click a day to see project details.
                </div>
              )}
            </div>
          </div>
        </div>
      </FadeIn>
    </div>
    </RequirePermission>
  );
}
