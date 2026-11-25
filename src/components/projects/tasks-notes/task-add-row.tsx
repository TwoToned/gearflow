"use client";

import * as React from "react";

import { ActionMenu } from "@/components/ui/action-menu";
import type { ProjectTaskInput } from "@/hooks/use-project-tasks-writes";
import type { ActionItem } from "@/lib/primitives/types";
import { dueShortcutDate } from "@/lib/project-task-groups";
import type { Assignable, AssignTarget } from "@/lib/row-actions/task-bulk";
import { cn, focusRing } from "@/lib/utils";

/**
 * The add row, at the TOP of the list (UX Phase 10, spec §8c): a bare line, ↵ adds.
 * `Due ▾` and `Assign ▾` set those before adding (the chips read as plain words once
 * set). Due shortcuts resolve in the org's timezone (`dueShortcutDate`).
 */
const chip = cn("rounded-sm text-caption text-muted hover:text-ink hover:underline", focusRing);

export function TaskAddRow({
  assignees,
  now,
  timezone,
  onAdd,
}: {
  assignees: Assignable | undefined;
  now: number;
  timezone: string | undefined;
  onAdd: (title: string, extra: ProjectTaskInput) => void;
}) {
  const [title, setTitle] = React.useState("");
  const [due, setDue] = React.useState<{ label: string; date: string } | null>(null);
  const [who, setWho] = React.useState<{ label: string; target: AssignTarget } | null>(null);

  const dueItems: ActionItem[] = (["today", "tomorrow", "nextWeek"] as const).map((w) => ({
    key: w,
    label: w === "today" ? "Today" : w === "tomorrow" ? "Tomorrow" : "Next week",
    group: "edit",
    onSelect: () => setDue({ label: w === "today" ? "Today" : w === "tomorrow" ? "Tomorrow" : "Next week", date: dueShortcutDate(w, now, timezone)! }),
  }));
  const whoItems: ActionItem[] = [
    ...(assignees?.users ?? []).map((u) => ({ key: `u-${u.id}`, label: u.name, group: "edit" as const, onSelect: () => setWho({ label: u.name, target: { userId: u.id } }) })),
    ...(assignees?.crew ?? []).map((c) => ({
      key: `c-${c.id}`,
      label: `${c.firstName} ${c.lastName} (crew)`,
      group: "edit" as const,
      onSelect: () => setWho({ label: `${c.firstName} ${c.lastName}`, target: { crewId: c.id } }),
    })),
  ];

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const t = title.trim();
    if (!t) return;
    const target = who?.target;
    onAdd(t, {
      dueDate: due?.date,
      assigneeUserId: target && target !== "none" && "userId" in target ? target.userId : undefined,
      assigneeCrewId: target && target !== "none" && "crewId" in target ? target.crewId : undefined,
    });
    setTitle("");
    setDue(null);
    setWho(null);
  };

  return (
    <form onSubmit={submit} className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-line pb-2">
      <input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="Add a task…  ↵"
        aria-label="New task title"
        maxLength={200}
        className="min-w-[10rem] flex-1 bg-transparent py-1 text-base text-ink outline-none placeholder:text-muted md:text-ui-text"
      />
      <ActionMenu
        spec={{ items: dueItems }}
        label="Due date for the new task"
        trigger={
          <button type="button" className={chip}>
            {due ? `Due ${due.label}` : "Due ▾"}
          </button>
        }
      />
      <ActionMenu
        spec={{ items: whoItems }}
        label="Assignee for the new task"
        trigger={
          <button type="button" className={chip}>
            {who ? who.label : "Assign ▾"}
          </button>
        }
      />
    </form>
  );
}
