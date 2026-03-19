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
import { Badge } from "@/components/ui/badge";

import { RequirePermission } from "@/components/auth/require-permission";
import { useActiveOrganization } from "@/lib/auth-client";

const statusColors: Record<string, string> = {
  ENQUIRY: "bg-gray-400",
  QUOTING: "bg-blue-400",
  QUOTED: "bg-blue-400",
  CONFIRMED: "bg-green-400",
  PREPPING: "bg-amber-400",
  CHECKED_OUT: "bg-purple-500",
  ON_SITE: "bg-purple-500",
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

const badgeColors: Record<string, string> = {
  ENQUIRY: "bg-gray-500/10 text-gray-500 border-gray-500/20",
  QUOTING: "bg-blue-500/10 text-blue-500 border-blue-500/20",
  QUOTED: "bg-blue-500/10 text-blue-500 border-blue-500/20",
  CONFIRMED: "bg-green-500/10 text-green-500 border-green-500/20",
  PREPPING: "bg-amber-500/10 text-amber-500 border-amber-500/20",
  CHECKED_OUT: "bg-purple-500/10 text-purple-500 border-purple-500/20",
  ON_SITE: "bg-purple-500/10 text-purple-500 border-purple-500/20",
  RETURNED: "bg-teal-500/10 text-teal-500 border-teal-500/20",
  COMPLETED: "bg-green-500/10 text-green-500 border-green-500/20",
  INVOICED: "bg-green-500/10 text-green-500 border-green-500/20",
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

/** Intensity of the day based on how many projects overlap */
function dayIntensity(count: number): string {
  if (count === 0) return "";
  if (count === 1) return "bg-blue-500/10 dark:bg-blue-500/15";
  if (count === 2) return "bg-amber-500/10 dark:bg-amber-500/15";
  return "bg-red-500/10 dark:bg-red-500/15";
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
  }, [gridStart.toISOString(), gridEnd.toISOString()]);

  const selectedProjects = selectedDay
    ? getProjectsForDay(projects, selectedDay)
    : [];

  return (
    <RequirePermission resource="asset" action="read">
    <div className="space-y-4">
      {/* Header */}
      <div>
        <h1 className="t-title text-fg">
          Availability Calendar
        </h1>
        <p className="text-fg-3">
          See when projects are active and equipment is out.
        </p>
      </div>

      {/* Month Navigation */}
      <div className="flex items-center gap-3">
        <Button
          variant="outline"
          size="icon"
          onClick={() => setCurrentMonth(addMonths(currentMonth, -1))}
        >
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <h2 className="text-lg font-semibold min-w-[180px] text-center">
          {format(currentMonth, "MMMM yyyy")}
        </h2>
        <Button
          variant="outline"
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

      {/* Legend */}
      <div className="flex items-center gap-4 text-xs text-fg-3">
        <div className="flex items-center gap-1.5">
          <span className="inline-block h-3 w-3 rounded-sm bg-blue-500/15 border border-blue-500/30" />
          1 project
        </div>
        <div className="flex items-center gap-1.5">
          <span className="inline-block h-3 w-3 rounded-sm bg-amber-500/15 border border-amber-500/30" />
          2 projects
        </div>
        <div className="flex items-center gap-1.5">
          <span className="inline-block h-3 w-3 rounded-sm bg-red-500/15 border border-red-500/30" />
          3+ projects
        </div>
      </div>

      <div className="flex gap-4 flex-col lg:flex-row">
        {/* Calendar Grid */}
        <div className="rounded-lg bg-bg-surface surface-ring flex-1">
          <div className="p-2 sm:p-4">
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
        </div>

        {/* Day Detail Panel */}
        <div className="rounded-lg bg-bg-surface surface-ring lg:w-[340px] shrink-0">
          <div className="p-4">
            {selectedDay ? (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <CalendarDays className="h-4 w-4 text-fg-3" />
                    <h3 className="font-semibold">
                      {format(selectedDay, "EEEE, d MMMM yyyy")}
                    </h3>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7"
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
                          <Badge
                            variant="outline"
                            className={`text-[10px] ${badgeColors[p.status] || ""}`}
                          >
                            {statusLabels[p.status] || p.status}
                          </Badge>
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
    </div>
    </RequirePermission>
  );
}
