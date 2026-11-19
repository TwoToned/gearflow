"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Bell } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { cn } from "@/lib/utils";
import { useIsMobile } from "@/hooks/use-mobile";
import { useShellFeed, type ShellFeed } from "@/hooks/use-shell-feed";
import type { ShellNotice } from "@/lib/notification-feed";
import { BottomSheet } from "@/components/ui/bottom-sheet";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

/** A dated row: unread dot, title, the type word, one muted line, the time. */
function NoticeBody({ notice }: { notice: ShellNotice }) {
  return (
    <span className="flex min-w-0 flex-1 items-start gap-2.5">
      <span
        aria-label={notice.unread ? "Unread" : undefined}
        className={cn("mt-1.5 size-1.5 shrink-0 rounded-full", notice.unread ? "bg-red" : "bg-transparent")}
      />
      <span className="grid min-w-0 flex-1 gap-0.5">
        <span className="flex items-baseline justify-between gap-2">
          <span className={cn("truncate text-[13px]", notice.unread ? "font-medium text-ink" : "text-ink-2")}>{notice.title}</span>
          <span className="shrink-0 font-mono text-[11px] text-muted">
            {formatDistanceToNow(new Date(notice.at), { addSuffix: true })}
          </span>
        </span>
        <span className="truncate text-[12px] text-muted">
          <span className="text-ink-2">{notice.typeLabel}</span>
          {notice.line ? ` · ${notice.line}` : ""}
        </span>
      </span>
    </span>
  );
}

function BellHead({ feed }: { feed: ShellFeed }) {
  return (
    <div className="flex items-center justify-between gap-2 px-3 py-2">
      <span className="text-[13px] font-semibold text-ink">Notifications</span>
      {feed.unreadCount > 0 && (
        <button
          type="button"
          className="min-h-9 cursor-pointer rounded px-1 text-[12px] text-muted hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red"
          onClick={(e) => {
            e.stopPropagation();
            void feed.markAllRead();
          }}
        >
          Mark all read
        </button>
      )}
    </div>
  );
}

function Empty() {
  return <div className="px-3 py-6 text-center text-[13px] text-muted">All clear. Nothing needs you.</div>;
}

/** The trigger: bell + a mono count (no filled badge, no `9+`). */
function BellButton({ unread, ...props }: { unread: number } & React.ComponentProps<"button">) {
  return (
    <button
      type="button"
      aria-label={`Notifications, ${unread} unread`}
      aria-haspopup="menu"
      {...props}
      className={cn(
        "flex h-9 cursor-pointer items-center gap-1 rounded-[var(--r)] px-2 text-muted transition-colors hover:bg-elev hover:text-ink max-md:size-11 max-md:justify-center",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red",
        props.className,
      )}
    >
      <Bell className="size-4 max-md:size-5" aria-hidden />
      <span className={cn("font-mono text-[11px] tabular-nums", unread === 0 && "opacity-50")}>{unread}</span>
    </button>
  );
}

/**
 * The bell (D70): the derived feed and the stored mentions in ONE list (`useShellFeed`),
 * dated rows, Open = mark read, `Mark all read` with Undo, `All notifications ›` to
 * the full page. A dropdown on desktop, a bottom sheet on a phone.
 */
export function Notifications() {
  const router = useRouter();
  const isMobile = useIsMobile();
  const feed = useShellFeed();
  const [sheetOpen, setSheetOpen] = useState(false);

  const go = (n: ShellNotice) => {
    void feed.open(n);
    router.push(n.href);
  };

  if (isMobile) {
    return (
      <>
        <BellButton unread={feed.unreadCount} onClick={() => setSheetOpen(true)} />
        <BottomSheet open={sheetOpen} onOpenChange={setSheetOpen} title="Notifications">
          <BellHead feed={feed} />
          {feed.items.length === 0 && <Empty />}
          {feed.items.map((n) => (
            <button
              key={n.uid}
              type="button"
              onClick={() => {
                setSheetOpen(false);
                go(n);
              }}
              className="flex min-h-12 w-full items-start px-4 py-2 text-left active:bg-paper-2"
            >
              <NoticeBody notice={n} />
            </button>
          ))}
          <button
            type="button"
            onClick={() => {
              setSheetOpen(false);
              router.push("/notifications");
            }}
            className="min-h-12 w-full px-4 text-left text-[13px] text-muted"
          >
            All notifications ›
          </button>
        </BottomSheet>
      </>
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <BellButton unread={feed.unreadCount} />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-96 p-0">
        <BellHead feed={feed} />
        <div className="max-h-[60vh] overflow-y-auto border-t border-line">
          {feed.items.length === 0 && <Empty />}
          {feed.items.map((n) => (
            <DropdownMenuItem key={n.uid} onClick={() => go(n)} className="items-start rounded-none px-3 py-2.5">
              <NoticeBody notice={n} />
            </DropdownMenuItem>
          ))}
        </div>
        <DropdownMenuItem onClick={() => router.push("/notifications")} className="rounded-none border-t border-line px-3 py-2.5 text-[13px] text-muted">
          All notifications ›
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
