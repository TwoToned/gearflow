/**
 * A task link as `projectTaskLinks.listForProject` returns it (UX Phase 10 Slice E):
 * a pointer from a task to a line item, a file or a discussion on the same job, with
 * the target's label. ONE shape and ONE index for every surface (task row chips, the
 * task sheet, a file's back-reference, the `Attach to a task` picker).
 */
export type TaskLinkKind = "lineItem" | "file" | "discussion";

export interface TaskLink {
  id: string;
  taskId: string;
  /** The linking task's title, for a target's `Task: …` back-reference. */
  taskTitle: string;
  kind: TaskLinkKind;
  linkedId: string;
  label: string;
}

export const TASK_LINK_KIND_LABEL: Record<TaskLinkKind, string> = { lineItem: "Line item", file: "File", discussion: "Discussion" };

/** The key a target is looked up by (`file:pm1`). */
export const linkTargetKey = (kind: TaskLinkKind, linkedId: string): string => `${kind}:${linkedId}`;

export interface TaskLinkIndex {
  byTask: ReadonlyMap<string, TaskLink[]>;
  byTarget: ReadonlyMap<string, TaskLink[]>;
}

function push<K>(map: Map<K, TaskLink[]>, key: K, link: TaskLink) {
  const list = map.get(key);
  if (list) list.push(link);
  else map.set(key, [link]);
}

/** Group a job's links by task and by target, once per read. */
export function indexTaskLinks(links: readonly TaskLink[] | undefined): TaskLinkIndex {
  const byTask = new Map<string, TaskLink[]>();
  const byTarget = new Map<string, TaskLink[]>();
  for (const l of links ?? []) {
    push(byTask, l.taskId, l);
    push(byTarget, linkTargetKey(l.kind, l.linkedId), l);
  }
  return { byTask, byTarget };
}

/** What a chip prints: the target's label, clipped so a long file name cannot stretch a row. */
export function linkChipText(l: Pick<TaskLink, "label">, max = 28): string {
  return l.label.length > max ? `${l.label.slice(0, max - 1)}…` : l.label;
}
