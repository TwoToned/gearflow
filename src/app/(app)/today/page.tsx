"use client";
// use-client: interactive route — live subscription, keyboard nav, optimistic writes (R-8.1.1)

import { useCallback, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { useActiveOrganization } from "@/lib/auth-client";
import { useNativeMyOpenTasks, type NativeMyOpenTask } from "@/hooks/use-native-dashboard";
import { useAuthedQuery } from "@/hooks/use-authed-query";
import { useFocusPolledQuery } from "@/hooks/use-focus-polled-query";
import { useTodayDayRail } from "@/hooks/use-today-day-rail";
import { useProjectTaskWrites } from "@/hooks/use-project-tasks-writes";
import { useWorkSignalWrites } from "@/hooks/use-work-signal-writes";
import { sendCrewOffer } from "@/server/crew-communication";
import { useNotifications } from "@/hooks/use-notifications";
import { useDocumentDatesConfig } from "@/hooks/use-document-dates-config";
import { useCanDo } from "@/lib/use-permissions";
import { useKeyboardShortcut } from "@/hooks/use-keyboard-shortcut";
import { bucketForDueDate } from "@/lib/today-buckets";
import { TASK_STAGE_LABELS, type ProjectTaskStage } from "@/lib/project-tasks";
import { PageHeader } from "@/components/layout/page-header";
import { SectionHeader } from "@/components/ui/section-header";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { FadeIn, StaggerList, StaggerItem } from "@/components/ui/motion";
import { TodayRow } from "@/components/today/today-row";
import { TodayPeek } from "@/components/today/today-peek";
import { TodayDayRail } from "@/components/today/today-day-rail";
import { TodayNeedsYouRail } from "@/components/today/today-needs-you-rail";
import type { TodayItem } from "@/components/today/today-types";
import { api } from "../../../../convex/_generated/api";
import type { Doc } from "../../../../convex/_generated/dataModel";

const MINUTE = 60_000;

// Row anatomy per work-layer.md §8.1: "context line (project · stage · due)".
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

export default function TodayPage() {
  const { data: activeOrg } = useActiveOrganization();
  const orgId = activeOrg?.id;
  const canEditTasks = useCanDo("project", "update");
  const writes = useProjectTaskWrites();
  const signalWrites = useWorkSignalWrites();
  const { timezone } = useDocumentDatesConfig();

  const now = new Date().getTime();
  const nowBucket = Math.floor(now / MINUTE) * MINUTE;

  // Work list — the ONLY live subscription on the page (§10.7/R13): this
  // user is the writer, so ticking something off must feel instant.
  const tasks = useNativeMyOpenTasks(orgId);
  const notificationsFeed = useAuthedQuery(api.notifications.listForMe, { limit: 20 });
  const { markRead } = useNotifications();

  // Signals — one-shot, refresh on focus + a slow interval, never live.
  const home = useFocusPolledQuery(api.dashboardLists.home, orgId ? { orgId } : "skip");
  const needsYou = useFocusPolledQuery(api.dashboardLists.needsYou, orgId ? { orgId, now: nowBucket } : "skip");
  const dayRail = useTodayDayRail(orgId, nowBucket, home.data?.myProjects);

  // Optimistic "just completed" overlay: a task marked done stays visible
  // (struck through, one more click un-does it) until the next real refresh —
  // the live `myOpenTasks` read excludes DONE rows entirely, so without this
  // overlay a click would make the row vanish with no way to correct a
  // mis-click (work-layer.md §8.1: "Done / un-done — un-done matters, the
  // current /my-tasks cycle is one-way").
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

  // Snooze a "needs you" signal (design doc §9) — one-shot polled, so refresh
  // after the write rather than relying on reactivity to reflect the change.
  const snoozeSignal = useCallback(
    (sourceKey: string) => {
      signalWrites.snooze(sourceKey).then(needsYou.refresh).catch((e: unknown) => {
        toast.error(e instanceof Error ? e.message : "Could not snooze");
      });
    },
    [signalWrites, needsYou.refresh],
  );

  // Re-offer a declined/stale crew assignment (work-layer Phase 4, #1246,
  // design §8.5) — the ONE-KEY Triage action, calling the EXISTING offer flow
  // (`sendCrewOffer`, mints a fresh token + sends the offer email) rather than
  // a second, hand-rolled offer path.
  const [reofferingAssignmentId, setReofferingAssignmentId] = useState<string | null>(null);
  const reofferCrew = useCallback(
    (assignmentId: string) => {
      setReofferingAssignmentId(assignmentId);
      sendCrewOffer(assignmentId)
        .then(() => {
          toast.success("Offer sent");
          return needsYou.refresh();
        })
        .catch((e: unknown) => toast.error(e instanceof Error ? e.message : "Could not send the offer"))
        .finally(() => setReofferingAssignmentId(null));
    },
    [needsYou.refresh],
  );

  // Turn a mention into a real task ("make a task", design doc §9's Triage
  // table) — the notification's own dedupeKey is already the deterministic
  // identity a sourceKey needs, so it's reused directly rather than minted twice.
  const promoteMention = useCallback(
    (n: Doc<"notifications">) => {
      signalWrites
        .promote({ sourceKey: n.dedupeKey, title: n.title })
        .then(() => toast.success("Added to your tasks"))
        .catch((e: unknown) => toast.error(e instanceof Error ? e.message : "Could not create the task"));
    },
    [signalWrites],
  );

  // Quick-add (design doc §8.1's `Q` shortcut) — a personal task, no project.
  const [quickAddValue, setQuickAddValue] = useState("");
  const [quickAddBusy, setQuickAddBusy] = useState(false);
  const quickAddInputRef = useRef<HTMLInputElement>(null);
  const submitQuickAdd = useCallback(() => {
    const title = quickAddValue.trim();
    if (!title || quickAddBusy) return;
    setQuickAddBusy(true);
    writes
      .create({ title })
      .then(() => setQuickAddValue(""))
      .catch((e: unknown) => toast.error(e instanceof Error ? e.message : "Could not add the task"))
      .finally(() => setQuickAddBusy(false));
  }, [quickAddValue, quickAddBusy, writes]);

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

  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
  const hasOverdue = overdue.length > 0;
  const isLoading = !!orgId && tasks === undefined && notificationsFeed === undefined;
  const isEmpty = !isLoading && overdue.length === 0 && today.length === 0 && triage.length === 0 && later.length === 0;

  return (
    <div className="space-y-6">
      <FadeIn>
        <PageHeader
          title={greeting}
          description={new Date().toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" })}
          meta={
            !hasOverdue && !isLoading && !isEmpty ? (
              <p className="font-hand text-[15px] text-muted">Nothing on fire.</p>
            ) : undefined
          }
        />
      </FadeIn>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="min-w-0 space-y-5" data-shortcut-scope="today-list">
          {canEditTasks && (
            <FadeIn>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  submitQuickAdd();
                }}
              >
                <input
                  ref={quickAddInputRef}
                  type="text"
                  value={quickAddValue}
                  onChange={(e) => setQuickAddValue(e.target.value)}
                  placeholder="Quick-add a task (press Q)"
                  disabled={quickAddBusy}
                  className="w-full rounded-[var(--r)] border border-line bg-card px-3 py-2 text-[14px] text-ink placeholder:text-faint focus:border-primary focus:outline-none"
                />
              </form>
            </FadeIn>
          )}

          {isLoading ? (
            <div className="space-y-2">
              <Skeleton className="h-12 w-full rounded-[var(--r)]" />
              <Skeleton className="h-12 w-full rounded-[var(--r)]" />
              <Skeleton className="h-12 w-full rounded-[var(--r)]" />
            </div>
          ) : isEmpty ? (
            <EmptyState
              title="All clear — nothing needs you"
              description="Tasks assigned to you and mentions land here."
            />
          ) : (
            <>
              {hasOverdue && (
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
        </div>

        <div className="space-y-4">
          <TodayDayRail entries={dayRail.entries} asOf={dayRail.asOf} error={dayRail.error} onRefresh={dayRail.refresh} />
          <TodayNeedsYouRail data={needsYou.data} asOf={needsYou.asOf} error={needsYou.error} onRefresh={needsYou.refresh} onSnooze={snoozeSignal} onReoffer={reofferCrew} reofferingAssignmentId={reofferingAssignmentId} />
        </div>
      </div>

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
      />
    </div>
  );
}
