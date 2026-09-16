"use client";

import { GitBranch, Lock, LockOpen, ArrowLeft, Sparkles } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { GatedButton } from "@/components/ui/gated-button";
import { CanDo } from "@/components/auth/permission-gate";
import { useServerMutation } from "@/hooks/use-server-mutation";
import { resolveLockCopy, type LockCopyStatus } from "@/lib/lock-copy";
import { intentStyles, intentBorderClass } from "@/lib/status-colors";
import { cn } from "@/lib/utils";
import type { ProjectVersionSummary } from "@/components/projects/project-version-context";

/**
 * Project Versioning v2, Phase 5 (#1231, parent #1221, design §5.2) — the
 * ONE status strip, fed by ONE query, replacing `ProjectLockStrip` +
 * `VersionReadOnlyBar` + `UnlockSessionBanner` + `QuoteDriftIndicator`
 * (four stacked components, three queries, pre-#1230/#1231). Mounted once
 * above the tabs.
 *
 * Three states (justify + hard-lock are gone, so there's no fourth tier to
 * render):
 *
 * 1. **Absent** — live, unlocked, nothing to say. Editing reads as normal
 *    with no chrome at all.
 * 2. **Viewing a non-live version** — info strip: this version is fully
 *    editable (§5's principle 3), it just isn't the one warehouse/
 *    availability/invoices follow. Offers "Make vN live" and "Back to live".
 * 3. **Live, pricing locked** — the ONLY lock state left (§4 of FEATUREDOCS/76
 *    collapsed the old 4-tier system into one boolean). Carries the single
 *    "Unlock pricing" action (`unlockPricingNative`, `danger: "high"`,
 *    called directly via Convex mutation — no HTTP dispatcher involved, so
 *    no `confirm` plumbing needed here; the one click IS the confirmation).
 *
 * State (2) takes priority over state (3): `pricingLocked` describes the
 * LIVE version's money fields only (FEATUREDOCS/76's truth table) — while
 * viewing a non-live version that flag says nothing about what's on screen.
 *
 * Drift ("this job no longer matches the sent quote") state D was a DEFERRED
 * follow-up in Phase 5 — #1233 (Phase 6) closes the DETECTION half: state 2's
 * strip now appends a plain-text drift line (`quoteDrift` prop, sourced from
 * `versionsRead.quoteDriftForVersion` via `useProjectVersion().viewingQuoteDrift`)
 * when the viewed version's current total has moved since its own quote was
 * sent. Deliberately NOT a click target — full Compare-mode wiring (line-by-
 * line, side-by-side) is #1232, a separate, not-yet-built phase; this is the
 * numeric signal only. `overview/quote-card.tsx`'s inline drift note (the
 * LIVE version's own `projectSnapshots`-based line-item diff) is a DIFFERENT,
 * older mechanism, unaffected by this. The "unlocked by a person, re-lock"
 * notice (state E) remains deferred.
 */

interface VersionStripLockStatus extends LockCopyStatus {
  loading: boolean;
  canUnlockPricing: boolean;
}

/** #1233 (Phase 6) — the drift DETECTION signal (`versionsRead.quoteDriftForVersion`),
 *  a numeric compare only. No click target: Compare mode (#1232) doesn't exist
 *  yet, and this strip must not link to a UI that isn't built. */
export interface VersionStripQuoteDrift {
  quoteLabel: string;
  driftAmount: number;
}

interface VersionStripProps {
  isTemplate: boolean;
  isViewingVersion: boolean;
  viewingVersion: ProjectVersionSummary | null;
  liveVersion: ProjectVersionSummary | null;
  onMakeLive: () => void;
  onBackToLive: () => void;
  lockStatus: VersionStripLockStatus;
  onUnlock: () => Promise<void>;
  /** Optional — omitted or `null` renders no drift line at all (no signal,
   *  or the viewed version has never had a quote sent). */
  quoteDrift?: VersionStripQuoteDrift | null;
}

/** Plain currency text, no `Intl` locale plumbing threaded through this far —
 *  matches the sign convention `describeDrift` (`src/lib/quote-drift.ts`)
 *  already uses elsewhere on this page ("+$1,240" / "-$1,240"). */
