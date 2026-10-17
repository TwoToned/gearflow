"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Plus, Trash2, Pencil } from "lucide-react";

import { cn, focusRing } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useProjectTaskWrites, type ProjectTaskInput } from "@/hooks/use-project-tasks-writes";
import { useProjectTaskList } from "@/hooks/use-project-task-list";
import {
  TASK_STATUSES,
  TASK_STATUS_LABELS,
  TASK_PRIORITIES,
  TASK_PRIORITY_LABELS,
  type ProjectTaskRow,
  type ProjectTaskStatus,
  type ProjectTaskPriority,
} from "@/lib/project-tasks";

export type Task = ProjectTaskRow;

const NO_ASSIGNEE = "none";

function assigneeLabel(task: Task): string | null {
  return (
    task.assigneeUser?.name ||
    (task.assigneeCrew && `${task.assigneeCrew.firstName} ${task.assigneeCrew.lastName}`.trim()) ||
    null
  );
}

function dueState(due: string | null): { label: string; overdue: boolean } | null {
  if (!due) return null;
  const d = new Date(due);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return { label: d.toLocaleDateString(undefined, { month: "short", day: "numeric" }), overdue: d < today };
}

/** The basic project task list: add, tick off, edit, delete. Nothing automated. */
export function TasksPanel({ projectId }: { projectId: string }) {
  const writes = useProjectTaskWrites();
  const { tasks, isLoading, refetch, assignees } = useProjectTaskList(projectId);
  const [title, setTitle] = useState("");
  const [editing, setEditing] = useState<Task | null>(null);

  async function run(fn: () => Promise<unknown>, failMsg: string) {
    try {
      await fn();
      refetch();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : failMsg);
    }
  }

  const add = (e: React.FormEvent) => {
    e.preventDefault();
    const t = title.trim();
    if (!t) return;
    setTitle("");
    void run(() => writes.create({ projectId, title: t }), "Could not add task");
  };

  const open = tasks.filter((t) => t.status === "TODO" || t.status === "IN_PROGRESS");
  const closed = tasks.filter((t) => t.status === "DONE" || t.status === "CANCELLED");

  if (isLoading) return <Skeleton className="h-40 w-full rounded-[var(--r-lg)]" />;

  return (
    <div className="space-y-4">
      <form onSubmit={add} className="flex gap-2">
        <Input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Add a task…"
          aria-label="New task title"
          maxLength={200}
        />
        <Button type="submit" size="sm" disabled={!title.trim()}>
          <Plus className="h-4 w-4" /> Add
        </Button>
      </form>

      {tasks.length === 0 ? (
        <p className="t-micro text-faint">No tasks yet.</p>
      ) : (
        <>
          <TaskList tasks={open} onToggle={(t) => run(() => writes.update(t.id, { status: "DONE" }), "Could not update task")} onEdit={setEditing} />
          {closed.length > 0 && (
            <section aria-label="Closed tasks" className="space-y-2">
              <h3 className="t-overline text-muted">Closed · {closed.length}</h3>
              <TaskList tasks={closed} onToggle={(t) => run(() => writes.update(t.id, { status: "TODO" }), "Could not update task")} onEdit={setEditing} />
            </section>
          )}
        </>
      )}

      {editing && (
        <EditTaskDialog
          task={editing}
          assignees={assignees}
          onClose={() => setEditing(null)}
          onSave={async (data) => {
            await run(() => writes.update(editing.id, data), "Could not save task");
            setEditing(null);
          }}
          onDelete={async () => {
            await run(() => writes.remove(editing.id), "Could not delete task");
            setEditing(null);
          }}
        />
      )}
    </div>
  );
}

function TaskList({ tasks, onToggle, onEdit }: { tasks: Task[]; onToggle: (t: Task) => void; onEdit: (t: Task) => void }) {
  return (
    <ul className="flex flex-col gap-2">
      {tasks.map((t) => {
        const due = dueState(t.dueDate);
        const who = assigneeLabel(t);
        const done = t.status === "DONE" || t.status === "CANCELLED";
        return (
          <li key={t.id} className="flex items-center gap-3 rounded-[var(--r)] border border-line p-3">
            <Checkbox checked={done} onCheckedChange={() => onToggle(t)} aria-label={done ? `Reopen ${t.title}` : `Complete ${t.title}`} />
            <div className="min-w-0 flex-1">
              <p className={cn("truncate text-[14px] font-medium", done ? "text-faint line-through" : "text-ink")}>{t.title}</p>
              <p className="t-micro text-faint">
                {TASK_STATUS_LABELS[t.status]}
                {t.priority === "HIGH" ? " · High priority" : ""}
                {who ? ` · ${who}` : ""}
                {due ? " · " : ""}
                {due && <span className={due.overdue && !done ? "text-t-out" : undefined}>Due {due.label}</span>}
              </p>
            </div>
            <Button type="button" variant="ghost" size="sm" onClick={() => onEdit(t)} aria-label={`Edit ${t.title}`} className={focusRing}>
              <Pencil className="h-4 w-4" />
            </Button>
          </li>
        );
      })}
    </ul>
  );
}

