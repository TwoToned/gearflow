"use client";

import { toast } from "sonner";
import { Lock, LockOpen } from "lucide-react";

import { GatedButton } from "@/components/ui/gated-button";
import { CanDo } from "@/components/auth/permission-gate";
import { useServerMutation } from "@/hooks/use-server-mutation";
import { resolveLockCopy, type LockCopyStatus } from "@/lib/lock-copy";
import { intentStyles, intentBorderClass } from "@/lib/status-colors";
import { cn } from "@/lib/utils";

interface ProjectLockStripStatus extends LockCopyStatus {
  loading: boolean;
  canUnlockPricing: boolean;
}

interface ProjectLockStripProps {
  status: ProjectLockStripStatus;
  onUnlock: () => Promise<void>;
}

/**
 * #1230 (successor to #990's Phase E surface 2) — the shared lock strip,
 * mounted ONCE at the top of the project detail (not inside a tab). Renders
 * `resolveLockCopy()` (the ONE copy module, `src/lib/lock-copy.ts`) plus a
 * single "Unlock pricing" action — the whole rule is "one click to clear"
 * (D-table), so there's no dialog, no session, no diff to review first.
 * Renders nothing while pricing is open — absence already reads as "editing
 * normally".
 */
export function ProjectLockStrip({ status, onUnlock }: ProjectLockStripProps) {
  const unlockMutation = useServerMutation({
    mutationFn: onUnlock,
    onSuccess: () => toast.success("Pricing unlocked"),
    onError: (e: Error) => toast.error(e.message),
  });

  if (status.loading || !status.pricingLocked) return null;

  const copy = resolveLockCopy(status);
  const barClass = cn(intentBorderClass(copy.intent), intentStyles[copy.intent].bg, intentStyles[copy.intent].text);

  return (
    <div
      id="lock-strip"
      className={cn("flex flex-wrap items-center justify-between gap-3 rounded-[var(--radius)] border-l-[3px] px-4 py-3 text-sm", barClass)}
    >
      <p className="flex min-w-0 items-center gap-2">
        <Lock className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        <span>
          <span className="font-semibold">{copy.headline}</span> — {copy.detail}
        </span>
      </p>

      <CanDo resource="project" action="update">
        <GatedButton
          variant="line"
          size="sm"
          gated={!status.canUnlockPricing}
          reason="Only an admin/owner/manager or this job's assigned PM can clear the pricing lock."
          loading={unlockMutation.isPending}
          onClick={() => unlockMutation.mutate(undefined)}
        >
          <LockOpen className="h-3.5 w-3.5" /> Unlock pricing
        </GatedButton>
      </CanDo>
    </div>
  );
}
