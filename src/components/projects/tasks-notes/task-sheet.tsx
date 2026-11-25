"use client";

import * as React from "react";
import { Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { TaskLinkChips } from "@/components/projects/tasks-notes/task-link-chips";
import { useIsMobile } from "@/hooks/use-mobile";
import type { TaskLink } from "@/lib/task-links";
import type { ProjectTaskInput } from "@/hooks/use-project-tasks-writes";
import { formatDate } from "@/lib/formatters";
import {
  TASK_PRIORITIES,
  TASK_PRIORITY_LABELS,
  TASK_STATUSES,
  TASK_STATUS_LABELS,
  type ProjectTaskPriority,
  type ProjectTaskRow,
  type ProjectTaskStatus,
} from "@/lib/project-tasks";
import type { Assignable } from "@/lib/row-actions/task-bulk";

const NO_ASSIGNEE = "none";

/** `Added by Sam · 6 Nov · done 8 Nov` from what the read returned; nothing when it has none. */
function historyLine(t: ProjectTaskRow): string | null {
  const parts = [
    t.createdAt ? `Added${t.createdByName ? ` by ${t.createdByName}` : ""} ${formatDate(new Date(t.createdAt))}` : null,
    t.completedAt ? `done ${formatDate(new Date(t.completedAt))}` : null,
  ].filter(Boolean);
  return parts.length > 0 ? parts.join(" · ") : null;
}

function assigneeText(value: string, assignees: Assignable | undefined): string {
  if (value.startsWith("u:")) return assignees?.users.find((u) => u.id === value.slice(2))?.name ?? "Assigned";
  const c = value.startsWith("c:") ? assignees?.crew.find((x) => x.id === value.slice(2)) : undefined;
  if (c) return `${c.firstName} ${c.lastName}`;
  return value.startsWith("c:") ? "Assigned" : "Unassigned";
}

/** The sheet's `Linked` list (Slice E): every link, each openable and removable; nothing when there are none. */
function LinkedList({ links, onOpen, onRemove }: { links?: readonly TaskLink[]; onOpen?: (l: TaskLink) => void; onRemove?: (l: TaskLink) => void }) {
  if (!links || links.length === 0) return null;
  return (
    <div className="space-y-1">
      <p className="text-overline uppercase tracking-wide text-muted">Linked</p>
      <TaskLinkChips links={links} showAll onOpen={onOpen} onRemove={onRemove} />
    </div>
  );
}

/**
 * The task sheet (UX Phase 10, spec §8c; a Radix `Sheet`, a bottom sheet on a
 * phone): every live field (title, description, assignee from team + crew, due,
 * status, priority) plus a history line. Delete asks to confirm; its toast then
 * offers an exact Undo. A save is ONE `update` call (`useTaskActions.patch`).
 */
export function TaskSheet({
  task,
  assignees,
  onClose,
  onSave,
  onDelete,
  links,
  onOpenLink,
  onUnlink,
}: {
  task: ProjectTaskRow;
  assignees: Assignable | undefined;
  onClose: () => void;
  onSave: (data: ProjectTaskInput) => void;
  onDelete: () => void;
  /** This task's links (Slice E), each openable and removable. Absent = no Linked section. */
  links?: readonly TaskLink[];
  onOpenLink?: (link: TaskLink) => void;
  onUnlink?: (link: TaskLink) => void;
}) {
  const isMobile = useIsMobile();
  const [title, setTitle] = React.useState(task.title);
  const [description, setDescription] = React.useState(task.description ?? "");
  const [status, setStatus] = React.useState<ProjectTaskStatus>(task.status);
  const [priority, setPriority] = React.useState<ProjectTaskPriority>(task.priority);
  const [dueDate, setDueDate] = React.useState(task.dueDate ? task.dueDate.slice(0, 10) : "");
  const [assignee, setAssignee] = React.useState(
    task.assigneeUserId ? `u:${task.assigneeUserId}` : task.assigneeCrewId ? `c:${task.assigneeCrewId}` : NO_ASSIGNEE,
  );
  const history = historyLine(task);
  const [confirmingDelete, setConfirmingDelete] = React.useState(false);

  const save = () =>
    onSave({
      title: title.trim(),
      description: description.trim() || null,
      status,
      priority,
      dueDate: dueDate || null,
      assigneeUserId: assignee.startsWith("u:") ? assignee.slice(2) : null,
      assigneeCrewId: assignee.startsWith("c:") ? assignee.slice(2) : null,
    });

  return (
    <Sheet open onOpenChange={(o) => !o && onClose()}>
      <SheetContent side={isMobile ? "bottom" : "right"} className="sm:max-w-md">
        <SheetHeader>
          <SheetTitle>Task</SheetTitle>
          <SheetDescription>{history ?? "Edit this task."}</SheetDescription>
        </SheetHeader>
        <div className="space-y-3">
          <Input value={title} onChange={(e) => setTitle(e.target.value)} aria-label="Title" maxLength={200} className="text-base" />
          <Textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Notes…" aria-label="Description" rows={3} className="text-base" />
          <div className="grid grid-cols-2 gap-3">
            <Select value={status} onValueChange={(v) => setStatus(v as ProjectTaskStatus)}>
              <SelectTrigger aria-label="Status"><SelectValue>{TASK_STATUS_LABELS[status]}</SelectValue></SelectTrigger>
              <SelectContent>{TASK_STATUSES.map((s) => <SelectItem key={s} value={s}>{TASK_STATUS_LABELS[s]}</SelectItem>)}</SelectContent>
            </Select>
            <Select value={priority} onValueChange={(v) => setPriority(v as ProjectTaskPriority)}>
              <SelectTrigger aria-label="Priority"><SelectValue>{TASK_PRIORITY_LABELS[priority]}</SelectValue></SelectTrigger>
              <SelectContent>{TASK_PRIORITIES.map((p) => <SelectItem key={p} value={p}>{TASK_PRIORITY_LABELS[p]}</SelectItem>)}</SelectContent>
            </Select>
            <Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} aria-label="Due date" className="text-base" />
            <Select value={assignee} onValueChange={setAssignee}>
              <SelectTrigger aria-label="Assignee"><SelectValue>{assigneeText(assignee, assignees)}</SelectValue></SelectTrigger>
              <SelectContent>
                <SelectItem value={NO_ASSIGNEE}>Unassigned</SelectItem>
                {assignees?.users.map((u) => <SelectItem key={u.id} value={`u:${u.id}`}>{u.name}</SelectItem>)}
                {assignees?.crew.map((c) => <SelectItem key={c.id} value={`c:${c.id}`}>{c.firstName} {c.lastName} (crew)</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <LinkedList links={links} onOpen={onOpenLink} onRemove={onUnlink} />
        </div>
        <SheetFooter className="mt-2 flex-row justify-between gap-2 sm:justify-between">
          <Button type="button" variant="ghost" onClick={() => setConfirmingDelete(true)}>
            <Trash2 className="h-4 w-4" /> Delete
          </Button>
          <Button type="button" disabled={!title.trim()} onClick={save}>
            Save
          </Button>
        </SheetFooter>
        {/* Delete always confirms (the ActionMenu rule has no exception); the toast then offers an exact Undo. */}
        <Dialog open={confirmingDelete} onOpenChange={setConfirmingDelete}>
          <DialogContent className="max-w-sm">
            <DialogHeader>
              <DialogTitle>Delete “{task.title}”?</DialogTitle>
              <DialogDescription>The task is removed from this job. You can undo it from the toast for a few minutes.</DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button type="button" variant="line" onClick={() => setConfirmingDelete(false)}>
                Cancel
              </Button>
              <Button type="button" onClick={onDelete}>
                Delete task
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </SheetContent>
    </Sheet>
  );
}
