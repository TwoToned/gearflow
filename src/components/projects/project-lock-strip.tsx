"use client";

import { useState } from "react";
import { toast } from "sonner";
import { FileText, Lock, LockOpen, Undo2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { GatedButton } from "@/components/ui/gated-button";
import { CanDo } from "@/components/auth/permission-gate";
import { useServerMutation } from "@/hooks/use-server-mutation";
import { useAuthedQuery } from "@/hooks/use-authed-query";
import { useQuoteWrites } from "@/hooks/use-quote-writes";
import { api } from "../../../convex/_generated/api";
import { resolveLockCopy, type LockCopyStatus } from "@/lib/lock-copy";
import { intentStyles, intentBorderClass } from "@/lib/status-colors";
import { cn } from "@/lib/utils";
import { UnlockSessionBanner } from "@/components/projects/unlock-session-banner";
import { RecallToEditDialog } from "@/components/projects/finance/recall-to-edit-dialog";

interface ProjectLockStripStatus extends LockCopyStatus {
  loading: boolean;
  canOverrideHardLock: boolean;
}

interface ProjectLockStripProps {
  projectId: string;
  orgId: string | undefined;
  status: ProjectLockStripStatus;
  now: number;
  /** Opens the shared `<UnlockSessionDialog>` (mounted once at the page level,
   *  scope chosen from `status.tier === "HARD_LOCKED" ? "FULL" : "FINANCIAL"`). */
  onOpenUnlock: () => void;
}

/**
 * #990 (Phase E) surface 2 — the shared lock strip, mounted ONCE at the top of
 * the project detail (not inside a tab), replacing the Financials/Finance-tab-
 * only banner (`QuoteLockStrip`, Phase D). One `useProjectLockStatus`
 * subscription (owned by the page, passed down as `status`) backs every lock
 * surface on the page — this strip, the header chip, and every gated
 * field/button below it.
 *
 * Renders `resolveLockCopy()` (the ONE copy module, `src/lib/lock-copy.ts`)
 * plus the exit that matches `status.reason`:
 *   - `QUOTE_SENT`  → "Recall vN to edit" (primary, #1080/#1100 Phase 5 — opens
 *     `<RecallToEditDialog>`, a one-click confirm rather than a bare toast) +
 *     "Create quote v(N+1)" (secondary, still available)
 *   - `STATUS`      → the existing unlock-session flow
 *   - session open  → `<UnlockSessionBanner>` (Save & relock / Discard, #988's
 *     diff-before-commit)
 */
export function ProjectLockStrip({ projectId, orgId, status, now, onOpenUnlock }: ProjectLockStripProps) {
  if (status.loading) return null;

  if (status.hasOpenSession && status.openSession && orgId) {
    return (
      <div id="lock-strip">
        <UnlockSessionBanner projectId={projectId} orgId={orgId} session={status.openSession} />
      </div>
    );
  }

  const copy = resolveLockCopy(status, now);
  const isOpenIdle = status.tier === "OPEN";
  const Icon = isOpenIdle ? LockOpen : Lock;
  const barClass = isOpenIdle
    ? "border-l-line bg-paper-2 text-fg-4"
    : cn(intentBorderClass(copy.intent), intentStyles[copy.intent].bg, intentStyles[copy.intent].text);

  return (
    <div
      id="lock-strip"
      className={cn("flex flex-wrap items-center justify-between gap-3 rounded-[var(--radius)] border-l-[3px] px-4 py-3 text-sm", barClass)}
    >
      <p className="flex min-w-0 items-center gap-2">
        <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        <span>
          <span className="font-semibold">{copy.headline}</span> — {copy.detail}
        </span>
      </p>

      {copy.exitLabel && status.reason === "QUOTE_SENT" && (
        <QuoteSentLockExit
          projectId={projectId}
          orgId={orgId}
          now={now}
          exitLabel={copy.exitLabel}
          liveRevision={status.liveRevision ?? status.revision ?? 1}
          nextVersion={(status.revision ?? 1) + 1}
        />
      )}

      {copy.exitLabel && status.reason !== "QUOTE_SENT" && status.tier === "HARD_LOCKED" && (
        <CanDo resource="project" action="update">
          <GatedButton
            variant="line"
            size="sm"
            gated={!status.canOverrideHardLock}
            reason="Only admins and this job's PM can open a full unlock."
            onClick={onOpenUnlock}
          >
            {copy.exitLabel}
          </GatedButton>
        </CanDo>
      )}

      {copy.exitLabel && status.reason !== "QUOTE_SENT" && status.tier === "FINANCE_LOCKED" && (
        <CanDo resource="project" action="update">
          <Button variant="line" size="sm" onClick={onOpenUnlock}>
            {copy.exitLabel}
          </Button>
        </CanDo>
      )}
    </div>
  );
}

/** The QUOTE_SENT exit cluster — split out purely to keep `ProjectLockStrip`'s
 *  own complexity/line count down (R-3.6). Owns the "Recall vN to edit" +
 *  "Create v(N+1)" actions and the `<RecallToEditDialog>` they open — the
 *  revision-state read and the new-version mutation only ever mount for this
 *  one reason, so they're scoped here rather than always registered on the
 *  strip regardless of `status.reason`. */
function QuoteSentLockExit({
  projectId,
  orgId,
  now,
  exitLabel,
  liveRevision,
  nextVersion,
}: {
  projectId: string;
  orgId: string | undefined;
  now: number;
  exitLabel: string;
  liveRevision: number;
  nextVersion: number;
}) {
  const [recallDialogOpen, setRecallDialogOpen] = useState(false);
  const quoteWrites = useQuoteWrites();
  const revisionState = useAuthedQuery(api.quotes.revisionStateForProject, orgId ? { orgId, projectId, now } : "skip");

  const newVersionMutation = useServerMutation({
    mutationFn: () => quoteWrites.newVersion(projectId),
    onSuccess: (r: { version: number }) => toast.success(`Started quote v${r.version} — open the Finance tab to send it`),
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <>
      <div className="flex items-center gap-2">
        {/* Primary affordance (design §2.7): "Recall vN to edit" alongside
            the existing "Create v(N+1)" — recalling keeps the version's own
            number rather than abandoning it to a fresh draft (decision 1). */}
        <CanDo resource="invoice" action="publish">
          <Button variant="line" size="sm" disabled={!revisionState?.liveQuote} onClick={() => setRecallDialogOpen(true)}>
            <Undo2 className="h-3.5 w-3.5" /> Recall v{revisionState?.liveQuote?.version ?? liveRevision} to edit
          </Button>
        </CanDo>
        <CanDo resource="invoice" action="publish">
          <Button variant="ghost" size="sm" loading={newVersionMutation.isPending} onClick={() => newVersionMutation.mutate(undefined)}>
            <FileText className="h-3.5 w-3.5" /> {exitLabel}
          </Button>
        </CanDo>
      </div>
      <RecallToEditDialog
        open={recallDialogOpen}
        onOpenChange={setRecallDialogOpen}
        liveQuote={revisionState?.liveQuote ?? null}
        nextVersion={nextVersion}
        onCreateNextVersion={() => newVersionMutation.mutate(undefined)}
        creatingNextVersion={newVersionMutation.isPending}
      />
    </>
  );
}
