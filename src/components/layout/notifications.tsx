"use client";

import { useRouter } from "next/navigation";
import { AtSign, Bell } from "lucide-react";
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
import { formatDistanceToNow } from "date-fns";
import { useNotifications } from "@/hooks/use-notifications";

// Work-layer phase 0 (#1241, work-layer.md §10.2) — the bell reads the stored
// `notifications` table (mentions today; other work-layer event types land as
// later phases emit them) instead of the derived nine-type org-wide scan. The
// dashboard's "Needs attention" chip tray keeps reading the derived feed
// (src/server/notifications.ts) unchanged — only the bell moved.
const typeIcons: Record<string, React.ComponentType<{ className?: string }>> = {
  mentioned: AtSign,
};

export function Notifications() {
  const router = useRouter();
  const { notifications, unreadCount, markRead, markAllRead } = useNotifications();

  const visible = notifications ?? [];
  const count = unreadCount ?? 0;

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
          <DropdownMenuLabel className="flex items-center justify-between gap-2">
            <span>Notifications</span>
            {count > 0 && (
              <button
                type="button"
                className="text-xs font-normal text-muted hover:text-fg"
                onClick={(e) => {
                  e.stopPropagation();
                  void markAllRead();
                }}
              >
                Mark all read
              </button>
            )}
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          {visible.length === 0 ? (
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
                    if (!n.readAt) void markRead(n.id);
                    router.push(n.href);
                  }}
                  className="flex items-start gap-3 py-2.5"
                >
                  <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${n.readAt ? "text-muted" : "text-primary"}`} />
                  <div className="flex-1 min-w-0">
                    <p className={`text-sm truncate ${n.readAt ? "font-normal" : "font-medium"}`}>{n.title}</p>
                    {n.body && <p className="text-xs text-muted truncate">{n.body}</p>}
                    <p className="text-xs text-muted mt-0.5">
                      {formatDistanceToNow(new Date(n.createdAt), { addSuffix: true })}
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
