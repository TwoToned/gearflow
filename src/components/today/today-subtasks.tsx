"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Check, Circle } from "lucide-react";
import { useAuthedQuery } from "@/hooks/use-authed-query";
import { useProjectTaskWrites } from "@/hooks/use-project-tasks-writes";
import { cn, focusRing } from "@/lib/utils";
import { api } from "../../../convex/_generated/api";

/**
 * A task's subtasks, rendered in the peek panel (Phase 1, #1243, design doc
 * §8.2: "Subtasks: one level (parentId). Replaces the untyped checklist
 * blob"). Live-subscribed (this user is the one editing it, same posture as
 * the work list — R13). Not shown for a subtask itself (one level only).
 */
export function TodaySubtasks({ parentId, orgId, canEdit }: { parentId: string; orgId: string | undefined; canEdit: boolean }) {
  const writes = useProjectTaskWrites();
  const subtasks = useAuthedQuery(api.projectTasks.listSubtasks, orgId ? { parentId, orgId } : "skip");
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);

  const toggleDone = (id: string, done: boolean) => {
    writes.update(id, { status: done ? "DONE" : "TODO" }).catch((e: unknown) => {
      toast.error(e instanceof Error ? e.message : "Could not update the subtask");
    });
  };

  const addSubtask = () => {
    const title = value.trim();
    if (!title || busy) return;
    setBusy(true);
    writes
      .create({ title, parentId })
      .then(() => setValue(""))
      .catch((e: unknown) => toast.error(e instanceof Error ? e.message : "Could not add the subtask"))
      .finally(() => setBusy(false));
  };

  return (
    <div className="space-y-2">
      <p className="t-overline text-muted">Subtasks</p>
      {subtasks === undefined ? null : subtasks.length === 0 ? (
        <p className="text-caption text-faint">No subtasks yet.</p>
      ) : (
        <ul className="space-y-1">
          {subtasks.map((s) => {
            const done = s.status === "DONE";
            return (
              <li key={s.id}>
                <button
                  type="button"
                  disabled={!canEdit}
                  onClick={() => toggleDone(s.id, !done)}
                  className={cn("touch-target flex w-full items-center gap-2 rounded-[var(--r)] -mx-1 px-1 py-0.5 text-left", focusRing)}
                >
                  {done ? <Check className="h-3.5 w-3.5 shrink-0 text-muted" /> : <Circle className="h-3.5 w-3.5 shrink-0 text-faint" />}
                  <span className={cn("truncate text-[13px]", done ? "text-muted line-through" : "text-ink-2")}>{s.title}</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {canEdit && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            addSubtask();
          }}
        >
          <input
            type="text"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="Add a subtask"
            disabled={busy}
            className="w-full rounded-[var(--r)] border border-line bg-card px-2 py-1 text-[13px] text-ink placeholder:text-faint focus:border-primary focus:outline-none"
          />
        </form>
      )}
    </div>
  );
}
