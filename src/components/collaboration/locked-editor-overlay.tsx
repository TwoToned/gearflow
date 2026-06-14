"use client";

import { Lock, Clock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { timeAgo } from "@/lib/collaboration-colors";
import type { LockState } from "@/hooks/use-collaboration";

interface LockedEditorOverlayProps {
  lockState: LockState;
  onTakeover?: () => void;
  className?: string;
}

/**
 * Banner shown inside a read-only editor when another user holds the lock.
 * For stale locks, offers a "Take over" recovery action.
 */
export function LockedEditorOverlay({ lockState, onTakeover, className }: LockedEditorOverlayProps) {
  if (lockState.status !== "blocked" && lockState.status !== "stale") return null;

  const isStale = lockState.status === "stale";
  const ownerName = lockState.ownerName;
  const ownerColor = lockState.ownerColor;

  return (
    <div
      className={`flex items-start gap-3 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm dark:border-amber-800 dark:bg-amber-950/40 ${className ?? ""}`}
      role="status"
    >
      <span
        className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-white"
        style={{ background: ownerColor }}
      >
        {isStale ? <Clock className="h-3 w-3" /> : <Lock className="h-3 w-3" />}
      </span>

      <div className="flex-1 min-w-0">
        {isStale ? (
          <p className="text-amber-800 dark:text-amber-200">
            <strong>{ownerName}</strong> was editing this, but their session seems inactive.
            Lock expired {timeAgo(lockState.expiresAt)}.
          </p>
        ) : (
          <p className="text-amber-800 dark:text-amber-200">
            <strong>{ownerName}</strong> is currently editing this.
            You can view it now — editing is locked until they finish.
          </p>
        )}

        {isStale && onTakeover && (
          <Button
            size="sm"
            variant="outline"
            className="mt-2 h-7 text-xs border-amber-300 hover:bg-amber-100 dark:border-amber-700 dark:hover:bg-amber-900/40"
            onClick={onTakeover}
          >
            Take over editing
          </Button>
        )}
      </div>
    </div>
  );
}
