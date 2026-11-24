"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Check } from "lucide-react";
import { useNativeMyOpenTasks } from "@/hooks/use-native-dashboard";
import { useProjectTaskWrites } from "@/hooks/use-project-tasks-writes";
import { useStableNow } from "@/hooks/use-stable-now";
import { useFormatters } from "@/components/providers/format-provider";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusWord } from "@/components/ui/status-word";
import { ActionMenu } from "@/components/ui/action-menu";
import { useCurrentRole } from "@/lib/use-permissions";
import type { ActionItem } from "@/lib/primitives/types";
import { WidgetCount } from "@/components/dashboard/widget-chrome";
import { announceListWrite } from "@/lib/list-write-toast";
import { showError } from "@/lib/show-error";
import { taskDueText } from "@/lib/home-rows";
import type { ProjectTaskStatus } from "@/lib/project-tasks";
import { cn, focusRing } from "@/lib/utils";

type OpenTask = NonNullable<ReturnType<typeof useNativeMyOpenTasks>>[number];

const DUE_CLASS = { late: "text-t-out", today: "text-warn", plain: "font-mono text-muted" } as const;
/** `myOpenTasks` is bounded to 100 rows. */
const TASK_CAP = 100;

function taskHref(t: OpenTask): string {
  return t.projectId ? `/projects/${t.projectId}?tab=tasks` : "/my-tasks";
}

/**
 * Mark a task done with the SAME write `/my-tasks` uses, then toast ONE Undo
 * closure that puts back the exact status it had (§6c.2: the tick + Undo).
 */
function useCompleteTask() {
  const writes = useProjectTaskWrites();
  return async (t: OpenTask) => {
    const prior: ProjectTaskStatus = t.status;
    try {
      await writes.update(t.id, { status: "DONE" });
    } catch (e) {
      showError(e, { fallbackTitle: "Couldn't complete the task" });
      return;
    }
    announceListWrite({
      title: `Done · “${t.title}”`,
      undoneTitle: `“${t.title}” is open again`,
      performUndo: () => writes.update(t.id, { status: prior }),
    });
  };
}

/**
 * May this role complete a task? The same pair the write checks
 * (`requireWorkOrProjectOrgUpdate`): `work:update` or `project:update`. Without
 * it the tick and "Mark done" are ABSENT, never disabled.
 */
function canCompleteTasks(permissions: ReturnType<typeof useCurrentRole>["permissions"]): boolean {
  return !!(permissions?.work?.includes("update") || permissions?.project?.includes("update"));
}

function TickButton({ task, onComplete }: { task: OpenTask; onComplete: (t: OpenTask) => void }) {
  return (
    <button
      type="button"
      onClick={() => onComplete(task)}
      aria-label={`Complete ${task.title}`}
      className={cn("group/tick flex size-11 shrink-0 items-center justify-center rounded-full", focusRing)}
    >
      <span className="flex size-[18px] items-center justify-center rounded-full border-2 border-[var(--control-line)] text-transparent group-hover/tick:text-muted">
        <Check className="size-3" aria-hidden />
      </span>
    </button>
  );
}

function TaskRow({ task, now, onComplete }: { task: OpenTask; now: number; onComplete?: (t: OpenTask) => void }) {
  const router = useRouter();
  const { formatDateDayMonth } = useFormatters();
  const due = taskDueText(task.dueDate, now, (d) => formatDateDayMonth(d));
  const where = task.projectId ? `${task.projectNumber} ${task.projectName}` : "Personal";
  const open: ActionItem = { key: "open", label: task.projectId ? "Open on the job" : "Open in My tasks", group: "edit", onSelect: () => router.push(taskHref(task)) };
  const done: ActionItem[] = onComplete ? [{ key: "done", label: "Mark done", group: "edit", onSelect: () => onComplete(task) }] : [];
  return (
    <li className="flex min-h-[52px] items-center gap-1.5 border-t border-line first:border-t-0">
      {onComplete && <TickButton task={task} onComplete={onComplete} />}
      <Link href={taskHref(task)} className={cn("group flex min-w-0 flex-1 items-center gap-3 py-2", focusRing)}>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13.5px] font-semibold text-ink group-hover:underline">{task.title}</span>
          <span className="block truncate text-[12.5px] text-muted">
            {where}
            {task.priority === "HIGH" && (
              <>
                {" · "}
                <StatusWord status={{ label: "High", intent: "error" }} className="text-[12.5px]" />
              </>
            )}
          </span>
        </span>
        {due && <span className={cn("shrink-0 whitespace-nowrap text-[12.5px]", DUE_CLASS[due.tone])}>{due.text}</span>}
      </Link>
      <ActionMenu label={`${task.title} actions`} spec={{ items: [open, ...done] }} />
    </li>
  );
}

/** The first few of my open tasks across every job; the full list is `/my-tasks`. */
export function MyTasksWidget({ orgId }: { orgId: string | undefined }) {
  const tasks = useNativeMyOpenTasks(orgId);
  const now = useStableNow();
  const complete = useCompleteTask();
  const { permissions } = useCurrentRole();
  const onComplete = canCompleteTasks(permissions) ? (task: OpenTask) => void complete(task) : undefined;

  if (!tasks) {
    return (
      <div className="space-y-2">
        <Skeleton className="h-8 w-full" />
        <Skeleton className="h-8 w-full" />
      </div>
    );
  }
  if (tasks.length === 0) {
    return (
      <p className="py-3 text-[13.5px] text-muted">
        <span className="font-semibold text-ink">Nothing assigned to you.</span> Tasks assigned to you show up here.
      </p>
    );
  }
  return (
    <>
      <WidgetCount>{tasks.length >= TASK_CAP ? `${TASK_CAP}+` : tasks.length}</WidgetCount>
      <ul>
        {tasks.slice(0, 6).map((t) => (
          <TaskRow key={t.id} task={t} now={now} onComplete={onComplete} />
        ))}
      </ul>
    </>
  );
}
