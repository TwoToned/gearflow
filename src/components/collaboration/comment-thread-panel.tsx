"use client";

import { useState } from "react";
import { useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { MessageCircle, CheckCircle2, RotateCcw, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { useServerMutation } from "@/hooks/use-server-mutation";
import { createThread, addComment, resolveThread, reopenThread } from "@/server/collaboration";
import { getForegroundColor, getUserInitials, timeAgo } from "@/lib/collaboration-colors";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

interface Comment {
  _id: string;
  body: string;
  authorId: string;
  authorName: string;
  authorColor: string;
  createdAt: number;
  editedAt?: number;
  deletedAt?: number;
}

interface Thread {
  _id: string;
  status: string;
  createdByName: string;
  createdAt: number;
  updatedAt: number;
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
}

function ThreadView({ orgId, thread }: ThreadViewProps) {
  const [reply, setReply] = useState("");
  const comments = useQuery(api.collaboration.listComments, {
    orgId,
    threadId: thread._id,
  }) as Comment[] | undefined;

  const addMut = useServerMutation({
    mutationFn: ({ body }: { body: string }) => addComment(thread._id, body),
    onSuccess: () => setReply(""),
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

  const isResolved = thread.status === "resolved";

  return (
    <div className={cn("rounded-lg border p-3 space-y-3", isResolved && "opacity-70")}>
      <div className="flex items-center justify-between">
        <span className="text-[10px] text-muted-foreground">
          {timeAgo(thread.createdAt)}
        </span>
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

      <div className="space-y-2">
        {(comments ?? []).map((c) => (
          <CommentBubble key={c._id} comment={c} />
        ))}
      </div>

      {!isResolved && (
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
  /** Label for the trigger button. */
  triggerLabel?: string;
  children?: React.ReactNode;
}

/**
 * Sheet panel showing all comment threads for a target entity/sub-target.
 * Children override the default trigger button.
 */
export function CommentThreadPanel({
  orgId,
  entityType,
  entityId,
  targetType,
  targetId,
  triggerLabel,
  children,
}: CommentThreadPanelProps) {
  const [open, setOpen] = useState(false);
  const [newComment, setNewComment] = useState("");

  const threads = useQuery(
    api.collaboration.listThreads,
    open ? { orgId, entityType, entityId, targetType, targetId } : "skip"
  ) as Thread[] | undefined;

  const createMut = useServerMutation({
    mutationFn: ({ body }: { body: string }) =>
      createThread(entityType, entityId, body, targetType, targetId),
    onSuccess: () => setNewComment(""),
    onError: (e) => toast.error(e.message),
  });

  const openCount = (threads ?? []).filter((t) => t.status === "open").length;

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger>
        {children ?? (
          <Button size="sm" variant="ghost" className="relative h-7 gap-1 px-2 text-xs">
            <MessageCircle className="h-3.5 w-3.5" />
            {triggerLabel}
            {openCount > 0 && (
              <span className="absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full bg-primary text-[9px] text-primary-foreground">
                {openCount}
              </span>
            )}
          </Button>
        )}
      </SheetTrigger>
      <SheetContent side="right" className="w-[360px] sm:w-[400px] flex flex-col">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2 text-base">
            <MessageCircle className="h-4 w-4" />
            Comments
            {openCount > 0 && (
              <span className="rounded-full bg-primary px-1.5 py-0.5 text-[10px] text-primary-foreground">
                {openCount} open
              </span>
            )}
          </SheetTitle>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto space-y-3 py-2">
          {(threads ?? []).length === 0 && (
            <p className="text-sm text-muted-foreground text-center py-8">
              No comments yet. Start a discussion below.
            </p>
          )}
          {(threads ?? []).map((t) => (
            <ThreadView key={t._id} orgId={orgId} thread={t} />
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
