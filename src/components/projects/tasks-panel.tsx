"use client";

import { useMemo, useState } from "react";
import { useServerMutation } from "@/hooks/use-server-mutation";
import { useProjectTaskWrites, type ProjectTaskInput } from "@/hooks/use-project-tasks-writes";
import { useProjectWorkData } from "@/hooks/use-project-work-data";

type BulkTaskPatch = Pick<
  ProjectTaskInput,
  "status" | "priority" | "dueDate" | "assigneeUserId" | "assigneeCrewId"
>;
import { toast } from "sonner";
import {
  Plus,

  Trash2,
  Pencil,
  Circle,
  CircleDot,
  CheckCircle2,
  CalendarClock,
  ListChecks,
  ChevronDown,
  X,
} from "lucide-react";

import { cn, focusRing } from "@/lib/utils";
import { useIsMobile } from "@/hooks/use-mobile";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { PersonAvatar } from "@/components/ui/avatar";
import { ComboboxPicker } from "@/components/ui/combobox-picker";
import { WorkComposer } from "@/components/work/work-composer";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu";
import { useSelection } from "./use-selection";
import { Checkbox } from "@/components/ui/checkbox";
import { BulkActionBar } from "@/components/ui/bulk-action-bar";
import { BulkDeleteDialog } from "@/components/ui/bulk-delete-dialog";
import {
  TASK_STATUS_LABELS,
  TASK_PRIORITY_LABELS,
  TASK_STAGES,
  TASK_STAGE_LABELS,
  TASK_RECURRENCE_FREQUENCIES,
  TASK_RECURRENCE_FREQUENCY_LABELS,
  type ProjectTaskRow,
  type ChecklistItem,
  type ProjectTaskStatus,
  type ProjectTaskPriority,
  type ProjectTaskRecurrenceFrequency,
} from "@/lib/project-tasks";

// Re-exported for existing consumers — the type itself now lives in
// project-tasks.ts (a plain lib module) so use-project-work-data.ts can
// reference it without a tasks-panel.tsx <-> use-project-work-data.ts
// import cycle (#1244; depcruise-ratchet.mjs).
export type Task = ProjectTaskRow;

/** "Group by" options the Work tab's list view offers (#1244, design §8.3).
 *  `status` is the pre-existing default and stays the panel's own baseline
 *  grouping — the others are additive. Pure so it's testable without React. */
export type TaskGroupBy = "status" | "stage" | "assignee" | "due";

const NO_STAGE_KEY = "none";
const UNASSIGNED_KEY = "unassigned";
const DUE_BUCKETS = ["overdue", "today", "week", "later", "none"] as const;
type DueBucketKey = (typeof DUE_BUCKETS)[number];
const DUE_BUCKET_LABELS: Record<DueBucketKey, string> = {
  overdue: "Overdue",
  today: "Today",
  week: "This week",
  later: "Later",
  none: "No date",
};

function dueBucketFor(dueDate: string | null, now: Date): DueBucketKey {
  if (!dueDate) return "none";
  const d = new Date(dueDate);
  const startOfToday = new Date(now);
  startOfToday.setHours(0, 0, 0, 0);
  const endOfToday = new Date(startOfToday);
  endOfToday.setHours(23, 59, 59, 999);
  const endOfWeek = new Date(startOfToday);
  endOfWeek.setDate(endOfWeek.getDate() + 7);
  if (d < startOfToday) return "overdue";
  if (d <= endOfToday) return "today";
  if (d <= endOfWeek) return "week";
  return "later";
}

function assigneeNameFor(task: Task): string | null {
  return (
    task.assigneeUser?.name ||
    (task.assigneeCrew && `${task.assigneeCrew.firstName} ${task.assigneeCrew.lastName}`.trim()) ||
    null
  );
}

const GROUP_BY_LABELS: Record<TaskGroupBy, string> = {
  status: "By status",
  stage: "By stage",
  assignee: "By assignee",
  due: "By due date",
};

export interface TaskSection {
  key: string;
  label: string;
  tasks: Task[];
}

