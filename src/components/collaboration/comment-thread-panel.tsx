"use client";

import { useMemo, useState } from "react";
import { useAuthedQuery } from "@/hooks/use-authed-query";
import { api } from "../../../convex/_generated/api";
import {
  MessageCircle,
  CheckCircle2,
  RotateCcw,
  Send,
  ShieldAlert,
  AtSign,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuCheckboxItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useServerMutation } from "@/hooks/use-server-mutation";
import { useServerQuery } from "@/hooks/use-server-query";
import {
  createThread,
  addComment,
  resolveThread,
  reopenThread,
  setThreadBlocking,
} from "@/server/collaboration";
import { getMentionableMembers } from "@/server/org-members";
import { getForegroundColor, getUserInitials, timeAgo } from "@/lib/collaboration-colors";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

interface Comment {
  _id: string;
  body: string;
  authorId: string;
  authorName: string;
  authorColor: string;
  mentionUserIds?: string[];
  createdAt: number;
  editedAt?: number;
  deletedAt?: number;
}

interface Thread {
  _id: string;
  status: string;
  isBlocking?: boolean;
  mentionUserIds?: string[];
  createdByName: string;
  createdAt: number;
  updatedAt: number;
}

interface Member {
  userId: string;
  name: string;
  image: string | null;
}

