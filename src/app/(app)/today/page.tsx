"use client";
// use-client: interactive route — live subscription, keyboard nav, optimistic writes (R-8.1.1)

import { useCallback, useMemo, useState } from "react";
import { toast } from "sonner";
import { useActiveOrganization } from "@/lib/auth-client";
import { useNativeMyOpenTasks, type NativeMyOpenTask } from "@/hooks/use-native-dashboard";
import { useAuthedQuery } from "@/hooks/use-authed-query";
import { useFocusPolledQuery } from "@/hooks/use-focus-polled-query";
import { useTodayDayRail } from "@/hooks/use-today-day-rail";
import { useProjectTaskWrites } from "@/hooks/use-project-tasks-writes";
import { useNotifications } from "@/hooks/use-notifications";
import { useDocumentDatesConfig } from "@/hooks/use-document-dates-config";
import { useCanDo } from "@/lib/use-permissions";
import { useKeyboardShortcut } from "@/hooks/use-keyboard-shortcut";
import { bucketForDueDate } from "@/lib/today-buckets";
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

function taskContextLine(task: NativeMyOpenTask): string {
  const parts = task.projectId ? [task.projectNumber, task.projectName].filter(Boolean) : ["Personal"];
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
          <TodayNeedsYouRail data={needsYou.data} asOf={needsYou.asOf} error={needsYou.error} onRefresh={needsYou.refresh} />
        </div>
      </div>

      <TodayPeek
        item={peekItem}
        canEdit={canEditTasks}
        onClose={closePeek}
        onToggleDone={(item) => {
          if (item.kind === "task") toggleTaskDone(item.raw as NativeMyOpenTask, !item.done);
        }}
      />
    </div>
  );
}