/**
 * Builds the sections a groupBy renders, in a fixed and stable order per
 * grouping (never severity/count-sorted, matching the readiness panel's own
 * "rows don't reshuffle under the cursor" rule). `status` reproduces the
 * pre-#1244 grouping exactly (TODO / IN_PROGRESS / DONE / CANCELLED, empty
 * sections dropped).
 */
export function buildTaskSections(tasks: Task[], groupBy: TaskGroupBy, now: Date = new Date()): TaskSection[] {
  if (groupBy === "status") {
    const order: ProjectTaskStatus[] = ["TODO", "IN_PROGRESS", "DONE", "CANCELLED"];
    return order
      .map((status) => ({ key: status, label: TASK_STATUS_LABELS[status], tasks: tasks.filter((t) => t.status === status) }))
      .filter((s) => s.tasks.length > 0);
  }
  if (groupBy === "stage") {
    const sections = TASK_STAGES.map((stage) => ({
      key: stage,
      label: TASK_STAGE_LABELS[stage],
      tasks: tasks.filter((t) => t.stage === stage),
    })).filter((s) => s.tasks.length > 0);
    const none = tasks.filter((t) => !t.stage);
    return none.length > 0 ? [...sections, { key: NO_STAGE_KEY, label: "No stage", tasks: none }] : sections;
  }
  if (groupBy === "assignee") {
    const byName = new Map<string, Task[]>();
    const unassigned: Task[] = [];
    for (const t of tasks) {
      const name = assigneeNameFor(t);
      if (!name) { unassigned.push(t); continue; }
      const list = byName.get(name) ?? [];
      list.push(t);
      byName.set(name, list);
    }
    const sections = [...byName.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([name, list]) => ({ key: name, label: name, tasks: list }));
    return unassigned.length > 0 ? [...sections, { key: UNASSIGNED_KEY, label: "Unassigned", tasks: unassigned }] : sections;
  }
  // due
  return DUE_BUCKETS.map((bucket) => ({
    key: bucket,
    label: DUE_BUCKET_LABELS[bucket],
    tasks: tasks.filter((t) => dueBucketFor(t.dueDate, now) === bucket),
  })).filter((s) => s.tasks.length > 0);
}

const STATUS_ORDER: ProjectTaskStatus[] = ["TODO", "IN_PROGRESS", "DONE"];

// Priority dots: low = faint, normal = info blue, high = the --t-out threshold
// signal (reserved red, §1). Encoded by colour AND the priority label in the dialog.
const PRIORITY_DOT: Record<ProjectTaskPriority, string> = {
  LOW: "bg-faint",
  NORMAL: "bg-blue",
  HIGH: "bg-t-out",
};

function dueState(due: string | null): { label: string; overdue: boolean } | null {
  if (!due) return null;
  const d = new Date(due);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const overdue = d < today;
  return { label: d.toLocaleDateString(undefined, { month: "short", day: "numeric" }), overdue };
}