function formatDriftAmount(amount: number): string {
  const abs = Math.abs(amount).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `${amount >= 0 ? "+" : "-"}$${abs}`;
}

function NonLiveVersionStrip({
  viewingVersion,
  liveVersion,
  onMakeLive,
  onBackToLive,
  quoteDrift,
}: {
  viewingVersion: ProjectVersionSummary;
  liveVersion: ProjectVersionSummary | null;
  onMakeLive: () => void;
  onBackToLive: () => void;
  quoteDrift?: VersionStripQuoteDrift | null;
}) {
  return (
    <div
      id="version-strip"
      className={cn(
        "flex flex-wrap items-center justify-between gap-3 rounded-[var(--radius)] border-l-[3px] px-4 py-3 text-sm",
        intentBorderClass("info"),
        intentStyles.info.bg,
        intentStyles.info.text,
      )}
    >
      <p className="flex min-w-0 items-center gap-2">
        <GitBranch className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        <span>
          <span className="font-semibold">
            v{viewingVersion.number}
            {viewingVersion.label ? ` · ${viewingVersion.label}` : ""}
          </span>{" "}
          — a draft version, fully editable. Not live: the warehouse, availability and invoices follow
          {liveVersion ? ` v${liveVersion.number}` : " the live version"}.
          {/* #1233 — drift is a plain text tail, never a link: Compare mode
              (#1232) that would make sense to open here doesn't exist yet. */}
          {quoteDrift && quoteDrift.driftAmount !== 0 && (
            <>
              {" "}
              Quote total has moved {formatDriftAmount(quoteDrift.driftAmount)} since {quoteDrift.quoteLabel} was sent.
            </>
          )}
        </span>
      </p>
      <div className="flex shrink-0 items-center gap-2">
        <CanDo resource="project" action="update">
          <Button type="button" variant="primary" size="sm" onClick={onMakeLive}>
            <Sparkles className="h-3.5 w-3.5" /> Make v{viewingVersion.number} live
          </Button>
        </CanDo>
        <Button type="button" variant="ghost" size="sm" onClick={onBackToLive}>
          <ArrowLeft className="h-3.5 w-3.5" />
          Back to live{liveVersion ? ` (v${liveVersion.number})` : ""}
        </Button>
      </div>
    </div>
  );
}

function LockedLiveStrip({ lockStatus, onUnlock }: { lockStatus: VersionStripLockStatus; onUnlock: () => Promise<void> }) {
  const unlockMutation = useServerMutation({
    mutationFn: onUnlock,
    onSuccess: () => toast.success("Pricing unlocked"),
    onError: (e: Error) => toast.error(e.message),
  });

  const copy = resolveLockCopy(lockStatus);
  const barClass = cn(intentBorderClass(copy.intent), intentStyles[copy.intent].bg, intentStyles[copy.intent].text);

  return (
    <div
      id="version-strip"
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
          gated={!lockStatus.canUnlockPricing}
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

export function VersionStrip({
  isTemplate,
  isViewingVersion,
  viewingVersion,
  liveVersion,
  onMakeLive,
  onBackToLive,
  lockStatus,
  onUnlock,
  quoteDrift,
}: VersionStripProps) {
  if (isTemplate || lockStatus.loading) return null;

  // State 2 — viewing a non-live version. Takes priority over the lock state
  // (which describes the LIVE version's money fields only).
  if (isViewingVersion && viewingVersion) {
    return (
      <NonLiveVersionStrip
        viewingVersion={viewingVersion}
        liveVersion={liveVersion}
        onMakeLive={onMakeLive}
        onBackToLive={onBackToLive}
        quoteDrift={quoteDrift}
      />
    );
  }

  // State 3 — live, pricing locked.
  if (lockStatus.pricingLocked) {
    return <LockedLiveStrip lockStatus={lockStatus} onUnlock={onUnlock} />;
  }

  // State 1 — absent. Live + unlocked reads as "editing normally".
  return null;
}
