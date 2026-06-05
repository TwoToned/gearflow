/**
 * Shared types for project tasks. Kept in a plain lib module (not a "use server"
 * file) so both client components and server actions can import them.
 */

export type ProjectTaskStatus = "TODO" | "IN_PROGRESS" | "DONE";
export type ProjectTaskPriority = "LOW" | "NORMAL" | "HIGH";

/** A single sub-step stored inline in ProjectTask.checklist (JSON). */
export interface ChecklistItem {
  id: string;
  text: string;
  done: boolean;
}

export const TASK_STATUS_LABELS: Record<ProjectTaskStatus, string> = {
  TODO: "To do",
  IN_PROGRESS: "In progress",
  DONE: "Done",
};

export const TASK_PRIORITY_LABELS: Record<ProjectTaskPriority, string> = {
  LOW: "Low",
  NORMAL: "Normal",
  HIGH: "High",
};
