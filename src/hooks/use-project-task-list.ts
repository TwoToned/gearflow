"use client";

import { useEffect, useRef } from "react";
import { useConvex, useConvexAuth } from "convex/react";
import { useServerQuery } from "@/hooks/use-server-query";
import { useProjectTasks as useConvexProjectTasks } from "@/hooks/use-projects";
import { useActiveOrganization } from "@/lib/auth-client";
import { api } from "../../convex/_generated/api";
import type { ProjectTaskRow } from "@/lib/project-tasks";

/**
 * A project's task list (with assignee joins) plus the assignable people. A live
 * Convex subscription on the raw table drives a refetch of the composite read
 * (which carries the assignee join data the raw table doesn't) whenever a task
 * changes — so edits from another tab show up without a manual refresh.
 */
interface FingerprintableTask {
  id: string; updatedAt?: number; status?: string; title?: string; priority?: string;
  dueDate?: number; assigneeUserId?: string; assigneeCrewId?: string; sortOrder?: number; completedAt?: number;
}

function fingerprintTask(t: unknown): string {
  const r = t as FingerprintableTask;
  const parts = [r.id, r.updatedAt, r.status, r.title, r.priority, r.dueDate, r.assigneeUserId, r.assigneeCrewId, r.sortOrder, r.completedAt];
  return parts.map((p) => p ?? "").join(":");
}

export function useProjectTaskList(projectId: string) {
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
      }) as unknown as Promise<ProjectTaskRow[]>,
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
