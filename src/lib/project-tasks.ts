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
} from "../../convex/lib/workVocabulary";
export {
  WORK_ITEM_STATUS_LABELS as TASK_STATUS_LABELS,
  WORK_ITEM_PRIORITY_LABELS as TASK_PRIORITY_LABELS,
} from "../../convex/lib/workVocabulary";

/** A single sub-step stored inline in ProjectTask.checklist (JSON). */
export interface ChecklistItem {
  id: string;
  text: string;
  done: boolean;
}
