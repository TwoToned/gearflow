/**
 * Shared types for the basic project task list. Kept in a plain lib module (not a
 * "use server" file) so client components, hooks and tests can import them.
 */

export const TASK_STATUSES = ["TODO", "IN_PROGRESS", "DONE", "CANCELLED"] as const;
export type ProjectTaskStatus = (typeof TASK_STATUSES)[number];

export const TASK_STATUS_LABELS: Record<ProjectTaskStatus, string> = {
  TODO: "To do",
  IN_PROGRESS: "In progress",
  DONE: "Done",
  CANCELLED: "Cancelled",
};

export const TASK_PRIORITIES = ["LOW", "NORMAL", "HIGH"] as const;
export type ProjectTaskPriority = (typeof TASK_PRIORITIES)[number];

export const TASK_PRIORITY_LABELS: Record<ProjectTaskPriority, string> = {
  LOW: "Low",
  NORMAL: "Normal",
  HIGH: "High",
};

/** A task row in the shape `projectTasks.listByProjectWithRelations` returns. */
export interface ProjectTaskRow {
  id: string;
  title: string;
  description: string | null;
  status: ProjectTaskStatus;
  priority: ProjectTaskPriority;
  /** ISO string (consumers slice to YYYY-MM-DD). */
  dueDate: string | null;
  assigneeUserId: string | null;
  assigneeCrewId: string | null;
  assigneeUser: { id: string; name: string; image: string | null } | null;
  assigneeCrew: { id: string; firstName: string; lastName: string } | null;
  sortOrder: number;
}
