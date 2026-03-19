"use client";

import { useState, useMemo, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import {
  ChevronLeft,
  ChevronRight,
  CalendarDays,
  List,
  LayoutGrid,
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

import {
  getModelBookings,
  getAssetBookings,
  getKitBookings,
  type BookingEntry,
} from "@/server/availability";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { StatusIndicator } from "@/components/ui/status-indicator";

import { Input } from "@/components/ui/input";
import { useActiveOrganization } from "@/lib/auth-client";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

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

function getBookingsForDay(
  bookings: BookingEntry[],
  day: Date
): BookingEntry[] {
  return bookings.filter((b) => {
    if (!b.rentalStartDate || !b.rentalEndDate) return false;
    const start = new Date(b.rentalStartDate);
    const end = new Date(b.rentalEndDate);
    start.setHours(0, 0, 0, 0);
    end.setHours(23, 59, 59, 999);
    return isWithinInterval(day, { start, end });
  });
}

interface BookingCalendarProps {
  entityType: "model" | "asset" | "kit";
  entityId: string;
  /** For serialized assets: the model ID to show "model booked" days in purple */
  modelId?: string;
  /** Optional initial date to navigate to (from search deep-link) */
  initialDate?: Date | null;
}

export function BookingCalendar({
  entityType,
  entityId,
  modelId,
  initialDate,
}: BookingCalendarProps) {
  const router = useRouter();
  const { data: activeOrg } = useActiveOrganization();
  const orgId = activeOrg?.id;
  const today = useMemo(() => new Date(), []);
  const [currentMonth, setCurrentMonth] = useState(startOfMonth(initialDate || today));
  const [selectedDay, setSelectedDay] = useState<Date | null>(initialDate || null);
  const [viewMode, setViewMode] = useState<"calendar" | "list">("calendar");

  // When initialDate changes (e.g. navigating to same page with new date param), update state
  useEffect(() => {
    if (initialDate) {
      setCurrentMonth(startOfMonth(initialDate));
      setSelectedDay(initialDate);
    }
  }, [initialDate?.getTime()]);

  const gridStart = startOfWeek(startOfMonth(currentMonth), {
    weekStartsOn: 1,
  });
  const gridEnd = endOfWeek(endOfMonth(currentMonth), { weekStartsOn: 1 });

  const dateRange = {
    startDate: gridStart.toISOString(),
    endDate: gridEnd.toISOString(),
  };

  const { data, isLoading } = useQuery({
    queryKey: ["bookings", orgId, entityType, entityId, format(currentMonth, "yyyy-MM")],
    queryFn: async () => {
      if (entityType === "model") {
        return getModelBookings(entityId, dateRange);
      } else if (entityType === "asset") {
        const bookings = await getAssetBookings(entityId, dateRange);
        return { bookings, totalStock: 1, effectiveStock: 1 };
      } else {
        const bookings = await getKitBookings(entityId, dateRange);
        return { bookings, totalStock: 1, effectiveStock: 1 };
      }
    },
  });

  // For serialized assets: also fetch model-level bookings to show "model booked" days
  const { data: modelData } = useQuery({
    queryKey: ["bookings", orgId, "model-context", modelId, format(currentMonth, "yyyy-MM")],
    queryFn: () => getModelBookings(modelId!, dateRange),
    enabled: entityType === "asset" && !!modelId,
  });
  const modelBookings = modelData?.bookings ?? [];

  const bookings = data?.bookings ?? [];
  const totalStock = data?.totalStock ?? 0;
  const effectiveStock = data?.effectiveStock ?? 0;

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

  const selectedBookings = selectedDay
    ? getBookingsForDay(bookings, selectedDay)
    : [];

  // For assets: model-level bookings for the selected day (excluding ones already in direct bookings)
  const selectedModelBookings = selectedDay && entityType === "asset" && modelId
    ? getBookingsForDay(modelBookings, selectedDay).filter(
        (mb) => !selectedBookings.some((sb) => sb.projectId === mb.projectId)
      )
    : [];

  /** For models: get total booked quantity for a day */
  function getBookedQuantityForDay(day: Date): number {
    const dayBookings = getBookingsForDay(bookings, day);
    return dayBookings.reduce((sum, b) => sum + b.quantity, 0);
  }

  function dayIntensity(day: Date): string {
    if (entityType === "model") {
      const booked = getBookedQuantityForDay(day);
      if (booked === 0) return "";
      if (effectiveStock <= 0) return "bg-red-500/15 dark:bg-red-500/20";
      const ratio = booked / effectiveStock;
      if (ratio >= 1) return "bg-red-500/15 dark:bg-red-500/20";
      if (ratio >= 0.5) return "bg-amber-500/12 dark:bg-amber-500/18";
      return "bg-blue-500/10 dark:bg-blue-500/15";
    }
    // Asset/Kit: check direct bookings first
    const directCount = getBookingsForDay(bookings, day).length;
    if (directCount > 0) return "bg-red-500/15 dark:bg-red-500/20";
    // Asset only: check if model is booked (purple hint)
    if (entityType === "asset" && modelId) {
      const modelCount = getBookingsForDay(modelBookings, day).length;
      if (modelCount > 0) return "bg-purple-500/12 dark:bg-purple-500/18";
    }
    return "";
  }

  function handleJumpDate(value: string) {
    const d = new Date(value);
    if (!isNaN(d.getTime())) {
      setCurrentMonth(startOfMonth(d));
      setSelectedDay(d);
    }
  }

  return (
    <div className="space-y-4">
      {/* Controls */}
      <div className="flex flex-wrap items-center gap-3">
        <Button
          variant="outline"
          size="icon"
          onClick={() => setCurrentMonth(addMonths(currentMonth, -1))}
        >
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <h3 className="text-lg font-semibold min-w-[180px] text-center">
          {format(currentMonth, "MMMM yyyy")}
        </h3>
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
        <div className="ml-auto flex items-center gap-2">
          <Input
            type="date"
            className="w-[160px]"
            onChange={(e) => handleJumpDate(e.target.value)}
          />
          <div className="flex border rounded-md">
            <Button
              variant={viewMode === "calendar" ? "default" : "ghost"}
              size="icon"
              className="h-8 w-8 rounded-r-none"
              onClick={() => setViewMode("calendar")}
            >
              <LayoutGrid className="h-4 w-4" />
            </Button>
            <Button
              variant={viewMode === "list" ? "default" : "ghost"}
              size="icon"
              className="h-8 w-8 rounded-l-none"
              onClick={() => setViewMode("list")}
            >
              <List className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </div>

      {/* Legend */}
      <div className="flex flex-wrap items-center gap-4 text-xs text-fg-3">
        {entityType === "model" && totalStock > 0 && (
          <>
            <span>Stock: {effectiveStock}{effectiveStock !== totalStock ? ` of ${totalStock}` : ""}</span>
            <div className="flex items-center gap-1.5">
              <span className="inline-block h-3 w-3 rounded-sm bg-blue-500/15 border border-blue-500/30" />
              Some booked
            </div>
            <div className="flex items-center gap-1.5">
              <span className="inline-block h-3 w-3 rounded-sm bg-amber-500/18 border border-amber-500/30" />
              Low availability
            </div>
          </>
        )}
        <div className="flex items-center gap-1.5">
          <span className="inline-block h-3 w-3 rounded-sm bg-red-500/20 border border-red-500/30" />
          {entityType === "model" ? "Fully booked" : "Booked"}
        </div>
        {entityType === "asset" && modelId && (
          <div className="flex items-center gap-1.5">
            <span className="inline-block h-3 w-3 rounded-sm bg-purple-500/18 border border-purple-500/30" />
            Model booked (not this asset)
          </div>
        )}
      </div>

      {viewMode === "calendar" ? (
        <div className="flex gap-4 flex-col lg:flex-row">
          {/* Calendar Grid */}
          <div className="rounded-lg bg-bg-surface p-2 surface-ring sm:p-4 flex-1">
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
                        const dayBookings = getBookingsForDay(bookings, day);
                        const count = dayBookings.length;
                        const bookedQty = entityType === "model"
                          ? dayBookings.reduce((s, b) => s + b.quantity, 0)
                          : 0;
                        const dayModelBookings = entityType === "asset" && modelId
                          ? getBookingsForDay(modelBookings, day).filter(
                              (mb) => !dayBookings.some((db) => db.projectId === mb.projectId)
                            )
                          : [];
                        const hasAny = count > 0 || dayModelBookings.length > 0;

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
                              ${dayIntensity(day)}
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

                            {/* Booking indicators */}
                            {hasAny && (
                              <>
                                <div className="flex flex-wrap gap-0.5 mt-1 justify-center">
                                  {dayBookings.slice(0, 4).map((b) => (
                                    <span
                                      key={b.id}
                                      className={`inline-block h-1.5 w-1.5 rounded-full ${statusColors[b.projectStatus] || "bg-gray-400"}`}
                                    />
                                  ))}
                                  {dayModelBookings.slice(0, Math.max(0, 4 - count)).map((b) => (
                                    <span
                                      key={`m-${b.id}`}
                                      className="inline-block h-1.5 w-1.5 rounded-full bg-purple-400"
                                    />
                                  ))}
                                  {count + dayModelBookings.length > 4 && (
                                    <span className="text-[9px] text-fg-3 leading-none">
                                      +{count + dayModelBookings.length - 4}
                                    </span>
                                  )}
                                </div>

                                {/* Model: show booked count */}
                                {entityType === "model" && bookedQty > 0 && (
                                  <span className="text-[9px] text-fg-3 mt-0.5">
                                    {bookedQty}/{effectiveStock}
                                  </span>
                                )}

                                {/* Project numbers on larger screens */}
                                <div className="hidden sm:flex flex-col gap-0.5 w-full mt-0.5 overflow-hidden">
                                  {dayBookings.slice(0, 2).map((b) => (
                                    <div
                                      key={b.id}
                                      className={`text-[9px] leading-tight truncate rounded px-0.5 ${statusColors[b.projectStatus] || "bg-gray-400"} text-white`}
                                    >
                                      {b.projectNumber}
                                    </div>
                                  ))}
                                  {count < 2 && dayModelBookings.slice(0, 2 - count).map((b) => (
                                    <div
                                      key={`m-${b.id}`}
                                      className="text-[9px] leading-tight truncate rounded px-0.5 bg-purple-500 text-white"
                                    >
                                      {b.projectNumber}
                                    </div>
                                  ))}
                                  {count + dayModelBookings.length > 2 && (
                                    <div className="text-[9px] text-fg-3 text-center">
                                      +{count + dayModelBookings.length - 2} more
                                    </div>
                                  )}
                                </div>
                              </>
                            )}
                          </button>
                        );
                      })}
                    </div>
                  ))}
                </div>
              )}
          </div>

          {/* Day Detail Panel */}
          <div className="rounded-lg bg-bg-surface p-4 surface-ring lg:w-[340px] shrink-0">
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

                  {entityType === "model" && (
                    <div className="text-sm text-fg-3">
                      {(() => {
                        const booked = selectedBookings.reduce((s, b) => s + b.quantity, 0);
                        const available = Math.max(0, effectiveStock - booked);
                        return (
                          <span>
                            {booked} booked / {available} available of {effectiveStock}
                          </span>
                        );
                      })()}
                    </div>
                  )}

                  {selectedBookings.length === 0 && selectedModelBookings.length === 0 ? (
                    <p className="text-sm text-fg-3 py-4 text-center">
                      No bookings on this day.
                    </p>
                  ) : (
                    <div className="space-y-2">
                      {selectedBookings.length > 0 && (
                        <p className="text-xs text-fg-3">
                          {entityType === "asset" ? "This asset" : selectedBookings.length + " booking" + (selectedBookings.length !== 1 ? "s" : "")}
                        </p>
                      )}
                      {selectedBookings.map((b) => (
                        <button
                          key={b.id}
                          onClick={() => router.push(`/projects/${b.projectId}`)}
                          className="w-full text-left rounded-lg border p-3 hover:bg-accent/50 transition-colors cursor-pointer space-y-1.5"
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className="font-medium text-sm">
                              {b.projectNumber}
                            </span>
                            <StatusIndicator category="project" value={b.projectStatus} label={statusLabels[b.projectStatus] || b.projectStatus} variant="pill" />
                          </div>
                          <p className="text-sm truncate">{b.projectName}</p>
                          {b.clientName && (
                            <p className="text-xs text-fg-3">
                              {b.clientName}
                            </p>
                          )}
                          <div className="flex items-center justify-between text-xs text-fg-3">
                            <span>
                              {format(new Date(b.rentalStartDate), "d MMM")} —{" "}
                              {format(new Date(b.rentalEndDate), "d MMM")}
                            </span>
                            {entityType === "model" && b.quantity > 1 && (
                              <span>Qty: {b.quantity}</span>
                            )}
                          </div>
                        </button>
                      ))}

                      {/* Model-level bookings for assets (purple hint) */}
                      {selectedModelBookings.length > 0 && (
                        <>
                          <p className="text-xs text-purple-400 pt-1">
                            Model booked (not this asset)
                          </p>
                          {selectedModelBookings.map((b) => (
                            <button
                              key={b.id}
                              onClick={() => router.push(`/projects/${b.projectId}`)}
                              className="w-full text-left rounded-lg border border-purple-500/20 p-3 hover:bg-accent/50 transition-colors cursor-pointer space-y-1.5"
                            >
                              <div className="flex items-center justify-between gap-2">
                                <span className="font-medium text-sm">
                                  {b.projectNumber}
                                </span>
                                <Badge
                                  variant="outline"
                                  className="text-[10px] bg-purple-500/10 text-purple-400 border-purple-500/20"
                                >
                                  {statusLabels[b.projectStatus] || b.projectStatus}
                                </Badge>
                              </div>
                              <p className="text-sm truncate">{b.projectName}</p>
                              {b.clientName && (
                                <p className="text-xs text-fg-3">
                                  {b.clientName}
                                </p>
                              )}
                              <div className="flex items-center justify-between text-xs text-fg-3">
                                <span>
                                  {format(new Date(b.rentalStartDate), "d MMM")} —{" "}
                                  {format(new Date(b.rentalEndDate), "d MMM")}
                                </span>
                                {b.quantity > 1 && <span>Qty: {b.quantity}</span>}
                              </div>
                            </button>
                          ))}
                        </>
                      )}
                    </div>
                  )}
                </div>
              ) : (
                <div className="py-8 text-center text-sm text-fg-3">
                  <CalendarDays className="mx-auto mb-2 h-8 w-8 opacity-50" />
                  Click a day to see booking details.
                </div>
              )}
          </div>
        </div>
      ) : (
        /* List View */
        <div className="rounded-lg bg-bg-surface surface-ring overflow-hidden">
            {isLoading ? (
              <div className="py-12 text-center text-fg-3">
                Loading...
              </div>
            ) : bookings.length === 0 ? (
              <div className="py-12 text-center text-sm text-fg-3">
                No bookings in {format(currentMonth, "MMMM yyyy")}.
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Project</TableHead>
                    <TableHead>Client</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Start</TableHead>
                    <TableHead>End</TableHead>
                    {entityType === "model" && <TableHead className="text-right">Qty</TableHead>}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {bookings.map((b) => (
                    <TableRow
                      key={b.id}
                      className="cursor-pointer hover:bg-accent/50"
                      onClick={() => router.push(`/projects/${b.projectId}`)}
                    >
                      <TableCell>
                        <div>
                          <span className="font-mono text-sm font-medium">
                            {b.projectNumber}
                          </span>
                          <p className="text-sm text-fg-3 truncate max-w-[200px]">
                            {b.projectName}
                          </p>
                        </div>
                      </TableCell>
                      <TableCell className="text-fg-3">
                        {b.clientName || "—"}
                      </TableCell>
                      <TableCell>
                        <StatusIndicator category="project" value={b.projectStatus} label={statusLabels[b.projectStatus] || b.projectStatus} variant="pill" />
                      </TableCell>
                      <TableCell>
                        {b.rentalStartDate
                          ? format(new Date(b.rentalStartDate), "d MMM yyyy")
                          : "—"}
                      </TableCell>
                      <TableCell>
                        {b.rentalEndDate
                          ? format(new Date(b.rentalEndDate), "d MMM yyyy")
                          : "—"}
                      </TableCell>
                      {entityType === "model" && (
                        <TableCell className="text-right font-medium">
                          {b.quantity}
                        </TableCell>
                      )}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
        </div>
      )}
    </div>
  );
}
