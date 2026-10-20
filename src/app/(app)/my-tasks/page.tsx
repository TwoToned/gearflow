"use client";
// use-client: live Convex subscription via useAuthedQuery (R-8.1.1)

import Link from "next/link";
import { toast } from "sonner";
import { useActiveOrganization } from "@/lib/auth-client";
import { useNativeMyOpenTasks } from "@/hooks/use-native-dashboard";
import { useProjectTaskWrites } from "@/hooks/use-project-tasks-writes";
import { PageHeader } from "@/components/layout/page-header";
import { RequirePermission } from "@/components/auth/require-permission";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/empty-state";
import { formatDate } from "@/lib/formatters";
import { cn, focusRing } from "@/lib/utils";
import { TASK_PRIORITY_LABELS } from "@/lib/project-tasks";

/** My open tasks across every job — the plain cross-project view of the Tasks tab. */
export default function MyTasksPage() {
  const { data: activeOrg } = useActiveOrganization();
  const tasks = useNativeMyOpenTasks(activeOrg?.id);
  const writes = useProjectTaskWrites();

  const complete = async (id: string) => {
    try {
      await writes.update(id, { status: "DONE" });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not update task");
    }
  };

  return (
    <RequirePermission resource="project" action="read">
      <div className="space-y-6">
        <PageHeader title="My tasks" description="Open tasks assigned to you, across every job." />
        {!tasks ? (
          <Skeleton className="h-40 w-full rounded-[var(--r-lg)]" />
        ) : tasks.length === 0 ? (
          <EmptyState title="Nothing assigned to you" description="Tasks assigned to you will show up here." />
        ) : (
          <ul className="flex flex-col gap-2">
            {tasks.map((t) => (
              <li key={t.id} className="flex items-center gap-3 rounded-[var(--r)] border border-line bg-card p-3">
                <Checkbox checked={false} onCheckedChange={() => void complete(t.id)} aria-label={`Complete ${t.title}`} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[14px] font-medium text-ink">{t.title}</p>
                  <p className="t-micro text-muted">
                    {t.projectId ? (
                      <Link href={`/projects/${t.projectId}?tab=tasks`} className={cn("rounded-sm hover:underline", focusRing)}>
                        {t.projectNumber} · {t.projectName}
                      </Link>
                    ) : (
                      "Personal"
                    )}
                    {t.priority === "HIGH" ? ` · ${TASK_PRIORITY_LABELS.HIGH} priority` : ""}
                    {t.dueDate != null && (
                      <span className={t.overdue ? "text-t-out" : undefined}> · Due {formatDate(new Date(t.dueDate))}</span>
                    )}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </RequirePermission>
  );
}
