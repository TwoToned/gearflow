"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useServerMutation } from "@/hooks/use-server-mutation";
import { useServerQuery } from "@/hooks/use-server-query";
import { useProjectTasks as useConvexProjectTasks } from "@/hooks/use-projects";
import { toast } from "sonner";
import {
  Plus,
  Loader2,
  Trash2,
  Pencil,
  Circle,
  CircleDot,
  CheckCircle2,
  CalendarClock,
  ListChecks,
  X,
} from "lucide-react";

import { cn, focusRing } from "@/lib/utils";
import { useIsMobile } from "@/hooks/use-mobile";
import { useActiveOrganization } from "@/lib/auth-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { PersonAvatar } from "@/components/ui/avatar";
import { ComboboxPicker } from "@/components/ui/combobox-picker";
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
import {
  getProjectTasks,
  getTaskAssignees,
  createProjectTask,
  updateProjectTask,
  deleteProjectTask,
} from "@/server/project-tasks";
import {
  TASK_STATUS_LABELS,
  TASK_PRIORITY_LABELS,
  type ChecklistItem,
  type ProjectTaskStatus,
  type ProjectTaskPriority,
} from "@/lib/project-tasks";

// Loosely-typed task row (server include shape; serialised dates are strings).
type Task = {
  id: string;
  title: string;
  description: string | null;
  status: ProjectTaskStatus;
  priority: ProjectTaskPriority;
  dueDate: string | null;
  checklist: ChecklistItem[] | null;
  assigneeUserId: string | null;
  assigneeCrewId: string | null;
  assigneeUser: { id: string; name: string; image: string | null } | null;
  assigneeCrew: { id: string; firstName: string; lastName: string } | null;
};

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

