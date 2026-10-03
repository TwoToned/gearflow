"use client";
// The Overdue/Today/Triage/Later work list, extracted out of the now-hidden
// `/today` page (D10C; FEATUREDOCS/79) so it could be hosted both there AND
// as a dashboard-board widget from ONE implementation (R-3.1) — this is now
// the only host, but the extraction is what let `/today` become a pure
// redirect with nothing lost. Same hooks, same reactivity posture (the
// live `myOpenTasks` subscription is the only one here — everything else on
// Today itself stays in the day/needs-you rail widgets).

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { useNativeMyOpenTasks, type NativeMyOpenTask } from "@/hooks/use-native-dashboard";
import { useAuthedQuery } from "@/hooks/use-authed-query";
import { useProjectTaskWrites } from "@/hooks/use-project-tasks-writes";
import { useWorkSignalWrites } from "@/hooks/use-work-signal-writes";
import { useNotifications } from "@/hooks/use-notifications";
import { useDocumentDatesConfig } from "@/hooks/use-document-dates-config";
import { useCanDo } from "@/lib/use-permissions";
import { useKeyboardShortcut } from "@/hooks/use-keyboard-shortcut";
import { bucketForDueDate } from "@/lib/today-buckets";
import { TASK_STAGE_LABELS, type ProjectTaskStage } from "@/lib/project-tasks";
import { SectionHeader } from "@/components/ui/section-header";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { FadeIn, StaggerList, StaggerItem } from "@/components/ui/motion";
import { WorkComposer } from "@/components/work/work-composer";
import { TodayRow } from "@/components/today/today-row";
import { TodayPeek } from "@/components/today/today-peek";
import type { TodayItem } from "@/components/today/today-types";
import { api } from "../../../../convex/_generated/api";
import type { Doc } from "../../../../convex/_generated/dataModel";

function taskContextLine(task: NativeMyOpenTask): string {
  const parts = task.projectId ? [task.projectNumber, task.projectName].filter(Boolean) : ["Personal"];
  if (task.stage) parts.push(TASK_STAGE_LABELS[task.stage as ProjectTaskStage] ?? task.stage);
  if (task.dueDate != null) {
    parts.push(new Date(task.dueDate).toLocaleDateString(undefined, { month: "short", day: "numeric" }));
  }
  return parts.join(" · ");
}

function mentionContextLine(n: Doc<"notifications">): string {
  return n.body || "in a comment";
}

export interface TodayWorkListStatus {
  isLoading: boolean;
  isEmpty: boolean;
  hasOverdue: boolean;
}

