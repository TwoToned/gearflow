import { taskDueBucket, todayDayNumber, type TaskDueBucket } from "../../convex/lib/taskDue";
import type { ProjectTaskRow } from "@/lib/project-tasks";

/**
 * The Tasks section's grouping, filtering and in-group ordering (UX Phase 10,
 * spec §8c). Pure. Tasks group by WHEN, not by status: Overdue · Today ·
 * Tomorrow · This week · Later · No date, then a collapsed Done. The buckets come
 * from the ONE due rule (`convex/lib/taskDue.ts`, org timezone); nothing here
 * re-derives "overdue".
 */

export type TaskFilter = "open" | "mine" | "done" | "all";
export const TASK_FILTERS: readonly { value: TaskFilter; label: string }[] = [
  { value: "open", label: "Open" },
  { value: "mine", label: "Mine" },
  { value: "done", label: "Done" },
  { value: "all", label: "All" },
];

type TaskGroupKey =TaskDueBucket | "DONE";

export interface TaskGroup {
  key: TaskGroupKey;
  label: string;
  tasks: ProjectTaskRow[];
}

const BUCKET_ORDER: readonly { key: TaskDueBucket; label: string }[] = [
  { key: "OVERDUE", label: "Overdue" },
  { key: "TODAY", label: "Today" },
  { key: "TOMORROW", label: "Tomorrow" },
  { key: "THIS_WEEK", label: "This week" },
  { key: "LATER", label: "Later" },
  { key: "NO_DATE", label: "No date" },
];

export const isOpenTask = (t: Pick<ProjectTaskRow, "status">) => t.status === "TODO" || t.status === "IN_PROGRESS";

const dueMs = (t: ProjectTaskRow): number | null => (t.dueDate ? new Date(t.dueDate).getTime() : null);

function matchesSearch(t: ProjectTaskRow, q: string): boolean {
  if (!q) return true;
  const who = t.assigneeUser?.name ?? (t.assigneeCrew ? `${t.assigneeCrew.firstName} ${t.assigneeCrew.lastName}` : "");
  return `${t.title} ${t.description ?? ""} ${who}`.toLowerCase().includes(q);
}

/** The filter's rows: open / mine (open, assigned to me) / done (done + cancelled) / all. */
function filterTasks(tasks: ProjectTaskRow[], filter: TaskFilter, userId: string | undefined): ProjectTaskRow[] {
  if (filter === "done") return tasks.filter((t) => !isOpenTask(t));
  if (filter === "mine") return tasks.filter((t) => isOpenTask(t) && !!userId && t.assigneeUserId === userId);
  if (filter === "open") return tasks.filter(isOpenTask);
  return tasks;
}

export function groupTasks(
  tasks: ProjectTaskRow[],
  opts: { filter: TaskFilter; search: string; userId: string | undefined; now: number; timezone: string | undefined },
): TaskGroup[] {
  const q = opts.search.trim().toLowerCase();
  const rows = filterTasks(tasks, opts.filter, opts.userId).filter((t) => matchesSearch(t, q));
  const open = rows.filter(isOpenTask);
  const done = rows.filter((t) => !isOpenTask(t));
  const groups: TaskGroup[] = BUCKET_ORDER.map(({ key, label }) => ({
    key,
    label,
    tasks: open.filter((t) => taskDueBucket(dueMs(t), opts.now, opts.timezone) === key),
  })).filter((g) => g.tasks.length > 0);
  if (done.length > 0) groups.push({ key: "DONE", label: "Done", tasks: done });
  return groups;
}

/**
 * A due shortcut as the `YYYY-MM-DD` the write takes (`null` clears): relative to
 * TODAY IN THE ORG'S TIMEZONE, the same day `taskDue.ts` calls today, so a task set
 * to "Today" is never immediately overdue for anyone.
 */
export function dueShortcutDate(when: "today" | "tomorrow" | "nextWeek" | "clear", now: number, timezone: string | undefined): string | null {
  if (when === "clear") return null;
  const add = when === "today" ? 0 : when === "tomorrow" ? 1 : 7;
  return new Date((todayDayNumber(now, timezone) + add) * 86_400_000).toISOString().slice(0, 10);
}

/** `Done · 9 · 1 cancelled`. */
export function doneGroupLabel(done: ProjectTaskRow[]): string {
  const cancelled = done.filter((t) => t.status === "CANCELLED").length;
  const finished = done.length - cancelled;
  return cancelled > 0 ? `Done · ${finished} · ${cancelled} cancelled` : `Done · ${finished}`;
}

/**
 * The full task order after dragging `activeId` onto `overId` WITHIN one group.
 * `sortOrder` is one value per project, so the group's tasks are permuted among the
 * positions they already occupy and every other task keeps its place; a drag across
 * groups changes nothing (use the due menu to change the day). `null` = no move.
 */
export function reorderWithinGroup(
  allOrdered: readonly string[],
  groupIds: readonly string[],
  activeId: string,
  overId: string,
): string[] | null {
  const from = groupIds.indexOf(activeId);
  const to = groupIds.indexOf(overId);
  if (from < 0 || to < 0 || from === to) return null;
  const permuted = [...groupIds];
  permuted.splice(from, 1);
  permuted.splice(to, 0, activeId);
  const slots = new Set(groupIds);
  let next = 0;
  return allOrdered.map((id) => (slots.has(id) ? permuted[next++] : id));
}
