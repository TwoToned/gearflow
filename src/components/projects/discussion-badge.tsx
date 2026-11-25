"use client";

import { MessageCircle } from "lucide-react";

import { useAuthedQuery } from "@/hooks/use-authed-query";
import { api } from "../../../convex/_generated/api";
import { cn, focusRing } from "@/lib/utils";

/**
 * The job header's discussion count (UX Phase 10, spec §8c): `n open` (red, `n
 * blocking`, when something holds prep) that JUMPS to the Discussion section of the
 * Tasks & notes tab. Absent when nothing is open. Counts come from the one
 * `listThreadCommentCounts` read, summed over the job and its line items.
 */
export function DiscussionBadge({ projectId, orgId, onOpen }: { projectId: string; orgId: string | undefined; onOpen: () => void }) {
  const counts = useAuthedQuery(api.collaboration.listThreadCommentCounts, orgId ? { orgId, entityType: "project", entityId: projectId } : "skip");
  if (!counts) return null;
  const rows = Object.values(counts);
  const open = rows.reduce((n, c) => n + c.open, 0);
  const blocking = rows.reduce((n, c) => n + c.blockingOpen, 0);
  if (open === 0) return null;
  return (
    <button
      type="button"
      onClick={onOpen}
      className={cn("inline-flex items-center gap-1.5 self-start rounded-sm text-caption hover:underline", blocking > 0 ? "font-medium text-error" : "text-muted hover:text-ink", focusRing)}
    >
      <MessageCircle className="size-3.5" aria-hidden="true" />
      {blocking > 0 ? `${blocking} blocking · ${open} open` : `${open} open`} {open === 1 ? "discussion" : "discussions"}
    </button>
  );
}