export function TasksPanel({ projectId }: { projectId: string }) {
  const { data: activeOrg } = useActiveOrganization();
  const orgId = activeOrg?.id;
  const tasksKey = ["project-tasks", orgId, projectId];

  const { data: tasks = [], isLoading, refetch } = useServerQuery({
    queryKey: tasksKey,
    queryFn: () => getProjectTasks(projectId) as unknown as Promise<Task[]>,
  });

  const { data: assignees } = useServerQuery({
    queryKey: ["task-assignees", orgId],
    queryFn: () =>
      getTaskAssignees() as unknown as Promise<{
        users: { id: string; name: string; image: string | null }[];
        crew: { id: string; firstName: string; lastName: string }[];
      }>,
  });

  const [newTitle, setNewTitle] = useState("");
  const [editing, setEditing] = useState<Task | null>(null);

  const invalidate = () => refetch();

  // Cross-tab live sync: subscribe to the dual-written Convex projectTasks table.
  // When another tab creates/edits/deletes a task, the mirror pushes the change;
  // the fingerprint flips and we refetch the server-action read (which carries
  // assignee join data Convex doesn't hold).
  const taskDocs = useConvexProjectTasks(projectId, orgId);
  const taskFp =
    taskDocs === undefined
      ? undefined
      : taskDocs
          .map((t) => {
            const r = t as { id: string; updatedAt?: number; status?: string; title?: string; priority?: string; dueDate?: number; assigneeUserId?: string; assigneeCrewId?: string; sortOrder?: number; completedAt?: number };
            return `${r.id}:${r.updatedAt ?? 0}:${r.status ?? ""}:${r.title ?? ""}:${r.priority ?? ""}:${r.dueDate ?? ""}:${r.assigneeUserId ?? ""}:${r.assigneeCrewId ?? ""}:${r.sortOrder ?? ""}:${r.completedAt ?? ""}`;
          })
          .sort()
          .join("|");
  const prevTaskFp = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (taskFp !== undefined && prevTaskFp.current !== undefined && taskFp !== prevTaskFp.current) {
      refetch();
    }
    if (taskFp !== undefined) prevTaskFp.current = taskFp;
  }, [taskFp, refetch]);

  const createMut = useServerMutation({
    mutationFn: (title: string) => createProjectTask({ projectId, title }),
    onSuccess: () => {
      invalidate();
      setNewTitle("");
    },
    onError: (e: Error) => toast.error(e.message || "Could not add task"),
  });

  const updateMut = useServerMutation({
    mutationFn: (vars: { id: string; data: Parameters<typeof updateProjectTask>[1] }) =>
      updateProjectTask(vars.id, vars.data),
    onSuccess: () => invalidate(),
    onError: (e: Error) => toast.error(e.message || "Could not update task"),
  });

  const deleteMut = useServerMutation({
    mutationFn: (id: string) => deleteProjectTask(id),
    onSuccess: () => {
      invalidate();
      toast.success("Task deleted");
    },
    onError: (e: Error) => toast.error(e.message || "Could not delete task"),
  });

  const grouped = useMemo(() => {
    const g: Record<ProjectTaskStatus, Task[]> = { TODO: [], IN_PROGRESS: [], DONE: [] };
    for (const t of tasks) g[t.status]?.push(t);
    return g;
  }, [tasks]);

  const openCount = grouped.TODO.length + grouped.IN_PROGRESS.length;

  // Assignee combobox options (users first, then crew).
  const assigneeOptions = useMemo(() => {
    const users = (assignees?.users ?? []).map((u) => ({ value: `u:${u.id}`, label: u.name }));
    const crew = (assignees?.crew ?? []).map((c) => ({
      value: `c:${c.id}`,
      label: `${c.firstName} ${c.lastName}`.trim(),
    }));
    return [...users, ...crew];
  }, [assignees]);

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
      {/* Quick add */}
      <div className="flex items-center gap-2">
        <Input
          placeholder="Add a task and press Enter…"
          value={newTitle}
          onChange={(e) => setNewTitle(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && newTitle.trim()) createMut.mutate(newTitle.trim());
          }}
        />
        <Button
          onClick={() => newTitle.trim() && createMut.mutate(newTitle.trim())}
          disabled={!newTitle.trim() || createMut.isPending}
        >
          {createMut.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
          <span className="ml-1.5 hidden sm:inline">Add</span>
        </Button>
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
        <div className="space-y-5">
          {STATUS_ORDER.map((status) => {
            const list = grouped[status];
            if (list.length === 0) return null;
            return (
              <section key={status} className="space-y-1.5">
                <h4 className="flex items-center gap-2 t-overline text-muted">
                  {TASK_STATUS_LABELS[status]}
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
                      <div key={task.id} className="group flex items-start gap-3 px-3 py-2.5">
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
                            <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", PRIORITY_DOT[task.priority])} />
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
                              className="size-8 opacity-0 group-hover:opacity-100"
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
      )}

      {tasks.length > 0 && (
        <p className="text-xs text-muted">
          {openCount} open · {grouped.DONE.length} done
        </p>
      )}

      {editing && (
        <TaskEditDialog
          task={editing}
          assigneeOptions={assigneeOptions}
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

function TaskEditDialog({
  task,
  assigneeOptions,
  onClose,
  onSave,
}: {
  task: Task;
  assigneeOptions: { value: string; label: string }[];
  onClose: () => void;
  onSave: (data: Parameters<typeof updateProjectTask>[1]) => void;
}) {
  const [title, setTitle] = useState(task.title);
  const [description, setDescription] = useState(task.description ?? "");
  const [status, setStatus] = useState<ProjectTaskStatus>(task.status);
  const [priority, setPriority] = useState<ProjectTaskPriority>(task.priority);
  const [dueDate, setDueDate] = useState(task.dueDate ? task.dueDate.slice(0, 10) : "");
  const [assignee, setAssignee] = useState(
    task.assigneeUserId ? `u:${task.assigneeUserId}` : task.assigneeCrewId ? `c:${task.assigneeCrewId}` : "",
  );
  const [checklist, setChecklist] = useState<ChecklistItem[]>(task.checklist ?? []);
  const [newItem, setNewItem] = useState("");
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
      assigneeUserId: isUser ? assignee.slice(2) : null,
      assigneeCrewId: isCrew ? assignee.slice(2) : null,
      checklist,
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
              <label className="mb-1 block text-xs text-muted">Status</label>
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
              <label className="mb-1 block text-xs text-muted">Priority</label>
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
              <label className="mb-1 block text-xs text-muted">Due date</label>
              <Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
            </div>
            <div>
              <label className="mb-1 block text-xs text-muted">Assignee</label>
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
            <label className="mb-1 block text-xs text-muted">Checklist</label>
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
                  className="h-8 text-sm"
                />
                <Button type="button" variant="line" size="sm" onClick={addChecklistItem}>
                  <Plus className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
          </div>
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