/** Compact @mention multi-select backed by the org member directory. */
function MentionPicker({
  members,
  selected,
  onChange,
}: {
  members: Member[];
  selected: string[];
  onChange: (ids: string[]) => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="h-7 gap-1 px-2 text-[11px] text-muted-foreground"
          />
        }
      >
        <AtSign className="h-3.5 w-3.5" />
        {selected.length > 0 ? `${selected.length} mentioned` : "Mention"}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="max-h-64 overflow-y-auto">
        {members.length === 0 && (
          <div className="px-2 py-1.5 text-xs text-muted-foreground">No members</div>
        )}
        {members.map((m) => (
          <DropdownMenuCheckboxItem
            key={m.userId}
            checked={selected.includes(m.userId)}
            onCheckedChange={(checked) =>
              onChange(
                checked
                  ? [...selected, m.userId]
                  : selected.filter((id) => id !== m.userId),
              )
            }
            // Keep the menu open while toggling multiple people.
            closeOnClick={false}
          >
            {m.name}
          </DropdownMenuCheckboxItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function MentionChips({
  ids,
  members,
}: {
  ids: string[];
  members: Member[];
}) {
  if (ids.length === 0) return null;
  const names = ids.map((id) => members.find((m) => m.userId === id)?.name ?? "someone");
  return (
    <div className="flex flex-wrap gap-1">
      {names.map((n, i) => (
        <span
          key={`${n}-${i}`}
          className="inline-flex items-center gap-0.5 rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] text-primary"
        >
          <AtSign className="h-2.5 w-2.5" />
          {n}
        </span>
      ))}
    </div>
  );
}

function CommentBubble({ comment }: { comment: Comment }) {
  const initials = getUserInitials(comment.authorName);
  const fg = getForegroundColor(comment.authorColor);
  return (
    <div className="flex gap-2">
      <div
        className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[9px] font-bold"
        style={{ background: comment.authorColor, color: fg }}
      >
        {initials}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span className="text-xs font-medium">{comment.authorName}</span>
          <span className="text-[10px] text-muted-foreground">{timeAgo(comment.createdAt)}</span>
        </div>
        <p className="mt-0.5 whitespace-pre-wrap break-words text-sm leading-snug">{comment.body}</p>
      </div>
    </div>
  );
}

interface ThreadViewProps {
  orgId: string;
  thread: Thread;
  members: Member[];
}

function ThreadView({ orgId, thread, members }: ThreadViewProps) {
  const [reply, setReply] = useState("");
  const [mentions, setMentions] = useState<string[]>([]);
  const comments = useAuthedQuery(api.collaboration.listComments, {
    orgId,
    threadId: thread._id,
  }) as Comment[] | undefined;

  const addMut = useServerMutation({
    mutationFn: ({ body }: { body: string }) =>
      addComment(thread._id, body, mentions.length ? { mentionUserIds: mentions } : undefined),
    onSuccess: () => {
      setReply("");
      setMentions([]);
    },
    onError: (e) => toast.error(e.message),
  });

  const resolveMut = useServerMutation({
    mutationFn: () => resolveThread(thread._id),
    onError: (e) => toast.error(e.message),
  });

  const reopenMut = useServerMutation({
    mutationFn: () => reopenThread(thread._id),
    onError: (e) => toast.error(e.message),
  });

  const blockMut = useServerMutation({
    mutationFn: () => setThreadBlocking(thread._id, !thread.isBlocking),
    onError: (e) => toast.error(e.message),
  });

  const isResolved = thread.status === "resolved";
  const isBlocking = !!thread.isBlocking && !isResolved;

  return (
    <div
      className={cn(
        "rounded-lg border p-3 space-y-3",
        isResolved && "opacity-70",
        isBlocking && "border-red-500/40 bg-red-500/5",
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-muted-foreground">{timeAgo(thread.createdAt)}</span>
          {isBlocking && (
            <span className="inline-flex items-center gap-0.5 rounded-full bg-red-500/15 px-1.5 py-0.5 text-[10px] font-medium text-red-600">
              <ShieldAlert className="h-2.5 w-2.5" />
              Blocking
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          {!isResolved && (
            <Button
              size="sm"
              variant="ghost"
              className={cn(
                "h-6 gap-1 px-2 text-[10px]",
                thread.isBlocking ? "text-red-600 hover:text-red-700" : "text-muted-foreground",
              )}
              onClick={() => blockMut.mutate()}
              disabled={blockMut.isPending}
              title={thread.isBlocking ? "Stop blocking prep / send-out" : "Block prep / send-out until resolved"}
            >
              <ShieldAlert className="h-3 w-3" />
              {thread.isBlocking ? "Unblock" : "Block"}
            </Button>
          )}
          {isResolved ? (
            <Button
              size="sm"
              variant="ghost"
              className="h-6 gap-1 px-2 text-[10px]"
              onClick={() => reopenMut.mutate()}
              disabled={reopenMut.isPending}
            >
              <RotateCcw className="h-3 w-3" />
              Reopen
            </Button>
          ) : (
            <Button
              size="sm"
              variant="ghost"
              className="h-6 gap-1 px-2 text-[10px] text-green-700 hover:text-green-800"
              onClick={() => resolveMut.mutate()}
              disabled={resolveMut.isPending}
            >
              <CheckCircle2 className="h-3 w-3" />
              Resolve
            </Button>
          )}
        </div>
      </div>

      <div className="space-y-2">
        {(comments ?? []).map((c) => (
          <CommentBubble key={c._id} comment={c} />
        ))}
      </div>

      {!isResolved && (
        <div className="space-y-2">
          <div className="flex gap-2">
            <Textarea
              value={reply}
              onChange={(e) => setReply(e.target.value)}
              placeholder="Reply…"
              className="min-h-[52px] resize-none text-sm"
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && reply.trim()) {
                  addMut.mutate({ body: reply.trim() });
                }
              }}
            />
            <Button
              size="icon"
              className="shrink-0 self-end"
              disabled={!reply.trim() || addMut.isPending}
              onClick={() => addMut.mutate({ body: reply.trim() })}
            >
              <Send className="h-4 w-4" />
            </Button>
          </div>
          <div className="flex items-center gap-2">
            <MentionPicker members={members} selected={mentions} onChange={setMentions} />
            <MentionChips ids={mentions} members={members} />
          </div>
        </div>
      )}
    </div>
  );
}

interface CommentThreadPanelProps {
  orgId: string;
  entityType: string;
  entityId: string;
  targetType?: string;
  targetId?: string;
  /** Denormalised project id for cross-project blocking summaries. Defaults to
   * entityId when entityType is "project". */
  projectId?: string;
  /** Label for the trigger button. */
  triggerLabel?: string;
  children?: React.ReactNode;
}

/**
 * Sheet panel showing all comment threads for a target entity/sub-target.
 * Children override the default trigger button. Supports blocking comments
 * (gate prep / send-out) and @mentions.
 */
export function CommentThreadPanel({
  orgId,
  entityType,
  entityId,
  targetType,
  targetId,
  projectId,
  triggerLabel,
  children,
}: CommentThreadPanelProps) {
  const [open, setOpen] = useState(false);
  const [newComment, setNewComment] = useState("");
  const [blocking, setBlocking] = useState(false);
  const [mentions, setMentions] = useState<string[]>([]);

  const threads = useAuthedQuery(
    api.collaboration.listThreads,
    open ? { orgId, entityType, entityId, targetType, targetId } : "skip"
  ) as Thread[] | undefined;

  // Filter to this sub-target — listThreads without a targetId returns ALL
  // threads on the entity, so a project-level panel must drop line-item threads.
  const visibleThreads = useMemo(() => {
    if (!threads) return undefined;
    if (targetId) return threads;
    return threads.filter((t) => !(t as Thread & { targetId?: string }).targetId);
  }, [threads, targetId]);

  const { data: members } = useServerQuery({
    queryKey: ["mentionable-members", orgId],
    queryFn: getMentionableMembers,
    enabled: open,
  });
  const memberList = (members ?? []) as Member[];

  const createMut = useServerMutation({
    mutationFn: ({ body }: { body: string }) =>
      createThread(entityType, entityId, body, targetType, targetId, {
        isBlocking: blocking,
        mentionUserIds: mentions.length ? mentions : undefined,
        projectId,
      }),
    onSuccess: () => {
      setNewComment("");
      setBlocking(false);
      setMentions([]);
    },
    onError: (e) => toast.error(e.message),
  });

  const openThreads = (visibleThreads ?? []).filter((t) => t.status === "open");
  const openCount = openThreads.length;
  const blockingCount = openThreads.filter((t) => t.isBlocking).length;

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger>
        {children ?? (
          <Button size="sm" variant="ghost" className="relative h-7 gap-1 px-2 text-xs">
            <MessageCircle className="h-3.5 w-3.5" />
            {triggerLabel}
            {blockingCount > 0 ? (
              <span className="absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full bg-red-600 text-[9px] text-white">
                {blockingCount}
              </span>
            ) : openCount > 0 ? (
              <span className="absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full bg-primary text-[9px] text-primary-foreground">
                {openCount}
              </span>
            ) : null}
          </Button>
        )}
      </SheetTrigger>
      <SheetContent side="right" className="w-[360px] sm:w-[400px] flex flex-col">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2 text-base">
            <MessageCircle className="h-4 w-4" />
            Comments
            {blockingCount > 0 && (
              <span className="inline-flex items-center gap-1 rounded-full bg-red-600 px-1.5 py-0.5 text-[10px] text-white">
                <ShieldAlert className="h-2.5 w-2.5" />
                {blockingCount} blocking
              </span>
            )}
            {openCount > 0 && (
              <span className="rounded-full bg-primary px-1.5 py-0.5 text-[10px] text-primary-foreground">
                {openCount} open
              </span>
            )}
          </SheetTitle>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto space-y-3 py-2">
          {(visibleThreads ?? []).length === 0 && (
            <p className="text-sm text-muted-foreground text-center py-8">
              No comments yet. Start a discussion below.
            </p>
          )}
          {(visibleThreads ?? []).map((t) => (
            <ThreadView key={t._id} orgId={orgId} thread={t} members={memberList} />
          ))}
        </div>

        <div className="border-t pt-3 space-y-2">
          <Textarea
            value={newComment}
            onChange={(e) => setNewComment(e.target.value)}
            placeholder="Start a new discussion…"
            className="resize-none text-sm"
            rows={3}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && newComment.trim()) {
                createMut.mutate({ body: newComment.trim() });
              }
            }}
          />
          <div className="flex items-center justify-between gap-2">
            <MentionPicker members={memberList} selected={mentions} onChange={setMentions} />
            <label className="flex cursor-pointer items-center gap-1.5 text-[11px] text-muted-foreground">
              <ShieldAlert className={cn("h-3.5 w-3.5", blocking && "text-red-600")} />
              Blocking
              <Switch checked={blocking} onCheckedChange={setBlocking} />
            </label>
          </div>
          <MentionChips ids={mentions} members={memberList} />
          {blocking && (
            <p className="text-[10px] text-red-600">
              Blocks prepping &amp; sending out until resolved.
            </p>
          )}
          <Button
            className="w-full gap-1"
            disabled={!newComment.trim() || createMut.isPending}
            onClick={() => createMut.mutate({ body: newComment.trim() })}
          >
            <Send className="h-4 w-4" />
            Post comment
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
