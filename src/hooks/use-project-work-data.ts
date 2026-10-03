"use client";

import { useEffect, useRef } from "react";
import { useConvex, useConvexAuth } from "convex/react";
import { useServerQuery } from "@/hooks/use-server-query";
import { useProjectTasks as useConvexProjectTasks } from "@/hooks/use-projects";
import { useActiveOrganization } from "@/lib/auth-client";
import { api } from "../../convex/_generated/api";
import type { ProjectTaskRow as Task } from "@/lib/project-tasks";

/**
 * ONE data source for the Work tab's list/board/calendar toggle (#1244,
 * design §8.3: "views are filters over ONE query"). Only one of the three
 * view components is ever mounted at a time (the toggle swaps which one
 * renders), so each calling it independently never produces more than one
 * concurrent read — this hook exists to keep the fetch/live-resync logic
 * itself in ONE place (R-3.1) rather than tripled across list/board/
 * calendar, not to force a single shared subscription instance.
 *
 * Split out of `tasks-panel.tsx`, which used to own this inline — see that
 * file's history for the original comment on why the fingerprint resync
 * exists (a Convex live subscription on the raw table drives a refetch of
 * the composite server-action-shaped read, which carries assignee join data
 * the raw table doesn't).
 */
interface FingerprintableTask {
  id: string; updatedAt?: number; status?: string; title?: string; priority?: string;
  dueDate?: number; assigneeUserId?: string; assigneeCrewId?: string; sortOrder?: number;
  completedAt?: number; stage?: string;
}

/** One task's fingerprint segment — split out of the `.map()` below (R-3.6)
 *  purely to keep that callback's own complexity down (a chain of `??`
 *  fallbacks each counts as a branch). */
function fingerprintTask(t: unknown): string {
  const r = t as FingerprintableTask;
  const parts = [r.id, r.updatedAt, r.status, r.title, r.priority, r.dueDate, r.assigneeUserId, r.assigneeCrewId, r.sortOrder, r.completedAt, r.stage];
  return parts.map((p) => p ?? "").join(":");
}

export function useProjectWorkData(projectId: string) {
  const { data: activeOrg } = useActiveOrganization();
  const orgId = activeOrg?.id;
  const convex = useConvex();
  const { isAuthenticated } = useConvexAuth();

  const { data: tasks = [], isLoading, refetch } = useServerQuery({
    queryKey: ["project-tasks", orgId, projectId],
    queryFn: () =>
      convex.query(api.projectTasks.listByProjectWithRelations, {
        projectId,
        orgId: orgId as string,
      }) as unknown as Promise<Task[]>,
    enabled: !!orgId && isAuthenticated,
  });

  const { data: assignees } = useServerQuery({
    queryKey: ["task-assignees", orgId],
    queryFn: () =>
      convex.query(api.projectTasks.assignees, { orgId: orgId as string }) as unknown as Promise<{
        users: { id: string; name: string; image: string | null }[];
        crew: { id: string; firstName: string; lastName: string }[];
      }>,
    enabled: !!orgId && isAuthenticated,
  });

  // Cross-tab live sync: subscribe to the dual-written Convex projectTasks
  // table. When another tab creates/edits/deletes a task, the mirror pushes
  // the change; the fingerprint flips and we refetch the composite read.
  const taskDocs = useConvexProjectTasks(projectId, orgId);
  const taskFp = taskDocs === undefined ? undefined : taskDocs.map(fingerprintTask).sort().join("|");
  const prevTaskFp = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (taskFp !== undefined && prevTaskFp.current !== undefined && taskFp !== prevTaskFp.current) {
      refetch();
    }
    if (taskFp !== undefined) prevTaskFp.current = taskFp;
  }, [taskFp, refetch]);

  return { orgId, tasks, isLoading, refetch, assignees };
}
