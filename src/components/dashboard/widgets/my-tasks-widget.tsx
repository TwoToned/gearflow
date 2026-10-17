"use client";

import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { useNativeMyOpenTasks } from "@/hooks/use-native-dashboard";
import { Skeleton } from "@/components/ui/skeleton";
import { cn, focusRing } from "@/lib/utils";
import { formatDateDayMonth } from "@/lib/formatters";

/** The first few of my open tasks across every job; the full list is `/my-tasks`. */
export function MyTasksWidget({ orgId }: { orgId: string | undefined }) {
  const tasks = useNativeMyOpenTasks(orgId);

  return (
    <div className="flex h-full flex-col">
      <div className="mb-3 flex items-center justify-end">
        <Link
          href="/my-tasks"
          className={cn("inline-flex items-center gap-1 rounded-[var(--r)] text-[11px] text-muted hover:text-ink", focusRing)}
        >
          All <ArrowRight className="h-3 w-3" />
        </Link>
      </div>
      {!tasks ? (
        <div className="space-y-2">
          <Skeleton className="h-8 w-full" />
          <Skeleton className="h-8 w-full" />
        </div>
      ) : tasks.length === 0 ? (
        <p className="t-body text-muted">Nothing assigned to you.</p>
      ) : (
        <ul className="space-y-1">
          {tasks.slice(0, 6).map((t) => (
            <li key={t.id}>
              <Link
                href={t.projectId ? `/projects/${t.projectId}?tab=tasks` : "/my-tasks"}
                className={cn("flex items-center justify-between gap-3 rounded-[var(--r)] px-2 py-2 hover:bg-elev", focusRing)}
              >
                <div className="min-w-0">
                  <p className="truncate text-[14px] font-medium text-ink">{t.title}</p>
                  {t.projectName && <p className="t-micro truncate text-muted">{t.projectName}</p>}
                </div>
                {t.dueDate != null && (
                  <span className={cn("shrink-0 text-[11px]", t.overdue ? "text-t-out" : "text-muted")}>
                    {formatDateDayMonth(new Date(t.dueDate))}
                  </span>
                )}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
