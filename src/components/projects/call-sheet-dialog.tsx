"use client";

import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Loader2, FileText, Calendar } from "lucide-react";
import { toast } from "sonner";

import { getProjectCrew } from "@/server/crew-assignments";
import { getCallSheetDates } from "@/server/projects";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";

interface CallSheetDialogProps {
  projectId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function formatDateKey(date: Date): string {
  return date.toISOString().split("T")[0];
}

function parseDateKey(key: string): Date {
  // Parse as local date to avoid UTC offset issues
  const [year, month, day] = key.split("-").map(Number);
  return new Date(year, month - 1, day);
}

function formatDisplayDate(dateKey: string): string {
  const d = parseDateKey(dateKey);
  const dayName = DAY_NAMES[d.getDay()];
  const month = d.toLocaleString("en-AU", { month: "short" });
  return `${dayName} ${d.getDate()} ${month}`;
}

export function CallSheetDialog({
  projectId,
  open,
  onOpenChange,
}: CallSheetDialogProps) {
  const [selectAllDays, setSelectAllDays] = useState(true);
  const [selectedDates, setSelectedDates] = useState<Set<string>>(new Set());
  const [selectedCrewMemberId, setSelectedCrewMemberId] = useState<string>("all");
  const [selectedRoleId, setSelectedRoleId] = useState<string>("all");
  const [generating, setGenerating] = useState(false);

  const crewQuery = useQuery({
    queryKey: ["project-crew", projectId],
    queryFn: () => getProjectCrew(projectId),
    enabled: open,
  });

  const datesQuery = useQuery({
    queryKey: ["call-sheet-dates", projectId],
    queryFn: () => getCallSheetDates(projectId),
    enabled: open,
  });

  // Derive all available dates: shift dates + project milestone dates
  const availableDates = useMemo(() => {
    const dateSet = new Set<string>();

    // Collect shift dates from crew assignments
    if (crewQuery.data) {
      for (const assignment of crewQuery.data) {
        if (assignment.shifts) {
          for (const shift of assignment.shifts) {
            if (shift.date) {
              dateSet.add(formatDateKey(new Date(shift.date)));
            }
          }
        }
      }
    }

    // Collect project milestone dates
    if (datesQuery.data) {
      const { loadInDate, eventStartDate, eventEndDate, loadOutDate } = datesQuery.data;
      if (loadInDate) dateSet.add(formatDateKey(new Date(loadInDate)));
      if (eventStartDate) dateSet.add(formatDateKey(new Date(eventStartDate)));
      if (eventEndDate) dateSet.add(formatDateKey(new Date(eventEndDate)));
      if (loadOutDate) dateSet.add(formatDateKey(new Date(loadOutDate)));
    }

    return Array.from(dateSet).sort();
  }, [crewQuery.data, datesQuery.data]);

  // Count crew per date
  const crewCountByDate = useMemo(() => {
    const counts: Record<string, number> = {};
    if (!crewQuery.data) return counts;

    for (const assignment of crewQuery.data) {
      if (assignment.shifts) {
        for (const shift of assignment.shifts) {
          if (shift.date) {
            const key = formatDateKey(new Date(shift.date));
            counts[key] = (counts[key] ?? 0) + 1;
          }
        }
      }
    }
    return counts;
  }, [crewQuery.data]);

  // Crew member options for select (deduplicated)
  const crewOptions = useMemo(() => {
    if (!crewQuery.data) return [];
    const seen = new Map<string, string>();
    for (const a of crewQuery.data) {
      if (!seen.has(a.crewMember.id)) {
        seen.set(a.crewMember.id, `${a.crewMember.firstName} ${a.crewMember.lastName}`);
      }
    }
    return Array.from(seen, ([id, label]) => ({ id, label })).sort((a, b) =>
      a.label.localeCompare(b.label)
    );
  }, [crewQuery.data]);

  // Role options for select
  const roleOptions = useMemo(() => {
    if (!crewQuery.data) return [];
    const roles = new Map<string, string>();
    for (const a of crewQuery.data) {
      if (a.crewRole?.id && a.crewRole?.name) {
        roles.set(a.crewRole.id, a.crewRole.name);
      }
    }
    return Array.from(roles, ([id, label]) => ({ id, label })).sort((a, b) =>
      a.label.localeCompare(b.label)
    );
  }, [crewQuery.data]);

  const selectedRoleLabel = useMemo(() => {
    if (selectedRoleId === "all") return "All Roles";
    const match = roleOptions.find((r) => r.id === selectedRoleId);
    return match?.label ?? selectedRoleId;
  }, [selectedRoleId, roleOptions]);

  const selectedCrewLabel = useMemo(() => {
    if (selectedCrewMemberId === "all") return "All Crew";
    const match = crewOptions.find((c) => c.id === selectedCrewMemberId);
    return match?.label ?? selectedCrewMemberId;
  }, [selectedCrewMemberId, crewOptions]);

  const isLoading = crewQuery.isLoading || datesQuery.isLoading;

  function toggleDate(dateKey: string) {
    setSelectedDates((prev) => {
      const next = new Set(prev);
      if (next.has(dateKey)) {
        next.delete(dateKey);
      } else {
        next.add(dateKey);
      }
      return next;
    });
  }

  function buildApiUrl(): string {
    const base = `/api/documents/call-sheet/${projectId}`;
    const params = new URLSearchParams();

    const crewParam =
      selectedCrewMemberId !== "all" ? selectedCrewMemberId : null;

    if (selectAllDays) {
      params.set("allDates", "true");
    } else {
      const dates = Array.from(selectedDates);
      if (dates.length === 1 && !crewParam) {
        params.set("date", dates[0]);
      } else {
        params.set("dates", dates.join(","));
      }
    }

    if (crewParam) {
      params.set("crewMemberId", crewParam);
    }

    if (selectedRoleId !== "all") {
      params.set("crewRoleId", selectedRoleId);
    }

    return `${base}?${params.toString()}`;
  }

  function buildButtonLabel(): string {
    const hasCrewFilter =
      selectedCrewMemberId !== "all" && selectedCrewLabel !== "All Crew";
    const hasRoleFilter =
      selectedRoleId !== "all" && selectedRoleLabel !== "All Roles";

    if (hasCrewFilter) {
      return `Generate Call Sheet for ${selectedCrewLabel}`;
    }

    const parts: string[] = [];
    if (hasRoleFilter) parts.push(selectedRoleLabel);
    if (!selectAllDays && selectedDates.size > 0) {
      parts.push(`${selectedDates.size} ${selectedDates.size === 1 ? "day" : "days"}`);
    }

    if (parts.length > 0) {
      return `Generate Call Sheet (${parts.join(", ")})`;
    }

    return "Generate Call Sheet";
  }

  async function handleGenerate() {
    if (!selectAllDays && selectedDates.size === 0) {
      toast.error("Select at least one date, or switch to All Days.");
      return;
    }

    const url = buildApiUrl();
    setGenerating(true);

    try {
      const res = await fetch(url);
      if (!res.ok) {
        const text = await res.text().catch(() => "Unknown error");
        throw new Error(text || `Server responded with ${res.status}`);
      }

      const blob = await res.blob();
      const objectUrl = URL.createObjectURL(blob);
      window.open(objectUrl, "_blank");

      // Revoke after a short delay to allow the tab to load the PDF
      setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to generate call sheet."
      );
    } finally {
      setGenerating(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileText className="h-4 w-4 text-muted-foreground" />
            Call Sheet
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-5 py-1">
          {/* Date selection */}
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <Calendar className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm font-medium">Dates</span>
            </div>

            {/* All Days toggle */}
            <label className="flex cursor-pointer items-center gap-2.5">
              <Checkbox
                checked={selectAllDays}
                onCheckedChange={(checked) => {
                  setSelectAllDays(!!checked);
                  if (checked) setSelectedDates(new Set());
                }}
              />
              <span className="text-sm">All Days</span>
            </label>

            {/* Individual date list */}
            {!selectAllDays && (
              <div className="ml-6 space-y-2">
                {isLoading ? (
                  <>
                    <Skeleton className="h-5 w-full" />
                    <Skeleton className="h-5 w-4/5" />
                    <Skeleton className="h-5 w-3/5" />
                  </>
                ) : availableDates.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    No dates found for this project.
                  </p>
                ) : (
                  availableDates.map((dateKey) => {
                    const count = crewCountByDate[dateKey] ?? 0;
                    return (
                      <label
                        key={dateKey}
                        className="flex cursor-pointer items-center gap-2.5"
                      >
                        <Checkbox
                          checked={selectedDates.has(dateKey)}
                          onCheckedChange={() => toggleDate(dateKey)}
                        />
                        <span className="text-sm">
                          {formatDisplayDate(dateKey)}
                        </span>
                        {count > 0 && (
                          <Badge
                            variant="secondary"
                            className="ml-auto text-xs tabular-nums"
                          >
                            {count}
                          </Badge>
                        )}
                      </label>
                    );
                  })
                )}
              </div>
            )}
          </div>

          {/* Role filter */}
          {roleOptions.length > 0 && (
            <div className="space-y-2">
              <span className="text-sm font-medium">Filter by role</span>
              <Select
                value={selectedRoleId}
                onValueChange={(v) => setSelectedRoleId(v ?? "all")}
              >
                <SelectTrigger className="w-full">
                  <SelectValue>
                    {selectedRoleLabel}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Roles</SelectItem>
                  {roleOptions.map((r) => (
                    <SelectItem key={r.id} value={r.id}>
                      {r.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {/* Person selection */}
          <div className="space-y-2">
            <span className="text-sm font-medium">Preview as individual</span>
            {isLoading ? (
              <Skeleton className="h-9 w-full" />
            ) : (
              <Select
                value={selectedCrewMemberId}
                onValueChange={(v) => setSelectedCrewMemberId(v ?? "all")}
              >
                <SelectTrigger className="w-full">
                  <SelectValue>
                    {selectedCrewLabel}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Crew</SelectItem>
                  {crewOptions.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>

          {/* Generate button */}
          <Button
            className="w-full"
            onClick={handleGenerate}
            disabled={generating || isLoading}
          >
            {generating ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Generating...
              </>
            ) : (
              buildButtonLabel()
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
