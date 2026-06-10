"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerQuery } from "@/hooks/use-server-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useActiveOrganization } from "@/lib/auth-client";
import { useTablePreferences } from "@/lib/use-table-preferences";
import { CanDo } from "@/components/auth/permission-gate";
import { RequirePermission } from "@/components/auth/require-permission";
import {
  Clock,
  Download,
  MoreHorizontal,
  Pencil,
  Send,
  CheckCircle,
  AlertTriangle,
  Trash2,
  Briefcase,
  Loader2,
  Plus,
  ArrowRight,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { StatusIndicator } from "@/components/ui/status-indicator";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ConfirmActionMenuItem } from "@/components/ui/confirm-action-menu-item";
import { DataTable, type ColumnDef } from "@/components/ui/data-table";
import { PageHeader } from "@/components/layout/page-header";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  getAllTimeEntries,
  createTimeEntry,
  updateTimeEntry,
  deleteTimeEntry,
  submitTimeEntries,
  approveTimeEntries,
  disputeTimeEntry,
} from "@/server/crew-time";
import { getCrewPickerList } from "@/server/crew-dashboard";
import {
  crewTimeEntrySchema,
  type CrewTimeEntryFormValues,
} from "@/lib/validations/crew";
import { timeEntryStatusLabels, formatLabel } from "@/lib/status-labels";
import { formatDate } from "@/lib/formatters";
import { toast } from "sonner";
import { FadeIn } from "@/components/ui/motion";


