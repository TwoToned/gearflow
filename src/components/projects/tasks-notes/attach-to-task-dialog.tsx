"use client";

import * as React from "react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useProjectTaskList } from "@/hooks/use-project-task-list";
import { useTaskLinkActions, useTaskLinks } from "@/hooks/use-task-links";
import { isOpenTask } from "@/lib/project-task-groups";
import { TASK_LINK_KIND_LABEL, linkTargetKey, type TaskLinkKind } from "@/lib/task-links";
import { cn, focusRing } from "@/lib/utils";

/** What is being attached: a line item, a file or a discussion on this job. */
export interface AttachTarget {
  kind: TaskLinkKind;
  id: string;
  label: string;
}

/**
 * `Attach to a task` (UX Phase 10 Slice E): pick one of the job's open tasks and link
 * the target to it, through the ONE link write (its toast offers the exact Undo). A task
 * that is already linked to this target is shown as such and is not offered again.
 * Mounted only while open (it reads the task list and the link index).
 */
export function AttachToTaskDialog({ projectId, target, onClose }: { projectId: string; target: AttachTarget; onClose: () => void }) {
  const { tasks, isLoading } = useProjectTaskList(projectId);
  const { byTarget } = useTaskLinks(projectId);
  const actions = useTaskLinkActions();
  const already = new Set((byTarget.get(linkTargetKey(target.kind, target.id)) ?? []).map((l) => l.taskId));
  const open = tasks.filter(isOpenTask);

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Attach to a task</DialogTitle>
          <DialogDescription>
            {TASK_LINK_KIND_LABEL[target.kind]}: {target.label}
          </DialogDescription>
        </DialogHeader>
        {isLoading ? (
          <p className="t-micro text-muted">Loading tasks…</p>
        ) : open.length === 0 ? (
          <p className="t-micro text-muted">No open tasks on this job. Add one on the Tasks & notes tab first.</p>
        ) : (
          <ul className="max-h-72 overflow-y-auto">
            {open.map((t) => (
              <li key={t.id}>
                <button
                  type="button"
                  disabled={already.has(t.id)}
                  onClick={() => {
                    void actions.link(t, target);
                    onClose();
                  }}
                  className={cn("flex w-full items-center justify-between gap-3 border-b border-line py-2 text-left text-ui-text hover:bg-paper-2 disabled:text-muted disabled:hover:bg-transparent", focusRing)}
                >
                  <span className="min-w-0 truncate">{t.title}</span>
                  {already.has(t.id) && <span className="shrink-0 text-caption">Linked</span>}
                </button>
              </li>
            ))}
          </ul>
        )}
        <DialogFooter>
          <Button type="button" variant="line" onClick={onClose}>
            Cancel
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