export function TodayWorkListWidget({
  orgId,
  onStatusChange,
}: {
  orgId: string | undefined;
  /** Was `/today`'s greeting-subtitle ("Nothing on fire.") input before that
   *  page was hidden (D10C) — kept on the type/prop since it's harmless and
   *  cheap to keep threading through. Not used by the dashboard-board hosting
   *  of this widget. */
  onStatusChange?: (status: TodayWorkListStatus) => void;
}) {
  const canEditTasks = useCanDo("project", "update");
  const writes = useProjectTaskWrites();
  const signalWrites = useWorkSignalWrites();
  const { timezone } = useDocumentDatesConfig();

  const now = new Date().getTime();

  const tasks = useNativeMyOpenTasks(orgId);
  const notificationsFeed = useAuthedQuery(api.notifications.listForMe, { limit: 20 });
  // Powers the composer's owner chip. Same org-scoped read the project Work
  // tab already uses, so no new query shape (R-3.1).
  const assignees = useAuthedQuery(api.projectTasks.assignees, orgId ? { orgId } : "skip");
  const { markRead } = useNotifications();

  const [justCompleted, setJustCompleted] = useState<Map<string, NativeMyOpenTask>>(new Map());

  const toggleTaskDone = useCallback(
    (task: NativeMyOpenTask, nextDone: boolean) => {
      setJustCompleted((m) => {
        const next = new Map(m);
        if (nextDone) next.set(task.id, task);
        else next.delete(task.id);
        return next;
      });
      writes.update(task.id, { status: nextDone ? "DONE" : "TODO" }).catch((e: unknown) => {
        setJustCompleted((m) => {
          const next = new Map(m);
          if (nextDone) next.delete(task.id);
          else next.set(task.id, task);
          return next;
        });
        toast.error(e instanceof Error ? e.message : "Could not update the task");
      });
    },
    [writes],
  );

  const promoteMention = useCallback(
    (n: Doc<"notifications">) => {
      signalWrites
        .promote({ sourceKey: n.dedupeKey, title: n.title })
        .then(() => toast.success("Added to your tasks"))
        .catch((e: unknown) => toast.error(e instanceof Error ? e.message : "Could not create the task"));
    },
    [signalWrites],
  );

  // The composer owns its own draft/owner/due state and its create call — the
  // widget only needs the ref so `Q` can focus it. It replaces a bare input
  // that posted `create({ title })`: no owner, no project, no due date, which
  // wrote a row nothing could ever read (work-layer v2 §2 D1).
  const quickAddInputRef = useRef<HTMLInputElement>(null);

  const taskItems = useMemo<TodayItem[]>(() => {
    const openTasks = (tasks ?? []).filter((t) => !justCompleted.has(t.id));
    const merged = [...openTasks, ...justCompleted.values()];
    return merged.map((t) => {
      const done = justCompleted.has(t.id);
      const bucket = done ? "today" : bucketForDueDate(t.dueDate, now, timezone);
      return {
        key: `task:${t.id}`,
        kind: "task" as const,
        bucket,
        title: t.title,
        contextLine: taskContextLine(t),
        href: t.projectId ? `/projects/${t.projectId}` : undefined,
        followUp: t.followUp ?? null,
        overdue: !done && bucket === "overdue",
        done,
        raw: t,
      };
    });
  }, [tasks, justCompleted, now, timezone]);

  const mentionItems = useMemo<TodayItem[]>(() => {
    return (notificationsFeed ?? [])
      .filter((n) => !n.archivedAt)
      .map((n) => ({
        key: `mention:${n.id}`,
        kind: "mention" as const,
        bucket: "triage" as const,
        title: n.title,
        contextLine: mentionContextLine(n),
        href: n.href,
        overdue: false,
        readAt: n.readAt ?? null,
        raw: n,
      }));
  }, [notificationsFeed]);

  const overdue = taskItems.filter((i) => i.bucket === "overdue");
  const today = taskItems.filter((i) => i.bucket === "today");
  const later = taskItems.filter((i) => i.bucket === "later");
  const triage = mentionItems;

  const [laterExpanded, setLaterExpanded] = useState(false);
  const [peekKey, setPeekKey] = useState<string | null>(null);

  const visibleOrder = useMemo(
    () => [...overdue, ...today, ...triage, ...(laterExpanded ? later : [])],
    [overdue, today, triage, later, laterExpanded],
  );
  const selectedIndex = visibleOrder.findIndex((i) => i.key === peekKey);
  const peekItem = selectedIndex >= 0 ? visibleOrder[selectedIndex] : null;

  const openItem = useCallback(
    (item: TodayItem) => {
      setPeekKey(item.key);
      if (item.kind === "mention" && !item.readAt) {
        const n = item.raw as Doc<"notifications">;
        void markRead(n.id);
      }
    },
    [markRead],
  );

  const closePeek = useCallback(() => setPeekKey(null), []);

  const moveSelection = useCallback(
    (delta: number) => {
      if (visibleOrder.length === 0) return;
      const from = selectedIndex >= 0 ? selectedIndex : delta > 0 ? -1 : 0;
      const next = Math.max(0, Math.min(visibleOrder.length - 1, from + delta));
      setPeekKey(visibleOrder[next].key);
    },
    [visibleOrder, selectedIndex],
  );

  useKeyboardShortcut("j", () => moveSelection(1));
  useKeyboardShortcut("ArrowDown", () => moveSelection(1));
  useKeyboardShortcut("k", () => moveSelection(-1));
  useKeyboardShortcut("ArrowUp", () => moveSelection(-1));
  useKeyboardShortcut(" ", () => {
    if (peekItem) closePeek();
    else if (selectedIndex >= 0) openItem(visibleOrder[selectedIndex]);
    else if (visibleOrder.length > 0) openItem(visibleOrder[0]);
  });
  useKeyboardShortcut("d", () => {
    const item = peekItem ?? (selectedIndex >= 0 ? visibleOrder[selectedIndex] : null);
    if (item?.kind === "task") toggleTaskDone(item.raw as NativeMyOpenTask, !item.done);
  });
  useKeyboardShortcut("q", () => quickAddInputRef.current?.focus());

  const isLoading = !!orgId && tasks === undefined && notificationsFeed === undefined;
  const isEmpty = !isLoading && overdue.length === 0 && today.length === 0 && triage.length === 0 && later.length === 0;
  const hasOverdue = overdue.length > 0;

  useEffect(() => {
    onStatusChange?.({ isLoading, isEmpty, hasOverdue });
  }, [onStatusChange, isLoading, isEmpty, hasOverdue]);

  return (
    <div className="min-w-0 space-y-5" data-shortcut-scope="today-list">
      {canEditTasks && (
        <WorkComposer
          inputRef={quickAddInputRef}
          assignees={assignees}
          placeholder="Add work (press Q)"
        />
      )}

      {isLoading ? (
        <div className="space-y-2">
          <Skeleton className="h-12 w-full rounded-[var(--r)]" />
          <Skeleton className="h-12 w-full rounded-[var(--r)]" />
          <Skeleton className="h-12 w-full rounded-[var(--r)]" />
        </div>
      ) : isEmpty ? (
        <EmptyState title="All clear — nothing needs you" description="Tasks assigned to you and mentions land here." />
      ) : (
        <>
          {overdue.length > 0 && (
            <FadeIn className="space-y-2">
              <SectionHeader label="Overdue" />
              <StaggerList className="space-y-1">
                {overdue.map((item) => (
                  <StaggerItem key={item.key}>
                    <TodayRow
                      item={item}
                      active={item.key === peekKey}
                      canEdit={canEditTasks}
                      onOpen={() => openItem(item)}
                      onToggleDone={() => toggleTaskDone(item.raw as NativeMyOpenTask, !item.done)}
                    />
                  </StaggerItem>
                ))}
              </StaggerList>
            </FadeIn>
          )}

          {today.length > 0 && (
            <FadeIn delay={0.04} className="space-y-2">
              <SectionHeader label="Today" />
              <StaggerList className="space-y-1">
                {today.map((item) => (
                  <StaggerItem key={item.key}>
                    <TodayRow
                      item={item}
                      active={item.key === peekKey}
                      canEdit={canEditTasks}
                      onOpen={() => openItem(item)}
                      onToggleDone={() => toggleTaskDone(item.raw as NativeMyOpenTask, !item.done)}
                    />
                  </StaggerItem>
                ))}
              </StaggerList>
            </FadeIn>
          )}

          {triage.length > 0 && (
            <FadeIn delay={0.08} className="space-y-2">
              <SectionHeader label={`Triage — ${triage.length}`} />
              <StaggerList className="space-y-1">
                {triage.map((item) => (
                  <StaggerItem key={item.key}>
                    <TodayRow
                      item={item}
                      active={item.key === peekKey}
                      canEdit={canEditTasks}
                      onOpen={() => openItem(item)}
                      onToggleDone={() => {}}
                    />
                  </StaggerItem>
                ))}
              </StaggerList>
            </FadeIn>
          )}

          {later.length > 0 && (
            <FadeIn delay={0.12} className="space-y-2">
              <button
                type="button"
                onClick={() => setLaterExpanded((v) => !v)}
                className="flex w-full items-center gap-2 text-left"
              >
                <SectionHeader label={`Later — ${later.length} ${laterExpanded ? "▾" : "›"}`} className="flex-1" />
              </button>
              {laterExpanded && (
                <StaggerList className="space-y-1">
                  {later.map((item) => (
                    <StaggerItem key={item.key}>
                      <TodayRow
                        item={item}
                        active={item.key === peekKey}
                        canEdit={canEditTasks}
                        onOpen={() => openItem(item)}
                        onToggleDone={() => toggleTaskDone(item.raw as NativeMyOpenTask, !item.done)}
                      />
                    </StaggerItem>
                  ))}
                </StaggerList>
              )}
            </FadeIn>
          )}
        </>
      )}

      <TodayPeek
        item={peekItem}
        canEdit={canEditTasks}
        orgId={orgId}
        onClose={closePeek}
        onToggleDone={(item) => {
          if (item.kind === "task") toggleTaskDone(item.raw as NativeMyOpenTask, !item.done);
        }}
        onMakeTask={(item) => {
          if (item.kind === "mention") promoteMention(item.raw as Doc<"notifications">);
        }}
        onFollowUpOutcome={(item, outcome, nextDate) =>
          writes
            .recordFollowUpOutcome((item.raw as NativeMyOpenTask).id, outcome, { nextDate })
            .then(() => {
              toast.success(outcome === "parked" ? "Parked — it'll come back on that date" : "Logged — the next follow-up is scheduled");
              closePeek();
            })
            .catch((e: unknown) => toast.error(e instanceof Error ? e.message : "Could not record that"))
        }
      />
    </div>
  );
}
