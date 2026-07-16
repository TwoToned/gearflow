"use client";

import { useCallback, useMemo, useEffect } from "react";
import { useServerMutation } from "@/hooks/use-server-mutation";
import { useNotificationsFeed } from "@/hooks/use-notifications-feed";
import { useNotificationDismissals } from "@/hooks/use-notification-dismissals";
import { useRouter } from "next/navigation";
import {
  Bell,
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
import { getStatusColor } from "@/lib/status-colors";
import { formatDistanceToNow } from "date-fns";
import { useActiveOrganization } from "@/lib/auth-client";

// Optimistic-UI fallback. The DB is the source of truth; this just hides the
// item instantly while the server mutation is in flight.
const DISMISSED_KEY = "gearflow-dismissed-notifications";

function readLocalDismissed(): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    const raw = window.localStorage.getItem(DISMISSED_KEY);
    return raw ? new Set(JSON.parse(raw)) : new Set();
  } catch {
    return new Set();
  }
}

function writeLocalDismissed(ids: Set<string>) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(DISMISSED_KEY, JSON.stringify([...ids]));
  } catch {
    // localStorage may be unavailable (private mode, quota) — non-fatal.
  }
}

const typeIcons: Record<string, React.ComponentType<{ className?: string }>> = {
  overdue_maintenance: Wrench,
  overdue_return: PackageX,
  upcoming_project: CalendarClock,
  pending_invitation: Mail,
};


export function Notifications() {
  const router = useRouter();
  const { data: activeOrg } = useActiveOrganization();
  const orgId = activeOrg?.id;

  // Shared, deduped, visibility-aware poll (one scan per interval across the bell
  // + the /notifications page; pauses in background tabs). See use-notifications-feed.
  const { data: notifications } = useNotificationsFeed(orgId);

  // DB-backed dismissals (Convex, reactive) — the source of truth (survives
  // browser/device changes). A dismiss/prune write updates this live.
  const { dismissedKeys: serverDismissed, dismiss: dismissNative, prune } =
    useNotificationDismissals();

  // Union of server-side dismissals and the local optimistic set so newly
  // clicked items disappear immediately, even before the mutation resolves.
  const dismissed = useMemo(() => {
    const merged = new Set<string>(serverDismissed ?? []);
    for (const id of readLocalDismissed()) merged.add(id);
    return merged;
  }, [serverDismissed]);

  // Prune stale rows on the server when the active notification list changes.
  // Fire-and-forget; the reactive `mine` query picks up the trimmed list.
  useEffect(() => {
    if (!notifications || notifications.length === 0) return;
    const activeKeys = notifications.map((n) => n.id);
    void prune(activeKeys).catch(() => {});

    // Also tidy localStorage so it doesn't grow unbounded.
    const stored = readLocalDismissed();
    const active = new Set(activeKeys);
    let changed = false;
    for (const id of stored) {
      if (!active.has(id)) {
        stored.delete(id);
        changed = true;
      }
    }
    if (changed) writeLocalDismissed(stored);
  }, [notifications, prune]);

  const dismissMutation = useServerMutation({
    mutationFn: (id: string) => dismissNative(id),
  });

  const dismiss = useCallback(
    (id: string) => {
      // Optimistic: write to localStorage immediately, then mutate.
      const local = readLocalDismissed();
      local.add(id);
      writeLocalDismissed(local);
      dismissMutation.mutate(id);
    },
    [dismissMutation],
  );

  const visible = (notifications || []).filter((n) => !dismissed.has(n.id)).slice(0, 10);
  const count = visible.length;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" aria-label="Notifications" className="relative">
          <Bell className="h-4 w-4" />
          {count > 0 && (
            <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-red px-1 text-[10px] font-bold leading-none text-white">
              {count > 9 ? "9+" : count}
            </span>
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-80">
        <DropdownMenuGroup>
          <DropdownMenuLabel>Notifications</DropdownMenuLabel>
          <DropdownMenuSeparator />
          {count === 0 ? (
            <div className="py-6 text-center text-sm text-muted">
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
                    <p className="text-xs text-muted truncate">{n.description}</p>
                    <p className="text-xs text-muted mt-0.5">
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
