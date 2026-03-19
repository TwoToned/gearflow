"use client";

import { useCallback, useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import {
  Bell,
  AlertTriangle,
  CalendarClock,
  PackageX,
  Wrench,
  Mail,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { getNotifications, type AppNotification } from "@/server/notifications";
import { getStatusColor } from "@/lib/status-colors";
import { formatDistanceToNow } from "date-fns";
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
  low_stock: AlertTriangle,
  pending_invitation: Mail,
};


export function Notifications() {
  const router = useRouter();
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const { data: activeOrg } = useActiveOrganization();
  const orgId = activeOrg?.id;

  useEffect(() => {
    setDismissed(getDismissedIds());
  }, []);

  const { data: notifications } = useQuery({
    queryKey: ["notifications", orgId],
    queryFn: getNotifications,
    refetchInterval: 60_000,
  });

  // Prune dismissed IDs that no longer exist in the current notification list
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

  const visible = (notifications || []).filter((n) => !dismissed.has(n.id)).slice(0, 10);
  const count = visible.length;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button variant="ghost" size="icon" className="relative" />}>
        <Bell className="h-4 w-4" />
        {count > 0 && (
          <span className="absolute -top-0.5 -right-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-destructive text-[10px] font-bold text-destructive-foreground">
            {count > 9 ? "9+" : count}
          </span>
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-80">
        <DropdownMenuGroup>
          <DropdownMenuLabel>Notifications</DropdownMenuLabel>
          <DropdownMenuSeparator />
          {count === 0 ? (
            <div className="py-6 text-center text-sm text-fg-3">
              All clear — no notifications.
            </div>
          ) : (
            visible.map((n) => {
              const Icon = typeIcons[n.type] || Bell;
              return (
                <DropdownMenuItem
                  key={n.id}
                  onClick={() => {
                    dismiss(n.id);
                    router.push(n.href);
                  }}
                  className="flex items-start gap-3 py-2.5"
                >
                  <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${getStatusColor("notification", n.severity).text}`} />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{n.title}</p>
                    <p className="text-xs text-fg-3 truncate">{n.description}</p>
                    <p className="text-xs text-fg-3 mt-0.5">
                      {formatDistanceToNow(new Date(n.timestamp), { addSuffix: true })}
                    </p>
                  </div>
                </DropdownMenuItem>
              );
            })
          )}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
