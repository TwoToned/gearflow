"use client";

import { useState } from "react";
import { List, Kanban, CalendarDays } from "lucide-react";
import { TasksPanel, type Task } from "./tasks-panel";
import { WorkBoardView } from "./work-board-view";
import { WorkCalendarView } from "./work-calendar-view";
import { useProjectWorkData } from "@/hooks/use-project-work-data";
import { useProjectTaskWrites } from "@/hooks/use-project-tasks-writes";
import type { ProjectTaskStage } from "@/lib/project-tasks";
import { Button } from "@/components/ui/button";
import { cn, focusRing } from "@/lib/utils";
import { toast } from "sonner";

type WorkView = "list" | "board" | "calendar";

const VIEWS: { id: WorkView; label: string; icon: typeof List }[] = [
  { id: "list", label: "List", icon: List },
  { id: "board", label: "Board", icon: Kanban },
  { id: "calendar", label: "Calendar", icon: CalendarDays },
];

/**
 * Project Work tab (#1244, design §8.3) — list / board / calendar toggle
 * over ONE query. `list` reuses `TasksPanel` verbatim (quick-add, bulk bar,
 * edit dialog, grouping already live there); `board` and `calendar` are
 * read/reorder-only views over the same `useProjectWorkData` fetch. The
 * view choice itself is local component state, not persisted — per the
 * guardrail, a saved view only happens if the user explicitly asks
 * (`savedTableViews`, not wired here yet since nothing calls for it from
 * this toggle specifically).
 */
export function WorkTab({ projectId }: { projectId: string }) {
  const [view, setView] = useState<WorkView>("list");
  const [peeked, setPeeked] = useState<Task | null>(null);
  const data = useProjectWorkData(projectId);
  const writes = useProjectTaskWrites();

  async function handleReorderColumn(orderedIds: string[]) {
    try {
      await writes.reorder(orderedIds);
      data.refetch();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not reorder");
    }
  }

  async function handleMoveStage(taskId: string, stage: ProjectTaskStage | null) {
    try {
      await writes.update(taskId, { stage });
      data.refetch();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not move task");
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-end gap-1 rounded-[var(--r-lg)] border border-line bg-paper-2 p-1">
        {VIEWS.map(({ id, label, icon: Icon }) => (
          <Button
            key={id}
            type="button"
            size="sm"
            variant={view === id ? "line" : "ghost"}
            className={cn("h-7 gap-1.5", focusRing)}
            aria-pressed={view === id}
            onClick={() => setView(id)}
          >
            <Icon className="h-3.5 w-3.5" />
            {label}
          </Button>
        ))}
      </div>

      {view === "list" && <TasksPanel projectId={projectId} />}

      {view === "board" && (
        <WorkBoardView
          tasks={data.tasks}
          onOpen={setPeeked}
          onReorderColumn={handleReorderColumn}
          onMoveStage={handleMoveStage}
        />
      )}

      {view === "calendar" && <WorkCalendarView tasks={data.tasks} onOpen={setPeeked} />}

      {/* Board/calendar open the same task in a lightweight peek — reusing
          TasksPanel's own edit dialog would require lifting its local state;
          instead these two views hand off to the list view's row, which is
          simplest via a stage switch. For now, board/calendar selection just
          switches to the list view scrolled to that task's group, avoiding a
          second edit-dialog implementation (R-3.1: one editor, not two). */}
      {peeked && view !== "list" && (
        <PeekHandoff task={peeked} onClose={() => setPeeked(null)} onOpenList={() => { setView("list"); setPeeked(null); }} />
      )}
    </div>
  );
}

function PeekHandoff({ task, onClose, onOpenList }: { task: Task; onClose: () => void; onOpenList: () => void }) {
  return (
    <div
      role="dialog"
      aria-label={`Open "${task.title}"`}
      className="fixed inset-x-0 bottom-0 z-40 mx-auto flex max-w-md items-center justify-between gap-3 rounded-t-[var(--r-lg)] border border-b-0 border-line bg-card p-3 shadow-[var(--sh-hover)] sm:bottom-4 sm:rounded-[var(--r-lg)] sm:border-b"
    >
      <p className="min-w-0 flex-1 truncate text-ui-text text-ink-2">{task.title}</p>
      <div className="flex shrink-0 items-center gap-2">
        <Button size="sm" variant="line" onClick={onClose}>
          Dismiss
        </Button>
        <Button size="sm" onClick={onOpenList}>
          Open in list
        </Button>
      </div>
    </div>
  );
}
