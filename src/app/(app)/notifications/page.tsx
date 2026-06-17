"use client";

import { useCallback, useState, useEffect, useMemo } from "react";
import { useNotificationsFeed } from "@/hooks/use-notifications-feed";
import { useRouter } from "next/navigation";
import {
  Bell,
  CalendarClock,
  PackageX,
  Wrench,
  Mail,
  CheckCheck,
  Clock,
  Users,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/layout/page-header";
import { SectionHeader } from "@/components/layout/page-layouts";
import { FadeIn, StaggerList, StaggerItem } from "@/components/ui/motion";
import { type AppNotification } from "@/server/notifications";
import { getStatusColor } from "@/lib/status-colors";
import { formatDistanceToNow, isToday, isYesterday, isThisWeek } from "date-fns";
import { useActiveOrganization } from "@/lib/auth-client";

const DISMISSED_KEY = "gearflow-dismissed-notifications";

function getDismissedIds(): Set<string> {
  try {
    const raw = localStorage.getItem(DISMISSED_KEY);
    return raw ? new Set(JSON.parse(raw)) : new Set();
  } catch {
    return new Set();
  }
}

function saveDismissedIds(ids: Set<string>) {
  localStorage.setItem(DISMISSED_KEY, JSON.stringify([...ids]));
}

const typeIcons: Record<string, React.ComponentType<{ className?: string }>> = {
  overdue_maintenance: Wrench,
  overdue_return: PackageX,
  upcoming_project: CalendarClock,
  pending_invitation: Mail,
  pending_offers: Users,
  pending_timesheets: Clock,
};

const typeLabels: Record<string, string> = {
  overdue_maintenance: "Maintenance",
  overdue_return: "Overdue Return",
  upcoming_project: "Upcoming",
  pending_invitation: "Invitation",
  pending_offers: "Crew",
  pending_timesheets: "Timesheets",
};

const severityBorderColor: Record<string, string> = {
  error: "border-l-error",
  warning: "border-l-warning",
  info: "border-l-info",
};

const severityBgAccent: Record<string, string> = {
  error: "bg-error/5",
  warning: "bg-warning/5",
  info: "bg-transparent",
};

interface GroupedNotifications {
  label: string;
  sectionKey: string;
  items: AppNotification[];
}

function groupByTime(notifications: AppNotification[]): GroupedNotifications[] {
  const today: AppNotification[] = [];
  const yesterday: AppNotification[] = [];
  const thisWeek: AppNotification[] = [];
  const earlier: AppNotification[] = [];

  for (const n of notifications) {
    const date = new Date(n.timestamp);
    if (isToday(date)) {
      today.push(n);
    } else if (isYesterday(date)) {
      yesterday.push(n);
    } else if (isThisWeek(date)) {
      thisWeek.push(n);
    } else {
      earlier.push(n);
    }
  }

  const groups: GroupedNotifications[] = [];
  if (today.length > 0) groups.push({ label: "Today", sectionKey: "today", items: today });
  if (yesterday.length > 0) groups.push({ label: "Yesterday", sectionKey: "yesterday", items: yesterday });
  if (thisWeek.length > 0) groups.push({ label: "This Week", sectionKey: "this-week", items: thisWeek });
  if (earlier.length > 0) groups.push({ label: "Earlier", sectionKey: "earlier", items: earlier });

  return groups;
}

export default function NotificationsPage() {
  const router = useRouter();
  const { data: activeOrg } = useActiveOrganization();
  const orgId = activeOrg?.id;
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());

  useEffect(() => {
    setDismissed(getDismissedIds());
  }, []);

  // Shared, deduped, visibility-aware poll (one scan per interval across this page
  // + the app-shell bell). See use-notifications-feed.
  const { data: notifications, isLoading } = useNotificationsFeed(orgId);

  // Prune dismissed IDs that no longer exist
  useEffect(() => {
    if (!notifications || notifications.length === 0) return;
    const currentIds = new Set(notifications.map((n) => n.id));
    const stored = getDismissedIds();
    let changed = false;
    for (const id of stored) {
      if (!currentIds.has(id)) {
        stored.delete(id);
        changed = true;
      }
    }
    if (changed) {
      saveDismissedIds(stored);
      setDismissed(new Set(stored));
    }
  }, [notifications]);

  const dismiss = useCallback((id: string) => {
    setDismissed((prev) => {
      const next = new Set(prev);
      next.add(id);
      saveDismissedIds(next);
      return next;
    });
  }, []);

  const dismissAll = useCallback(() => {
    if (!notifications) return;
    const allIds = new Set(notifications.map((n) => n.id));
    saveDismissedIds(allIds);
    setDismissed(allIds);
  }, [notifications]);

  const visible = useMemo(
    () => (notifications || []).filter((n) => !dismissed.has(n.id)),
    [notifications, dismissed],
  );

  const errorCount = visible.filter((n) => n.severity === "error").length;
  const warningCount = visible.filter((n) => n.severity === "warning").length;
  const infoCount = visible.filter((n) => n.severity === "info").length;
  const unreadCount = visible.length;

  const groups = useMemo(() => groupByTime(visible), [visible]);

  // Contextual description
  const description = unreadCount === 0
    ? "All clear, nothing requires your attention"
    : [
        errorCount > 0 ? `${errorCount} urgent` : null,
        warningCount > 0 ? `${warningCount} warning${warningCount !== 1 ? "s" : ""}` : null,
        infoCount > 0 ? `${infoCount} informational` : null,
      ]
        .filter(Boolean)
        .join(", ");

  return (
    <div className="space-y-8">
      <FadeIn>
        <PageHeader
          title={unreadCount > 0 ? `${unreadCount} Notification${unreadCount !== 1 ? "s" : ""}` : "Notifications"}
          description={description}
          actions={
            unreadCount > 0 ? (
              <Button variant="outline" onClick={dismissAll}>
                <CheckCheck className="mr-1.5 h-4 w-4" /> Dismiss All
              </Button>
            ) : undefined
          }
        />
      </FadeIn>

      {/* Summary badges */}
      {unreadCount > 0 && (
        <FadeIn delay={0.05}>
          <div className="flex flex-wrap gap-2">
            {errorCount > 0 && (
              <Badge variant="destructive" className="text-xs">
                {errorCount} urgent
              </Badge>
            )}
            {warningCount > 0 && (
              <Badge className="bg-warning-subtle text-warning text-xs">
                {warningCount} warning{warningCount !== 1 ? "s" : ""}
              </Badge>
            )}
            {infoCount > 0 && (
              <Badge variant="secondary" className="text-xs">
                {infoCount} info
              </Badge>
            )}
          </div>
        </FadeIn>
      )}

      {/* Empty state */}
      {!isLoading && unreadCount === 0 && (
        <FadeIn delay={0.1}>
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-success/10 mb-4">
              <CheckCheck className="h-6 w-6 text-success" />
            </div>
            <p className="text-sm font-medium text-fg">All caught up</p>
            <p className="text-xs text-fg-3 mt-1 max-w-xs">
              No pending notifications. We&apos;ll alert you when something needs your attention.
            </p>
          </div>
        </FadeIn>
      )}

      {/* Grouped notifications */}
      {groups.map((group, groupIdx) => (
        <FadeIn key={group.sectionKey} delay={0.08 + groupIdx * 0.05}>
          <SectionHeader label={group.label} />
          <StaggerList className="mt-3 space-y-2">
            {group.items.map((n) => {
              const Icon = typeIcons[n.type] || Bell;
              const colorStyles = getStatusColor("notification", n.severity);

              return (
                <StaggerItem key={n.id}>
                  <div
                    className={`group flex items-start gap-4 rounded-lg border-l-2 ${severityBorderColor[n.severity] || "border-l-fg-3"} ${severityBgAccent[n.severity] || ""} px-4 py-3 cursor-pointer transition-colors hover:bg-bg-surface`}
                    onClick={() => {
                      dismiss(n.id);
                      router.push(n.href);
                    }}
                  >
                    <div className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${n.severity === "error" ? "bg-error/10" : n.severity === "warning" ? "bg-warning/10" : "bg-primary/10"}`}>
                      <Icon className={`h-4 w-4 ${colorStyles.text}`} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-medium truncate">{n.title}</p>
                        <Badge variant="outline" className="shrink-0 text-[10px] px-1.5 py-0">
                          {typeLabels[n.type] || n.type}
                        </Badge>
                      </div>
                      <p className="text-xs text-fg-3 mt-0.5 truncate">{n.description}</p>
                      <p className="text-xs text-fg-3 mt-1">
                        {formatDistanceToNow(new Date(n.timestamp), { addSuffix: true })}
                      </p>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="shrink-0 opacity-0 group-hover:opacity-100 transition-opacity text-xs"
                      onClick={(e) => {
                        e.stopPropagation();
                        dismiss(n.id);
                      }}
                    >
                      Dismiss
                    </Button>
                  </div>
                </StaggerItem>
              );
            })}
          </StaggerList>
        </FadeIn>
      ))}
    </div>
  );
}
