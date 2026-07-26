"use client";
// use-client: interactive — status-cycle writes + client-only "now" (R-8.1.1)

import Link from "next/link";
import { Circle, CircleDot, CheckCircle2, CalendarClock, ListChecks } from "lucide-react";
import { useActiveOrganization } from "@/lib/auth-client";
import { useNativeMyOpenTasks, type NativeMyOpenTask } from "@/hooks/use-native-dashboard";
import { useProjectTaskWrites } from "@/hooks/use-project-tasks-writes";
import { useServerMutation } from "@/hooks/use-server-mutation";
import { useCanDo } from "@/lib/use-permissions";
import { PageHeader } from "@/components/layout/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { FlowMascot } from "@/components/ui/flow-mascot";
import { StaggerList, StaggerItem, FadeIn } from "@/components/ui/motion";
import { cn, focusRing } from "@/lib/utils";
import { toast } from "sonner";
import {
  TASK_PRIORITY_LABELS,
  type ProjectTaskStatus,
  type ProjectTaskPriority,
} from "@/lib/project-tasks";

const DAY = 24 * 60 * 60 * 1000;

type Bucket = "Overdue" | "Today" | "This week" | "Later";
const BUCKET_ORDER: Bucket[] = ["Overdue", "Today", "This week", "Later"];

function startOfDay(d: Date) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

/** Overdue / Today / This week / Later, mirroring the dashboard's due-bucket convention. */
function bucketFor(task: NativeMyOpenTask, now: Date): Bucket {
  if (task.dueDate == null) return "Later";
  if (task.overdue) return "Overdue";
  const startToday = startOfDay(now).getTime();
  if (task.dueDate < startToday + DAY) return "Today";
  if (task.dueDate < startToday + 7 * DAY) return "This week";
  return "Later";
}

