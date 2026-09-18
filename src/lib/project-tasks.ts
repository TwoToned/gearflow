/**
 * Shared types for project tasks. Kept in a plain lib module (not a "use server"
 * file) so both client components and server actions can import them.
 *
 * Work-layer phase 1 (#1243): the status/priority unions and their display
 * labels now RE-EXPORT `convex/lib/workVocabulary.ts` — the isomorphic
 * source of truth also consumed by the Convex validators — rather than
 * hand-declaring a second copy. Do not add a literal here; add it there.
 */

export type {
  WorkItemStatus as ProjectTaskStatus,
  WorkItemPriority as ProjectTaskPriority,
  WorkItemKind as ProjectTaskKind,
  WorkStage as ProjectTaskStage,
  WorkRecurrenceFrequency as ProjectTaskRecurrenceFrequency,
} from "../../convex/lib/workVocabulary";
export {
  WORK_ITEM_STATUS_LABELS as TASK_STATUS_LABELS,
  WORK_ITEM_PRIORITY_LABELS as TASK_PRIORITY_LABELS,
  WORK_STAGES as TASK_STAGES,
  WORK_STAGE_LABELS as TASK_STAGE_LABELS,
  WORK_RECURRENCE_FREQUENCIES as TASK_RECURRENCE_FREQUENCIES,
  WORK_RECURRENCE_FREQUENCY_LABELS as TASK_RECURRENCE_FREQUENCY_LABELS,
} from "../../convex/lib/workVocabulary";

/** A work item's recurrence rule, mirroring `convex/lib/validators.ts`'s
 *  `ProjectTaskRecurrence` shape — plain client type, no Zod/Convex import. */
export interface ProjectTaskRecurrence {
  freq: import("../../convex/lib/workVocabulary").WorkRecurrenceFrequency;
  daysOfWeek?: number[];
  dayOfMonth?: number;
}

/** A single sub-step stored inline in ProjectTask.checklist (JSON). */
export interface ChecklistItem {
  id: string;
  text: string;
  done: boolean;
}

/**
 * A task row in the shape the project-scoped composite reads return
 * (`listByProjectWithRelations`). Lives here (not in `tasks-panel.tsx`,
 * which used to own it) so `use-project-work-data.ts` — which BOTH feeds
 * `TasksPanel` and is imported BY it — can reference the type without a
 * dependency cycle (#1244; caught by `depcruise-ratchet.mjs`). Every
 * consumer (`tasks-panel.tsx`, `work-board-view.tsx`, `work-calendar-view.tsx`,
 * `work-tab.tsx`, `use-project-work-data.ts`) imports it from here.
 */
export interface ProjectTaskRow {
  id: string;
  title: string;
  description: string | null;
  status: import("../../convex/lib/workVocabulary").WorkItemStatus;
  priority: import("../../convex/lib/workVocabulary").WorkItemPriority;
  dueDate: string | null;
  checklist: ChecklistItem[] | null;
  assigneeUserId: string | null;
  assigneeCrewId: string | null;
  assigneeUser: { id: string; name: string; image: string | null } | null;
  assigneeCrew: { id: string; firstName: string; lastName: string } | null;
  // #1244 — optional: absent on rows fetched before the Work tab's board/
  // grouping needed them (myOpenTasks already returns `stage`; this query
  // now does too — see convex/projectTasks.ts).
  stage?: import("../../convex/lib/workVocabulary").WorkStage | null;
  recurrence?: ProjectTaskRecurrence | null;
  watcherUserIds?: string[];
}