export function TasksPanel({ projectId, defaultGroupBy = "status" }: { projectId: string; defaultGroupBy?: TaskGroupBy }) {
  const [groupBy, setGroupBy] = useState<TaskGroupBy>(defaultGroupBy);
  const writes = useProjectTaskWrites();
  // #1244 — shared with the board/calendar views (one query, per-view is a
  // display over it, not a separate fetch of it — see the hook's own
  // comment for why calling it from each view independently is fine).
  const { tasks, isLoading, refetch, assignees } = useProjectWorkData(projectId);

  const [editing, setEditing] = useState<Task | null>(null);

  const invalidate = () => refetch();

  const updateMut = useServerMutation({
    mutationFn: (vars: { id: string; data: ProjectTaskInput }) =>
      writes.update(vars.id, vars.data),
    onSuccess: () => invalidate(),
    onError: (e: Error) => toast.error(e.message || "Could not update task"),
  });

  const deleteMut = useServerMutation({
    mutationFn: (id: string) => writes.remove(id),
    onSuccess: () => {
      invalidate();
      toast.success("Task deleted");
    },
    onError: (e: Error) => toast.error(e.message || "Could not delete task"),
  });

  // ─── Bulk selection ────────────────────────────────────────────────────────
  const selection = useSelection();
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);
  const allTaskIds = tasks.map((t) => t.id);
  const selectedTaskIds = allTaskIds.filter((id) => selection.isSelected(id));
  const allSelected = allTaskIds.length > 0 && selectedTaskIds.length === allTaskIds.length;

  const bulkUpdateMut = useServerMutation({
    mutationFn: (vars: { ids: string[]; patch: BulkTaskPatch }) =>
      writes.bulkUpdate(vars.ids, vars.patch),
    onSuccess: (r: { updated: number; skipped: number }) => {
      invalidate();
      selection.clearSelection();
      toast.success(`Updated ${r.updated} task${r.updated === 1 ? "" : "s"}`);
    },
    onError: (e: Error) => toast.error(e.message || "Could not update tasks"),
  });

  const bulkDeleteMut = useServerMutation({
    mutationFn: (ids: string[]) => writes.bulkDelete(ids),
    onSuccess: (r: { deleted: number; skipped: number }) => {
      invalidate();
      selection.clearSelection();
      setBulkDeleteOpen(false);
      toast.success(`Deleted ${r.deleted} task${r.deleted === 1 ? "" : "s"}`);
    },
    onError: (e: Error) => toast.error(e.message || "Could not delete tasks"),
  });

  const sections = useMemo(() => buildTaskSections(tasks, groupBy), [tasks, groupBy]);
  const openCount = tasks.filter((t) => t.status === "TODO" || t.status === "IN_PROGRESS").length;
  const doneCount = tasks.filter((t) => t.status === "DONE").length;

  // Assignee combobox options (users first, then crew).
  const assigneeOptions = useMemo(() => {
    const users = (assignees?.users ?? []).map((u) => ({ value: `u:${u.id}`, label: u.name }));
    const crew = (assignees?.crew ?? []).map((c) => ({
      value: `c:${c.id}`,
      label: `${c.firstName} ${c.lastName}`.trim(),
    }));
    return [...users, ...crew];
  }, [assignees]);

  // Watchers are always users, never crew (design §8.2 has no "crew watches
  // a task" concept) — unprefixed ids, unlike assigneeOptions' `u:`/`c:`.
  const userOptions = useMemo(
    () => (assignees?.users ?? []).map((u) => ({ value: u.id, label: u.name })),
    [assignees],
  );

  function cycleStatus(task: Task) {
    const next: ProjectTaskStatus =
      task.status === "DONE" ? "TODO" : task.status === "TODO" ? "IN_PROGRESS" : "DONE";
    updateMut.mutate({ id: task.id, data: { status: next } });
  }

  function toggleDone(task: Task) {
    updateMut.mutate({ id: task.id, data: { status: task.status === "DONE" ? "TODO" : "DONE" } });
  }

  return (
    <div className="space-y-5">
      {/* Quick add — the SAME composer Today, the rail and the Overview card
          use (R-3.1). The bare input it replaces could only ever set a title,
          so every dated or assigned task meant creating a row and immediately
          opening it to finish the job; the composer sets owner, stage, due
          date and priority before Add and says where the row will land.
          Always project-scoped here: no projectId would mean a personal task
          on Today, and every add on this tab carries one (design §8.3). */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start">
        <WorkComposer
          projectId={projectId}
          assignees={assignees}
          onCreated={invalidate}
          placeholder="Add work to this job…"
          className="min-w-0 flex-1"
        />
        <Select value={groupBy} onValueChange={(v) => setGroupBy(v as TaskGroupBy)}>
          <SelectTrigger className="shrink-0 sm:w-[140px]" aria-label="Group by">
            <SelectValue>{GROUP_BY_LABELS[groupBy]}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            {(Object.keys(GROUP_BY_LABELS) as TaskGroupBy[]).map((g) => (
              <SelectItem key={g} value={g}>
                {GROUP_BY_LABELS[g]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="flex items-center gap-3 rounded-[var(--r)] border border-line px-3 py-2.5">
              <Skeleton className="size-4 rounded-full" />
              <Skeleton className="h-3.5 flex-1" />
              <Skeleton className="h-4 w-12" />
            </div>
          ))}
        </div>
      ) : tasks.length === 0 ? (
        <div className="rounded-[var(--r-lg)] border-2 border-dashed border-line-2 py-10 text-center">
          <ListChecks className="mx-auto h-8 w-8 text-muted" />
          <p className="mt-2 text-ui-text font-medium text-ink-2">No tasks yet</p>
          <p className="text-caption text-muted">Add the first thing this project needs done.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {/* Bulk action bar — appears once one or more tasks are selected. */}
          <BulkActionBar
            count={selectedTaskIds.length}
            onClear={selection.clearSelection}
            itemLabel="task"
          >
            <label className="flex items-center gap-1.5 text-caption text-muted">
              <Checkbox
                aria-label="Select all tasks"
                checked={allSelected}
                onCheckedChange={(v: boolean | "indeterminate") =>
                  v === true
                    ? selection.selectAll(allTaskIds)
                    : selection.clearSelection()
                }
              />
              All
            </label>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button size="sm" variant="line">
                  Move to
                  <ChevronDown className="h-3 w-3" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start">
                {STATUS_ORDER.map((status) => (
                  <DropdownMenuItem
                    key={status}
                    onClick={() =>
                      bulkUpdateMut.mutate({ ids: selectedTaskIds, patch: { status } })
                    }
                  >
                    {TASK_STATUS_LABELS[status]}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button size="sm" variant="line">
                  Priority
                  <ChevronDown className="h-3 w-3" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start">
                {(Object.keys(TASK_PRIORITY_LABELS) as ProjectTaskPriority[]).map((priority) => (
                  <DropdownMenuItem
                    key={priority}
                    onClick={() =>
                      bulkUpdateMut.mutate({ ids: selectedTaskIds, patch: { priority } })
                    }
                  >
                    {TASK_PRIORITY_LABELS[priority]}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
            <Button
              size="sm"
              variant="line"
              className="text-destructive"
              onClick={() => setBulkDeleteOpen(true)}
            >
              <Trash2 className="mr-2 h-3 w-3" />
              Delete
            </Button>
          </BulkActionBar>

          <div className="space-y-5">
          {sections.map((section) => {
            const list = section.tasks;
            if (list.length === 0) return null;
            return (
              <section key={section.key} className="space-y-1.5">
                <h4 className="flex items-center gap-2 t-overline text-muted">
                  {section.label}
                  <span className="text-faint">{list.length}</span>
                </h4>
                <div className="divide-y divide-line rounded-[var(--r)] border border-line">
                  {list.map((task) => {
                    const due = dueState(task.dueDate);
                    const checklist = task.checklist ?? [];
                    const checklistDone = checklist.filter((c) => c.done).length;
                    const assigneeName =
                      task.assigneeUser?.name ||
                      (task.assigneeCrew && `${task.assigneeCrew.firstName} ${task.assigneeCrew.lastName}`.trim()) ||
                      null;
                    const isDone = task.status === "DONE";
                    return (
                      <div
                        key={task.id}
                        className={cn(
                          "group flex items-start gap-3 px-3 py-2.5",
                          selection.isSelected(task.id) && "bg-select",
                        )}
                      >
                        <span
                          className={cn(
                            "mt-0.5 inline-flex shrink-0 transition-opacity",
                            selection.isSelected(task.id) || selectedTaskIds.length > 0
                              ? "opacity-100"
                              : "opacity-0 pointer-coarse:opacity-100 group-hover:opacity-100",
                          )}
                        >
                          <Checkbox
                            aria-label="Select task"
                            checked={selection.isSelected(task.id)}
                            onCheckedChange={() => selection.toggle(task.id, true)}
                          />
                        </span>
                        <button
                          type="button"
                          title="Toggle done"
                          onClick={() => toggleDone(task)}
                          className={cn("mt-0.5 shrink-0 rounded-full text-muted hover:text-primary", focusRing)}
                        >
                          {isDone ? (
                            <CheckCircle2 className="h-[18px] w-[18px] text-primary" />
                          ) : task.status === "IN_PROGRESS" ? (
                            <CircleDot className="h-[18px] w-[18px] text-blue" />
                          ) : (
                            <Circle className="h-[18px] w-[18px]" />
                          )}
                        </button>

                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <span
                              className={cn("h-1.5 w-1.5 shrink-0 rounded-full", PRIORITY_DOT[task.priority])}
                              aria-label={`${TASK_PRIORITY_LABELS[task.priority]} priority`}
                              title={`${TASK_PRIORITY_LABELS[task.priority]} priority`}
                            />
                            {task.priority !== "NORMAL" && (
                              <span
                                className={cn(
                                  "shrink-0 text-caption font-medium",
                                  task.priority === "HIGH" ? "text-t-out" : "text-faint",
                                )}
                              >
                                {TASK_PRIORITY_LABELS[task.priority]}
                              </span>
                            )}
                            <button
                              type="button"
                              onClick={() => setEditing(task)}
                              className={cn(
                                "truncate rounded-sm text-left text-table-cell text-ink-2 hover:underline",
                                focusRing,
                                isDone && "text-muted line-through",
                              )}
                            >
                              {task.title}
                            </button>
                          </div>
                          {(due || assigneeName || checklist.length > 0) && (
                            <div className="mt-1 flex flex-wrap items-center gap-1.5">
                              {due && (
                                <span
                                  className={cn(
                                    "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-badge font-medium",
                                    due.overdue && !isDone
                                      ? "bg-out-soft text-t-out"
                                      : "bg-paper-2 text-muted",
                                  )}
                                >
                                  <CalendarClock className="h-3 w-3" />
                                  {due.label}
                                </span>
                              )}
                              {checklist.length > 0 && (
                                <span className="inline-flex items-center gap-1 rounded-full bg-paper-2 px-2 py-0.5 text-badge font-medium text-muted">
                                  <ListChecks className="h-3 w-3" />
                                  {checklistDone}/{checklist.length}
                                </span>
                              )}
                              {assigneeName && (
                                <span className="flex items-center gap-1 text-caption text-muted">
                                  <PersonAvatar
                                    name={assigneeName}
                                    src={task.assigneeUser?.image ?? undefined}
                                    className="size-5 border-0"
                                  />
                                  {assigneeName}
                                </span>
                              )}
                            </div>
                          )}
                        </div>

                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="size-11 opacity-0 pointer-coarse:opacity-100 group-hover:opacity-100 md:size-8"
                              title="Task actions"
                            >
                              <Pencil className="h-3.5 w-3.5" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onClick={() => setEditing(task)}>Edit…</DropdownMenuItem>
                            <DropdownMenuItem onClick={() => cycleStatus(task)}>
                              Move to next status
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              className="text-t-out"
                              onClick={() => deleteMut.mutate(task.id)}
                            >
                              <Trash2 className="mr-2 h-3.5 w-3.5" /> Delete
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                    );
                  })}
                </div>
              </section>
            );
          })}
          </div>
        </div>
      )}

      {tasks.length > 0 && (
        <p className="text-caption text-muted">
          {openCount} open · {doneCount} done
        </p>
      )}

      <BulkDeleteDialog
        open={bulkDeleteOpen}
        onOpenChange={setBulkDeleteOpen}
        title="Delete selected tasks"
        description="This permanently removes the selected tasks from the project."
        count={selectedTaskIds.length}
        itemLabel="task"
        pending={bulkDeleteMut.isPending}
        onConfirm={() => bulkDeleteMut.mutate(selectedTaskIds)}
      />

      {editing && (
        <TaskEditDialog
          task={editing}
          assigneeOptions={assigneeOptions}
          userOptions={userOptions}
          onClose={() => setEditing(null)}
          onSave={(data) => {
            void updateMut
              .mutateAsync({ id: editing.id, data })
              .then(() => setEditing(null))
              .catch(() => {});
          }}
        />
      )}
    </div>
  );
}

// ─── Edit dialog ──────────────────────────────────────────────────────────

const NO_RECURRENCE = "none" as const;
type RecurrenceChoice = typeof NO_RECURRENCE | ProjectTaskRecurrenceFrequency;

function TaskEditDialog({
  task,
  assigneeOptions,
  userOptions,
  onClose,
  onSave,
}: {
  task: Task;
  assigneeOptions: { value: string; label: string }[];
  /** Users only (never crew) — recurrence/watchers are user concepts. */
  userOptions: { value: string; label: string }[];
  onClose: () => void;
  onSave: (data: ProjectTaskInput) => void;
}) {
  const [title, setTitle] = useState(task.title);
  const [description, setDescription] = useState(task.description ?? "");
  const [status, setStatus] = useState<ProjectTaskStatus>(task.status);
  const [priority, setPriority] = useState<ProjectTaskPriority>(task.priority);
  const [dueDate, setDueDate] = useState(task.dueDate ? task.dueDate.slice(0, 10) : "");
  const [startDate, setStartDate] = useState(task.startDate ? task.startDate.slice(0, 10) : "");
  const [assignee, setAssignee] = useState(
    task.assigneeUserId ? `u:${task.assigneeUserId}` : task.assigneeCrewId ? `c:${task.assigneeCrewId}` : "",
  );
  const [checklist, setChecklist] = useState<ChecklistItem[]>(task.checklist ?? []);
  const [newItem, setNewItem] = useState("");
  const [recurrenceFreq, setRecurrenceFreq] = useState<RecurrenceChoice>(task.recurrence?.freq ?? NO_RECURRENCE);
  const [watcherUserIds, setWatcherUserIds] = useState<string[]>(task.watcherUserIds ?? []);
  const [addWatcher, setAddWatcher] = useState("");
  const isMobile = useIsMobile();

  function addChecklistItem() {
    const text = newItem.trim();
    if (!text) return;
    setChecklist((prev) => [...prev, { id: crypto.randomUUID(), text, done: false }]);
    setNewItem("");
  }

  function save() {
    if (!title.trim()) return;
    const isUser = assignee.startsWith("u:");
    const isCrew = assignee.startsWith("c:");
    onSave({
      title: title.trim(),
      description: description.trim() || null,
      status,
      priority,
      dueDate: dueDate || null,
      // A start with no end is not a span; clear it rather than storing a
      // date nothing can render (same rule as the composer's resolveWorkDates
      // and the mutation's assertDateSpanOrdered).
      startDate: (dueDate && startDate) || null,
      assigneeUserId: isUser ? assignee.slice(2) : null,
      assigneeCrewId: isCrew ? assignee.slice(2) : null,
      checklist,
      recurrence: recurrenceFreq === NO_RECURRENCE ? null : { freq: recurrenceFreq },
      watcherUserIds: watcherUserIds.length > 0 ? watcherUserIds : null,
    });
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        className={cn(
          isMobile
            ? "h-[100dvh] max-h-[100dvh] w-full max-w-full rounded-none border-0 overflow-y-auto"
            : "sm:max-w-md",
        )}
        style={
          isMobile
            ? { paddingTop: "env(safe-area-inset-top, 0px)", paddingBottom: "env(safe-area-inset-bottom, 0px)" }
            : undefined
        }
      >
        <DialogHeader>
          <DialogTitle>Edit task</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Task title" />
          <Textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Description (optional)"
            rows={2}
          />
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-caption text-muted">Status</label>
              <Select value={status} onValueChange={(v) => setStatus(v as ProjectTaskStatus)}>
                <SelectTrigger>
                  <SelectValue>{TASK_STATUS_LABELS[status]}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {STATUS_ORDER.map((s) => (
                    <SelectItem key={s} value={s}>
                      {TASK_STATUS_LABELS[s]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="mb-1 block text-caption text-muted">Priority</label>
              <Select value={priority} onValueChange={(v) => setPriority(v as ProjectTaskPriority)}>
                <SelectTrigger>
                  <SelectValue>{TASK_PRIORITY_LABELS[priority]}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {(["LOW", "NORMAL", "HIGH"] as ProjectTaskPriority[]).map((p) => (
                    <SelectItem key={p} value={p}>
                      {TASK_PRIORITY_LABELS[p]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-caption text-muted">Due date</label>
              <Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
            </div>
            <div>
              <label className="mb-1 block text-caption text-muted">Starts on</label>
              {/* Only once there is a deadline to run to — a start with no due
                  date describes no span. `max` lets the browser refuse an
                  inverted one before the mutation has to. */}
              <Input
                type="date"
                value={startDate}
                max={dueDate || undefined}
                disabled={!dueDate}
                onChange={(e) => setStartDate(e.target.value)}
              />
            </div>
            <div className="col-span-2">
              <label className="mb-1 block text-caption text-muted">Assignee</label>
              <ComboboxPicker
                value={assignee}
                onChange={setAssignee}
                options={assigneeOptions}
                placeholder="Unassigned"
                allowClear
              />
            </div>
          </div>

          {/* Checklist */}
          <div>
            <label className="mb-1 block text-caption text-muted">Checklist</label>
            <div className="space-y-1">
              {checklist.map((item) => (
                <div key={item.id} className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() =>
                      setChecklist((prev) =>
                        prev.map((c) => (c.id === item.id ? { ...c, done: !c.done } : c)),
                      )
                    }
                    className={cn("shrink-0 rounded-full text-muted hover:text-primary", focusRing)}
                  >
                    {item.done ? (
                      <CheckCircle2 className="h-4 w-4 text-primary" />
                    ) : (
                      <Circle className="h-4 w-4" />
                    )}
                  </button>
                  <span className={cn("flex-1 text-ui-text text-ink-2", item.done && "text-muted line-through")}>
                    {item.text}
                  </span>
                  <button
                    type="button"
                    onClick={() => setChecklist((prev) => prev.filter((c) => c.id !== item.id))}
                    className={cn("rounded-sm text-faint hover:text-t-out", focusRing)}
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
              <div className="flex items-center gap-2">
                <Input
                  value={newItem}
                  onChange={(e) => setNewItem(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      addChecklistItem();
                    }
                  }}
                  placeholder="Add sub-step…"
                  className="h-8 text-ui-text"
                />
                <Button type="button" variant="line" size="sm" onClick={addChecklistItem}>
                  <Plus className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
          </div>

          {/* #1244 — recurrence + watchers. A subtask never carries either
              (the mutation silently ignores a recurrence patch on one), but
              the dialog itself opens on top-level tasks only today. */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-caption text-muted">Repeats</label>
              <Select value={recurrenceFreq} onValueChange={(v) => setRecurrenceFreq(v as RecurrenceChoice)}>
                <SelectTrigger>
                  <SelectValue>
                    {recurrenceFreq === NO_RECURRENCE ? "Doesn't repeat" : TASK_RECURRENCE_FREQUENCY_LABELS[recurrenceFreq]}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_RECURRENCE}>Doesn&apos;t repeat</SelectItem>
                  {TASK_RECURRENCE_FREQUENCIES.map((f) => (
                    <SelectItem key={f} value={f}>
                      {TASK_RECURRENCE_FREQUENCY_LABELS[f]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="mb-1 block text-caption text-muted">Add a watcher</label>
              <ComboboxPicker
                value={addWatcher}
                onChange={(v) => {
                  if (v && !watcherUserIds.includes(v)) setWatcherUserIds((prev) => [...prev, v]);
                  setAddWatcher("");
                }}
                options={userOptions.filter((o) => !watcherUserIds.includes(o.value))}
                placeholder="Choose a person…"
              />
            </div>
          </div>
          {watcherUserIds.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {watcherUserIds.map((id) => {
                const name = userOptions.find((o) => o.value === id)?.label ?? id;
                return (
                  <span
                    key={id}
                    className="inline-flex items-center gap-1 rounded-full bg-paper-2 px-2 py-0.5 text-badge font-medium text-muted"
                  >
                    {name}
                    <button
                      type="button"
                      onClick={() => setWatcherUserIds((prev) => prev.filter((w) => w !== id))}
                      className={cn("rounded-sm text-faint hover:text-t-out", focusRing)}
                      aria-label={`Stop ${name} watching`}
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </span>
                );
              })}
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="line" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={save} disabled={!title.trim()}>
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