function EditTaskDialog({
  task,
  assignees,
  onClose,
  onSave,
  onDelete,
}: {
  task: Task;
  assignees: { users: { id: string; name: string }[]; crew: { id: string; firstName: string; lastName: string }[] } | undefined;
  onClose: () => void;
  onSave: (data: ProjectTaskInput) => Promise<void>;
  onDelete: () => Promise<void>;
}) {
  const [title, setTitle] = useState(task.title);
  const [description, setDescription] = useState(task.description ?? "");
  const [status, setStatus] = useState<ProjectTaskStatus>(task.status);
  const [priority, setPriority] = useState<ProjectTaskPriority>(task.priority);
  const [dueDate, setDueDate] = useState(task.dueDate ? task.dueDate.slice(0, 10) : "");
  const [assignee, setAssignee] = useState(
    task.assigneeUserId ? `u:${task.assigneeUserId}` : task.assigneeCrewId ? `c:${task.assigneeCrewId}` : NO_ASSIGNEE,
  );

  const assigneeText = (value: string) => {
    if (value.startsWith("u:")) return assignees?.users.find((u) => u.id === value.slice(2))?.name ?? "Assigned";
    if (value.startsWith("c:")) {
      const c = assignees?.crew.find((x) => x.id === value.slice(2));
      return c ? `${c.firstName} ${c.lastName}` : "Assigned";
    }
    return "Unassigned";
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit task</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <Input value={title} onChange={(e) => setTitle(e.target.value)} aria-label="Title" maxLength={200} />
          <Textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Notes…" aria-label="Description" rows={3} />
          <div className="grid grid-cols-2 gap-3">
            <Select value={status} onValueChange={(v) => setStatus(v as ProjectTaskStatus)}>
              <SelectTrigger aria-label="Status"><SelectValue>{TASK_STATUS_LABELS[status]}</SelectValue></SelectTrigger>
              <SelectContent>
                {TASK_STATUSES.map((s) => <SelectItem key={s} value={s}>{TASK_STATUS_LABELS[s]}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={priority} onValueChange={(v) => setPriority(v as ProjectTaskPriority)}>
              <SelectTrigger aria-label="Priority"><SelectValue>{TASK_PRIORITY_LABELS[priority]}</SelectValue></SelectTrigger>
              <SelectContent>
                {TASK_PRIORITIES.map((p) => <SelectItem key={p} value={p}>{TASK_PRIORITY_LABELS[p]}</SelectItem>)}
              </SelectContent>
            </Select>
            <Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} aria-label="Due date" />
            <Select value={assignee} onValueChange={setAssignee}>
              <SelectTrigger aria-label="Assignee"><SelectValue>{assigneeText(assignee)}</SelectValue></SelectTrigger>
              <SelectContent>
                <SelectItem value={NO_ASSIGNEE}>Unassigned</SelectItem>
                {assignees?.users.map((u) => <SelectItem key={u.id} value={`u:${u.id}`}>{u.name}</SelectItem>)}
                {assignees?.crew.map((c) => <SelectItem key={c.id} value={`c:${c.id}`}>{c.firstName} {c.lastName} (crew)</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter className="justify-between sm:justify-between">
          <Button type="button" variant="ghost" onClick={() => void onDelete()}>
            <Trash2 className="h-4 w-4" /> Delete
          </Button>
          <Button
            type="button"
            disabled={!title.trim()}
            onClick={() =>
              void onSave({
                title: title.trim(),
                description: description.trim() || null,
                status,
                priority,
                dueDate: dueDate || null,
                assigneeUserId: assignee.startsWith("u:") ? assignee.slice(2) : null,
                assigneeCrewId: assignee.startsWith("c:") ? assignee.slice(2) : null,
              })
            }
          >
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