/* eslint-disable @typescript-eslint/no-explicit-any */
export default function TimesheetsPage() {
  const { data: activeOrg } = useActiveOrganization();
  const orgId = activeOrg?.id;
  const queryClient = useQueryClient();

  const {
    sortBy,
    sortOrder,
    pageSize,
    page,
    setPage,
    setPageSize,
    handleSort,
    columnVisibility,
    toggleColumnVisibility,
    resetPreferences,
    filters,
    setFilter,
    currentConfig, applyConfig,
  } = useTablePreferences("timesheets", {
    sortBy: "date",
    sortOrder: "desc",
  });

  const [search, setSearch] = useState("");
  const [exportOpen, setExportOpen] = useState(false);
  const [logTimeOpen, setLogTimeOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [editingEntry, setEditingEntry] = useState<any>(null);

  // Slash command listener
  useEffect(() => {
    const handler = (e: Event) => {
      const ce = e as CustomEvent;
      const { dialog } = ce.detail || {};
      if (dialog === "log-time") setLogTimeOpen(true);
      if (dialog === "export-timesheets") setExportOpen(true);
    };
    window.addEventListener("slash-command", handler);
    return () => window.removeEventListener("slash-command", handler);
  }, []);

  // Fetch crew list for filter options
  const { data: crewList } = useServerQuery({
    queryKey: ["crew-picker-list", orgId],
    queryFn: getCrewPickerList,
  });

  const crewFilterOptions =
    crewList?.map((c: any) => ({
      value: c.id,
      label: `${c.firstName} ${c.lastName}`,
    })) || [];

  const { data, isLoading } = useQuery({
    queryKey: [
      "all-time-entries",
      orgId,
      { search, filters, page, pageSize, sortBy, sortOrder },
    ],
    queryFn: () =>
      getAllTimeEntries({
        search: search || undefined,
        filters,
        page,
        pageSize,
        sortBy,
        sortOrder,
      }),
  });

  const entries = data?.entries || [];
  const total = data?.total || 0;

  const submitMutation = useMutation({
    mutationFn: (ids: string[]) => submitTimeEntries(ids),
    onSuccess: (result) => {
      toast.success(`${result.count} entries submitted`);
      queryClient.invalidateQueries({ queryKey: ["all-time-entries"] });
    },
    onError: (e) => toast.error(e.message),
  });

  const approveMutation = useMutation({
    mutationFn: (ids: string[]) => approveTimeEntries(ids),
    onSuccess: (result) => {
      toast.success(`${result.count} entries approved`);
      queryClient.invalidateQueries({ queryKey: ["all-time-entries"] });
    },
    onError: (e) => toast.error(e.message),
  });

  const disputeMutation = useMutation({
    mutationFn: (id: string) => disputeTimeEntry(id),
    onSuccess: () => {
      toast.success("Entry disputed");
      queryClient.invalidateQueries({ queryKey: ["all-time-entries"] });
    },
    onError: (e) => toast.error(e.message),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteTimeEntry(id),
    onSuccess: () => {
      toast.success("Entry deleted");
      queryClient.invalidateQueries({ queryKey: ["all-time-entries"] });
    },
    onError: (e) => toast.error(e.message),
  });

  const columns: ColumnDef<any>[] = [
    {
      id: "crewMember",
      header: "Crew Member",
      alwaysVisible: true,
      sortKey: "crewMember",
      filterable: true,
      filterType: "enum",
      filterKey: "crewMemberId",
      filterOptions: crewFilterOptions,
      cell: (row: any) => (
        <Link
          href={`/crew/${row.crewMember?.id}`}
          className="text-sm font-medium hover:underline"
          onClick={(e) => e.stopPropagation()}
        >
          {row.crewMember?.firstName} {row.crewMember?.lastName}
        </Link>
      ),
    },
    {
      id: "date",
      header: "Date",
      sortKey: "date",
      cell: (row: any) => (
        <span className="text-sm">{formatDate(row.date)}</span>
      ),
    },
    {
      id: "project",
      header: "Project / Description",
      sortable: false,
      cell: (row: any) =>
        row.assignment ? (
          <Link
            href={`/projects/${row.assignment.project?.id}`}
            className="text-sm hover:underline"
            onClick={(e) => e.stopPropagation()}
          >
            {row.assignment.project?.projectNumber} —{" "}
            {row.assignment.project?.name}
          </Link>
        ) : (
          <span className="text-sm text-fg-3 italic">
            {row.description || "General"}
          </span>
        ),
    },
    {
      id: "role",
      header: "Role",
      sortable: false,
      responsiveHide: "md",
      cell: (row: any) => (
        <span className="text-sm text-fg-3">
          {row.assignment?.crewRole?.name || "\u2014"}
        </span>
      ),
    },
    {
      id: "time",
      header: "Time",
      sortKey: "startTime",
      cell: (row: any) => (
        <span className="text-sm font-mono">
          {row.startTime}–{row.endTime}
        </span>
      ),
    },
    {
      id: "break",
      header: "Break",
      sortable: false,
      responsiveHide: "md",
      cell: (row: any) => (
        <span className="text-sm">
          {row.breakMinutes > 0 ? `${row.breakMinutes}m` : "\u2014"}
        </span>
      ),
    },
    {
      id: "hours",
      header: "Hours",
      sortKey: "totalHours",
      align: "right",
      cell: (row: any) => (
        <span className="text-sm font-mono t-data">
          {row.totalHours != null
            ? `${Number(row.totalHours).toFixed(1)}h`
            : "\u2014"}
        </span>
      ),
    },
    {
      id: "status",
      header: "Status",
      sortKey: "status",
      filterable: true,
      filterType: "enum",
      filterOptions: [
        { value: "DRAFT", label: "Draft" },
        { value: "SUBMITTED", label: "Submitted" },
        { value: "APPROVED", label: "Approved" },
        { value: "DISPUTED", label: "Disputed" },
        { value: "EXPORTED", label: "Exported" },
      ],
      cell: (row: any) => (
        <StatusIndicator
          category="timeEntry"
          value={row.status}
          label={timeEntryStatusLabels[row.status] || formatLabel(row.status)}
          variant="pill"
        />
      ),
    },
    {
      id: "approvedBy",
      header: "Approved By",
      sortable: false,
      responsiveHide: "lg",
      defaultVisible: false,
      cell: (row: any) => (
        <span className="text-sm text-fg-3">
          {row.approvedBy?.name || "\u2014"}
        </span>
      ),
    },
    {
      id: "notes",
      header: "Notes",
      sortable: false,
      responsiveHide: "lg",
      defaultVisible: false,
      cell: (row: any) => (
        <span className="text-sm text-fg-3 truncate max-w-[200px] block">
          {row.notes || "\u2014"}
        </span>
      ),
    },
    {
      id: "actions",
      header: "",
      sortable: false,
      alwaysVisible: true,
      width: 50,
      cell: (row: any) =>
        row.status !== "EXPORTED" ? (
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button variant="ghost" size="sm" className="h-8 w-8 p-0" />
              }
            >
              <MoreHorizontal className="h-4 w-4" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuGroup>
                <DropdownMenuItem
                  onClick={() => {
                    setEditingEntry(row);
                    setEditOpen(true);
                  }}
                >
                  <Pencil className="mr-2 h-4 w-4" />
                  Edit
                </DropdownMenuItem>
                {["DRAFT", "DISPUTED"].includes(row.status) && (
                  <DropdownMenuItem
                    onClick={() => submitMutation.mutate([row.id])}
                  >
                    <Send className="mr-2 h-4 w-4" />
                    Submit
                  </DropdownMenuItem>
                )}
                {["SUBMITTED", "DISPUTED"].includes(row.status) && (
                  <DropdownMenuItem
                    onClick={() => approveMutation.mutate([row.id])}
                  >
                    <CheckCircle className="mr-2 h-4 w-4" />
                    Approve
                  </DropdownMenuItem>
                )}
                {["SUBMITTED", "APPROVED"].includes(row.status) && (
                  <DropdownMenuItem
                    onClick={() => disputeMutation.mutate(row.id)}
                  >
                    <AlertTriangle className="mr-2 h-4 w-4" />
                    Dispute
                  </DropdownMenuItem>
                )}
                <ConfirmActionMenuItem
                  icon={<Trash2 className="mr-2 h-4 w-4" />}
                  onConfirm={() => deleteMutation.mutate(row.id)}
                >
                  Delete entry
                </ConfirmActionMenuItem>
              </DropdownMenuGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null,
    },
  ];

  const toolbarActions = (
    <div className="flex gap-2">
      <Button
        variant="outline"
        size="sm"
        onClick={() => setExportOpen(true)}
      >
        <Download className="mr-2 h-3.5 w-3.5" />
        Export CSV
      </Button>
      <CanDo resource="crew" action="create">
        <Button size="sm" onClick={() => setLogTimeOpen(true)}>
          <Plus className="mr-2 h-3.5 w-3.5" />
          Log Time
        </Button>
      </CanDo>
    </div>
  );

  return (
    <RequirePermission resource="crew" action="read">
      <FadeIn>
      <div className="space-y-4">
        <PageHeader
          title="Timesheets"
          description="All time entries across crew members."
        />

        <DataTable
          data={entries}
          columns={columns}
          totalRows={total}
          page={page}
          pageSize={pageSize}
          onPageChange={setPage}
          onPageSizeChange={setPageSize}
          sortField={sortBy}
          sortDirection={sortOrder}
          onSortChange={handleSort}
          filters={filters}
          onFilterChange={setFilter}
          searchValue={search}
          onSearchChange={(v) => {
            setSearch(v);
            setPage(1);
          }}
          searchPlaceholder="Search by name, project, description..."
          columnVisibility={columnVisibility}
          onToggleColumnVisibility={toggleColumnVisibility}
          onResetPreferences={resetPreferences}
          savedViews={{ tableId: "timesheets", currentConfig, applyConfig }}
          isLoading={isLoading}
          emptyPreset="crew"
          emptyTitle="No time entries"
          emptyDescription="Time entries will appear here once crew members log time."
          toolbarActions={toolbarActions}
        />
      </div>
      </FadeIn>

      {/* Edit Dialog */}
      <EditTimeEntryDialog
        entry={editingEntry}
        open={editOpen}
        onOpenChange={(open) => {
          setEditOpen(open);
          if (!open) setEditingEntry(null);
        }}
      />

      {/* Log Time Dialog */}
      <LogTimeDialog open={logTimeOpen} onOpenChange={setLogTimeOpen} />

      {/* Export Dialog */}
      <ExportDialog open={exportOpen} onOpenChange={setExportOpen} />
    </RequirePermission>
  );
}

// ─── Edit Time Entry Dialog ─────────────────────────────────────────────────

function EditTimeEntryDialog({
  entry,
  open,
  onOpenChange,
}: {
  entry: any;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const [isGeneral, setIsGeneral] = useState(false);

  const form = useForm<CrewTimeEntryFormValues>({
    resolver: zodResolver(crewTimeEntrySchema),
    defaultValues: {
      assignmentId: "",
      crewMemberId: "",
      description: "",
      date: "",
      startTime: "",
      endTime: "",
      breakMinutes: "",
      notes: "",
    },
  });

  // Populate form when entry changes
  const resetKey = `${open}-${entry?.id}`;
  const [prevKey, setPrevKey] = useState(resetKey);
  if (prevKey !== resetKey) {
    setPrevKey(resetKey);
    if (open && entry) {
      const isGen = !entry.assignmentId;
      setIsGeneral(isGen);
      form.reset({
        assignmentId: entry.assignmentId || "",
        crewMemberId: entry.crewMemberId || entry.crewMember?.id || "",
        description: entry.description || "",
        date: entry.date
          ? new Date(entry.date).toISOString().split("T")[0]
          : "",
        startTime: entry.startTime || "",
        endTime: entry.endTime || "",
        breakMinutes: entry.breakMinutes || "",
        notes: entry.notes || "",
      });
    }
  }

  const mutation = useMutation({
    mutationFn: (data: CrewTimeEntryFormValues) =>
      updateTimeEntry(entry?.id, data),
    onSuccess: () => {
      toast.success("Time entry updated");
      queryClient.invalidateQueries({ queryKey: ["all-time-entries"] });
      queryClient.invalidateQueries({ queryKey: ["crew-time-entries"] });
      queryClient.invalidateQueries({ queryKey: ["crew-pending-time"] });
      onOpenChange(false);
    },
    onError: (e) => toast.error(e.message),
  });

  if (!entry) return null;

  const crewName = `${entry.crewMember?.firstName || ""} ${entry.crewMember?.lastName || ""}`.trim();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Edit Time Entry</DialogTitle>
        </DialogHeader>
        <form
          onSubmit={form.handleSubmit((data) => {
            if (isGeneral) data.assignmentId = "";
            mutation.mutate(data);
          })}
          className="space-y-4"
        >
          <p className="text-sm font-medium">{crewName}</p>

          {/* Type toggle */}
          <div className="flex gap-2">
            <Button
              type="button"
              variant={!isGeneral ? "default" : "outline"}
              size="sm"
              className="flex-1"
              onClick={() => {
                setIsGeneral(false);
                form.setValue("description", "");
              }}
            >
              <Briefcase className="mr-2 h-3.5 w-3.5" />
              Project
            </Button>
            <Button
              type="button"
              variant={isGeneral ? "default" : "outline"}
              size="sm"
              className="flex-1"
              onClick={() => {
                setIsGeneral(true);
                form.setValue("assignmentId", "");
              }}
            >
              <Clock className="mr-2 h-3.5 w-3.5" />
              General
            </Button>
          </div>

          {!isGeneral ? (
            entry.assignment ? (
              <div className="space-y-1.5">
                <Label>Assignment</Label>
                <Input
                  readOnly
                  value={`${entry.assignment.project?.projectNumber} — ${entry.assignment.project?.name}`}
                  className="bg-bg-inset"
                />
              </div>
            ) : (
              <p className="text-xs text-fg-3">
                No assignment linked. Switch to General to add a description.
              </p>
            )
          ) : (
            <div className="space-y-1.5">
              <Label>Description</Label>
              <Input
                placeholder="e.g. Warehouse maintenance, Office admin..."
                {...form.register("description")}
              />
            </div>
          )}

          <div className="space-y-1.5">
            <Label>Date</Label>
            <Input type="date" {...form.register("date")} />
            {form.formState.errors.date && (
              <p className="text-xs text-destructive">
                {form.formState.errors.date.message}
              </p>
            )}
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label>Start Time</Label>
              <Input type="time" {...form.register("startTime")} />
              {form.formState.errors.startTime && (
                <p className="text-xs text-destructive">
                  {form.formState.errors.startTime.message}
                </p>
              )}
            </div>
            <div className="space-y-1.5">
              <Label>End Time</Label>
              <Input type="time" {...form.register("endTime")} />
              {form.formState.errors.endTime && (
                <p className="text-xs text-destructive">
                  {form.formState.errors.endTime.message}
                </p>
              )}
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>Break (minutes)</Label>
            <Input
              type="number"
              min={0}
              placeholder="0"
              {...form.register("breakMinutes")}
            />
          </div>

          <div className="space-y-1.5">
            <Label>Notes</Label>
            <Textarea
              placeholder="Optional notes..."
              {...form.register("notes")}
            />
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={mutation.isPending}>
              {mutation.isPending && (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              )}
              Save
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ─── Export Dialog ───────────────────────────────────────────────────────────

// ─── Log Time Dialog ────────────────────────────────────────────────────────

function LogTimeDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { data: activeOrg } = useActiveOrganization();
  const orgId = activeOrg?.id;
  const queryClient = useQueryClient();

  const [selectedCrewIds, setSelectedCrewIds] = useState<string[]>([]);
  const [step, setStep] = useState<"pick" | "form">("pick");
  const [isGeneral, setIsGeneral] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");

  const { data: crewList } = useServerQuery({
    queryKey: ["crew-picker-list", orgId],
    queryFn: getCrewPickerList,
    enabled: open,
  });

  const filteredCrew = crewList?.filter((c: any) => {
    if (!searchQuery) return true;
    const q = searchQuery.toLowerCase();
    const name = `${c.firstName} ${c.lastName}`.toLowerCase();
    const role = (c.crewRole?.name || c.department || "").toLowerCase();
    return name.includes(q) || role.includes(q);
  });

  const form = useForm<CrewTimeEntryFormValues>({
    resolver: zodResolver(crewTimeEntrySchema),
    defaultValues: {
      assignmentId: "",
      crewMemberId: "",
      description: "",
      date: new Date().toISOString().split("T")[0],
      startTime: "",
      endTime: "",
      breakMinutes: "",
      notes: "",
    },
  });

  const [prevOpen, setPrevOpen] = useState(open);
  if (prevOpen !== open) {
    setPrevOpen(open);
    if (!open) {
      setSelectedCrewIds([]);
      setStep("pick");
      setIsGeneral(false);
      setSearchQuery("");
      form.reset();
    }
  }

  const toggleCrewMember = (id: string) => {
    setSelectedCrewIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  };

  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (data: CrewTimeEntryFormValues) => {
    if (isGeneral) data.assignmentId = "";
    setSubmitting(true);
    try {
      let successCount = 0;
      const errors: string[] = [];
      for (const crewId of selectedCrewIds) {
        try {
          await createTimeEntry({ ...data, crewMemberId: crewId });
          successCount++;
        } catch (e: any) {
          const crew = crewList?.find((c: any) => c.id === crewId);
          errors.push(`${crew?.firstName || ""} ${crew?.lastName || ""}: ${e.message}`);
        }
      }
      if (successCount > 0) {
        toast.success(
          `${successCount} time ${successCount === 1 ? "entry" : "entries"} added`
        );
        queryClient.invalidateQueries({ queryKey: ["all-time-entries"] });
        queryClient.invalidateQueries({ queryKey: ["crew-pending-time"] });
        queryClient.invalidateQueries({ queryKey: ["crew-dashboard-stats"] });
      }
      if (errors.length > 0) {
        toast.error(`${errors.length} failed: ${errors[0]}`);
      }
      if (successCount > 0) {
        onOpenChange(false);
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Log Time</DialogTitle>
        </DialogHeader>

        {step === "pick" ? (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <Label>Select Crew Members</Label>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-7 text-xs"
                onClick={() =>
                  selectedCrewIds.length === (filteredCrew?.length || 0)
                    ? setSelectedCrewIds([])
                    : setSelectedCrewIds(filteredCrew?.map((c: any) => c.id) || [])
                }
              >
                {selectedCrewIds.length === (filteredCrew?.length || 0) && filteredCrew?.length
                  ? "Deselect All"
                  : "Select All"}
              </Button>
            </div>
            <Input
              placeholder="Search crew..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
            <div className="space-y-1 max-h-72 overflow-y-auto">
              {filteredCrew?.map((c: any) => {
                const isSelected = selectedCrewIds.includes(c.id);
                return (
                  <button
                    key={c.id}
                    type="button"
                    className={`w-full flex items-center gap-3 rounded-md border p-3 text-left transition-colors ${
                      isSelected
                        ? "bg-primary/10 border-primary/30"
                        : "hover:bg-accent/50"
                    }`}
                    onClick={() => toggleCrewMember(c.id)}
                  >
                    <div
                      className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-sm border ${
                        isSelected
                          ? "bg-primary border-primary text-primary-foreground"
                          : "border-muted-foreground/30"
                      }`}
                    >
                      {isSelected && <CheckCircle className="h-3 w-3" />}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium">
                        {c.firstName} {c.lastName}
                      </p>
                      <p className="text-xs text-fg-3">
                        {c.crewRole?.name || c.department || "No role"}
                      </p>
                    </div>
                  </button>
                );
              })}
              {(!filteredCrew || filteredCrew.length === 0) && (
                <p className="text-sm text-fg-3 py-4 text-center">
                  No crew members found.
                </p>
              )}
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenChange(false)}
              >
                Cancel
              </Button>
              <Button
                type="button"
                disabled={selectedCrewIds.length === 0}
                onClick={() => {
                  setStep("form");
                  form.setValue("crewMemberId", selectedCrewIds[0]);
                }}
              >
                Next ({selectedCrewIds.length} selected)
              </Button>
            </DialogFooter>
          </div>
        ) : (
          <form
            onSubmit={form.handleSubmit(handleSubmit)}
            className="space-y-4"
          >
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium">
                {selectedCrewIds.length === 1
                  ? `${crewList?.find((c: any) => c.id === selectedCrewIds[0])?.firstName} ${crewList?.find((c: any) => c.id === selectedCrewIds[0])?.lastName}`
                  : `${selectedCrewIds.length} crew members selected`}
              </p>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setStep("pick")}
              >
                Change
              </Button>
            </div>

            <div className="flex gap-2">
              <Button
                type="button"
                variant={!isGeneral ? "default" : "outline"}
                size="sm"
                className="flex-1"
                onClick={() => {
                  setIsGeneral(false);
                  form.setValue("description", "");
                }}
              >
                <Briefcase className="mr-2 h-3.5 w-3.5" />
                Project
              </Button>
              <Button
                type="button"
                variant={isGeneral ? "default" : "outline"}
                size="sm"
                className="flex-1"
                onClick={() => {
                  setIsGeneral(true);
                  form.setValue("assignmentId", "");
                }}
              >
                <Clock className="mr-2 h-3.5 w-3.5" />
                General
              </Button>
            </div>

            {!isGeneral ? (
              selectedCrewIds.length === 1 ? (
                <div className="space-y-1.5">
                  <Label>Assignment</Label>
                  <Select
                    value={form.watch("assignmentId") || ""}
                    onValueChange={(v) => form.setValue("assignmentId", v || "")}
                  >
                    <SelectTrigger>
                      <SelectValue>
                        {(() => {
                          const crew = crewList?.find(
                            (c: any) => c.id === selectedCrewIds[0]
                          );
                          const assignments = (crew?.assignments || []).filter(
                            (a: any) =>
                              !["CANCELLED", "DECLINED"].includes(a.status)
                          );
                          const selected = assignments.find(
                            (a: any) => a.id === form.watch("assignmentId")
                          );
                          if (!selected) return "Select assignment";
                          return `${selected.project?.projectNumber} — ${selected.project?.name}${selected.crewRole?.name ? ` (${selected.crewRole.name})` : ""}`;
                        })()}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      {(() => {
                        const crew = crewList?.find(
                          (c: any) => c.id === selectedCrewIds[0]
                        );
                        return (crew?.assignments || [])
                          .filter(
                            (a: any) =>
                              !["CANCELLED", "DECLINED"].includes(a.status)
                          )
                          .map((a: any) => (
                            <SelectItem key={a.id} value={a.id}>
                              {a.project?.projectNumber} — {a.project?.name}
                              {a.crewRole?.name
                                ? ` (${a.crewRole.name})`
                                : ""}
                            </SelectItem>
                          ));
                      })()}
                    </SelectContent>
                  </Select>
                </div>
              ) : (
                <p className="text-xs text-fg-3 rounded-md border p-3">
                  Assignment selection is not available for multiple crew
                  members. Switch to General mode or select one member.
                </p>
              )
            ) : (
              <div className="space-y-1.5">
                <Label>Description</Label>
                <Input
                  placeholder="e.g. Warehouse maintenance, Office admin..."
                  {...form.register("description")}
                />
              </div>
            )}

            <div className="space-y-1.5">
              <Label>Date</Label>
              <Input type="date" {...form.register("date")} />
              {form.formState.errors.date && (
                <p className="text-xs text-destructive">
                  {form.formState.errors.date.message}
                </p>
              )}
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>Start Time</Label>
                <Input type="time" {...form.register("startTime")} />
                {form.formState.errors.startTime && (
                  <p className="text-xs text-destructive">
                    {form.formState.errors.startTime.message}
                  </p>
                )}
              </div>
              <div className="space-y-1.5">
                <Label>End Time</Label>
                <Input type="time" {...form.register("endTime")} />
                {form.formState.errors.endTime && (
                  <p className="text-xs text-destructive">
                    {form.formState.errors.endTime.message}
                  </p>
                )}
              </div>
            </div>

            <div className="space-y-1.5">
              <Label>Break (minutes)</Label>
              <Input
                type="number"
                min={0}
                placeholder="0"
                {...form.register("breakMinutes")}
              />
            </div>

            <div className="space-y-1.5">
              <Label>Notes</Label>
              <Textarea
                placeholder="Optional notes..."
                {...form.register("notes")}
              />
            </div>

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenChange(false)}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={submitting}>
                {submitting && (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                )}
                Log Time
                {selectedCrewIds.length > 1
                  ? ` (${selectedCrewIds.length})`
                  : ""}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ─── Export Dialog ───────────────────────────────────────────────────────────

function ExportDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  const handleExport = () => {
    const params = new URLSearchParams();
    if (dateFrom) params.set("dateFrom", dateFrom);
    if (dateTo) params.set("dateTo", dateTo);
    const url = `/api/crew/timesheet${params.toString() ? `?${params}` : ""}`;
    window.open(url, "_blank");
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Export Timesheets</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>From</Label>
            <Input
              type="date"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label>To</Label>
            <Input
              type="date"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
            />
          </div>
          <p className="text-xs text-fg-3">
            Leave empty to export all time entries.
          </p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleExport}>
            <Download className="mr-2 h-3.5 w-3.5" />
            Export CSV
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
