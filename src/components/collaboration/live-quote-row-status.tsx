"use client";

import { useEffect, useState } from "react";
import { useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { MessageCircle, Pencil } from "lucide-react";
import { ReviewMarkerBadge, type MarkerStatus } from "./review-marker-badge";
import { timeAgo } from "@/lib/collaboration-colors";
import { cn } from "@/lib/utils";

interface LiveQuoteRowStatusProps {
  orgId: string;
  entityId: string; // projectId
  targetId: string; // lineItemId
  /** Comment count badge (open thread count). */
  openCommentCount?: number;
  /** Review marker for this row. */
  markerStatus?: MarkerStatus;
  markerReason?: string;
  /** Name of the user who last updated this row (passed from parent when available). */
  updatedByName?: string;
  /** Timestamp of the last update, for "updated X ago" label. */
  updatedAt?: number;
  className?: string;
}

/**
 * Badge strip on a quote line item row showing:
 * - editing lock badge (Pencil + name, when someone is editing)
 * - comment count badge (open threads)
 * - review/follow-up/resolved marker badge
 * - recently-updated label
 */
export function LiveQuoteRowStatus({
  orgId,
  entityId,
  targetId,
  openCommentCount,
  markerStatus,
  markerReason,
  updatedByName,
  updatedAt,
  className,
}: LiveQuoteRowStatusProps) {
  const lock = useQuery(
    api.collaboration.getLock,
    orgId ? { orgId, entityType: "project", entityId, targetType: "lineItem", targetId } : "skip"
  );

  const [showUpdated, setShowUpdated] = useState(false);
  const [prevUpdatedAt, setPrevUpdatedAt] = useState(updatedAt);

  // Flash the "updated" state briefly when updatedAt changes
  useEffect(() => {
    if (updatedAt !== undefined && updatedAt !== prevUpdatedAt) {
      setShowUpdated(true);
      setPrevUpdatedAt(updatedAt);
      const t = setTimeout(() => setShowUpdated(false), 4000);
      return () => clearTimeout(t);
    }
  }, [updatedAt, prevUpdatedAt]);

  const hasLock = lock && !lock.isStale && lock.status === "active";
  const showEmpty = !hasLock && !openCommentCount && !markerStatus && !showUpdated;

  if (showEmpty) return null;

  return (
    <div className={cn("flex items-center gap-1 flex-wrap", className)}>
      {hasLock && (
        <span
          className="inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] font-medium leading-none"
          style={{
            background: lock.ownerColor + "22",
            borderColor: lock.ownerColor + "66",
            color: lock.ownerColor,
          }}
        >
          <Pencil className="h-2.5 w-2.5" />
          {lock.ownerName.split(" ")[0]}
        </span>
      )}

      {openCommentCount != null && openCommentCount > 0 && (
        <span className="inline-flex items-center gap-0.5 rounded border border-muted-foreground/30 bg-muted px-1.5 py-0.5 text-[10px] font-medium leading-none text-muted-foreground">
          <MessageCircle className="h-2.5 w-2.5" />
          {openCommentCount}
        </span>
      )}

      {markerStatus && (
        <ReviewMarkerBadge status={markerStatus} reason={markerReason} />
      )}

      {showUpdated && updatedByName && (
        <span className="text-[10px] text-muted-foreground">
          Updated by {updatedByName}{updatedAt ? ` ${timeAgo(updatedAt)}` : ""}
        </span>
      )}
    </div>
  );
}

/** Subtle pulse ring on a row that is being edited by another user. */
export function EditingRowHighlight({
  orgId,
  entityId,
  targetId,
  myUserId,
}: {
  orgId: string;
  entityId: string;
  targetId: string;
  myUserId?: string;
}) {
  const lock = useQuery(
    api.collaboration.getLock,
    orgId ? { orgId, entityType: "project", entityId, targetType: "lineItem", targetId } : "skip"
  );

  const isOtherEditing = lock && !lock.isStale && lock.status === "active" && lock.ownerUserId !== myUserId;

  if (!isOtherEditing) return null;

  return (
    <div
      className="pointer-events-none absolute inset-0 rounded-sm motion-safe:animate-pulse"
      style={{ boxShadow: `0 0 0 1.5px ${lock.ownerColor}55` }}
      aria-hidden="true"
    />
  );
}