function dueLabel(task: NativeMyOpenTask): string | null {
  if (task.dueDate == null) return null;
  return new Date(task.dueDate).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function groupByBucket(tasks: NativeMyOpenTask[], now: Date): Map<Bucket, NativeMyOpenTask[]> {
  const grouped = new Map<Bucket, NativeMyOpenTask[]>();
  for (const b of BUCKET_ORDER) grouped.set(b, []);
  for (const t of tasks) grouped.get(bucketFor(t, now))!.push(t);
  return grouped;
}

const PRIORITY_DOT: Record<ProjectTaskPriority, string> = {
  LOW: "bg-faint",
  NORMAL: "bg-blue",
  HIGH: "bg-t-out",
};

export default function MyTasksPage() {
  const { data: activeOrg } = useActiveOrganization();
  const orgId = activeOrg?.id;
  const tasks = useNativeMyOpenTasks(orgId);
  const canEdit = useCanDo("project", "update");
  const writes = useProjectTaskWrites();
  const now = new Date();

  const cycleMut = useServerMutation({
    mutationFn: (vars: { id: string; next: ProjectTaskStatus }) => writes.update(vars.id, { status: vars.next }),
    onError: (e: Error) => toast.error(e.message || "Could not update task"),
  });

  function cycleStatus(task: NativeMyOpenTask) {
    const next: ProjectTaskStatus = task.status === "TODO" ? "IN_PROGRESS" : "DONE";
    cycleMut.mutate({ id: task.id, next });
  }

  const isLoading = !!orgId && tasks === undefined;
  const grouped = tasks ? groupByBucket(tasks, now) : null;

  return (
    <div className="space-y-6">
      <FadeIn>
        <PageHeader title="My tasks" description="Open tasks assigned to you, across every project." />
      </FadeIn>

      {isLoading ? (
        <TaskListSkeleton />
      ) : !tasks || tasks.length === 0 ? (
        <AllClearEmptyState />
      ) : (
        <div className="space-y-5">
          {BUCKET_ORDER.map((bucket, i) => (
            <TaskBucketSection
              key={bucket}
              bucket={bucket}
              tasks={grouped!.get(bucket) ?? []}
              index={i}
              canEdit={canEdit}
              onCycle={cycleStatus}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function TaskListSkeleton() {
  return (
    <div className="space-y-2">
      {Array.from({ length: 4 }).map((_, i) => (
        <div key={i} className="flex items-center gap-3 rounded-[var(--r)] border border-line px-3 py-2.5">
          <Skeleton className="size-4 rounded-full" />
          <Skeleton className="h-3.5 flex-1" />
          <Skeleton className="h-4 w-16" />
        </div>
      ))}
    </div>
  );
}

function AllClearEmptyState() {
  return (
    <FadeIn delay={0.04}>
      <div className="flex flex-col items-center gap-2 rounded-[var(--r-lg)] border-2 border-dashed border-line-2 py-14 text-center">
        <FlowMascot className="h-11 w-11" eyeColor="var(--ok)" />
        <p className="text-[14px] font-medium text-ink">All clear — nothing open on you</p>
        <p className="t-micro text-muted">Tasks assigned to you (or your crew record) land here.</p>
      </div>
    </FadeIn>
  );
}

function TaskBucketSection({
  bucket,
  tasks,
  index,
  canEdit,
  onCycle,
}: {
  bucket: Bucket;
  tasks: NativeMyOpenTask[];
  index: number;
  canEdit: boolean;
  onCycle: (task: NativeMyOpenTask) => void;
}) {
  if (tasks.length === 0) return null;
  return (
    <FadeIn delay={0.04 + index * 0.04} className="space-y-1.5">
      <h2 className={cn("flex items-center gap-2 t-overline", bucket === "Overdue" ? "text-t-out" : "text-muted")}>
        {bucket}
        <span className="text-faint">{tasks.length}</span>
      </h2>
      <StaggerList className="space-y-2">
        {tasks.map((task) => (
          <StaggerItem key={task.id}>
            <TaskRow task={task} canEdit={canEdit} onCycle={() => onCycle(task)} />
          </StaggerItem>
        ))}
      </StaggerList>
    </FadeIn>
  );
}

function TaskStatusIcon({ status }: { status: ProjectTaskStatus }) {
  if (status === "DONE") return <CheckCircle2 className="h-[18px] w-[18px] text-primary" />;
  if (status === "IN_PROGRESS") return <CircleDot className="h-[18px] w-[18px] text-blue" />;
  return <Circle className="h-[18px] w-[18px]" />;
}

function TaskDueBadge({ task }: { task: NativeMyOpenTask }) {
  const due = dueLabel(task);
  if (!due) return null;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-badge font-medium",
        task.overdue ? "bg-out-soft text-t-out" : "bg-paper-2 text-muted",
      )}
    >
      <CalendarClock className="h-3 w-3" />
      {due}
    </span>
  );
}

function TaskRow({
  task,
  canEdit,
  onCycle,
}: {
  task: NativeMyOpenTask;
  canEdit: boolean;
  onCycle: () => void;
}) {
  return (
    <div className="flex items-start gap-3 rounded-[var(--r)] border border-line bg-card px-3 py-2.5 shadow-[var(--sh-card)]">
      {canEdit ? (
        <button
          type="button"
          title="Move to next status"
          onClick={onCycle}
          className={cn("mt-0.5 shrink-0 rounded-full text-muted hover:text-primary", focusRing)}
        >
          <TaskStatusIcon status={task.status} />
        </button>
      ) : (
        <span className="mt-0.5 shrink-0 text-muted" aria-hidden>
          <TaskStatusIcon status={task.status} />
        </span>
      )}

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span
            className={cn("h-1.5 w-1.5 shrink-0 rounded-full", PRIORITY_DOT[task.priority])}
            aria-label={`${TASK_PRIORITY_LABELS[task.priority]} priority`}
            title={`${TASK_PRIORITY_LABELS[task.priority]} priority`}
          />
          <span className="truncate text-table-cell text-ink-2">{task.title}</span>
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-1.5">
          <TaskDueBadge task={task} />
          <Link
            href={`/projects/${task.projectId}`}
            className={cn(
              "inline-flex items-center gap-1 truncate text-caption text-muted hover:text-ink hover:underline",
              focusRing,
            )}
          >
            <ListChecks className="h-3 w-3 shrink-0" />
            <span className="font-mono">{task.projectNumber}</span>
            <span className="truncate">{task.projectName}</span>
          </Link>
        </div>
      </div>
    </div>
  );
}
