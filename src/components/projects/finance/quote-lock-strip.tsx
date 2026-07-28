"use client";

import { useState } from "react";
import { Lock, LockOpen } from "lucide-react";

import { useProjectLockStatus } from "@/hooks/use-project-lock";

interface QuoteLockStripProps {
  projectId: string;
  orgId: string | undefined;
}

/**
 * The Finance tab's lock strip (#989) — always mounted, always stating
 * something (finance-workflow-ux.md §7.2 "absence is not a state"). One
 * `useProjectLockStatus` subscription, which already carries `reason` (why the
 * tier is what it is — a bare status transition vs. a sent quote raising it,
 * #988) and `quoteState`/`revision` so this renders from a single query.
 *
 * The copy formula — `[state] — [consequence].` — is this surface's own
 * version of what finance-workflow-ux.md §7.1 specifies as a shared
 * `lock-copy.ts` module across six surfaces (header chip, field level, action
 * level, list/board glyphs, …). Those five other surfaces are Phase E (#990)
 * scope; this is the one Phase D needs, kept local until Phase E generalises
 * it rather than speculatively extracting a module with a single caller.
 */
export function QuoteLockStrip({ projectId, orgId }: QuoteLockStripProps) {
  const [now] = useState(() => Date.now());
  const status = useProjectLockStatus(projectId, orgId, now);

  if (status.loading) return null;

  if (status.hasOpenSession) {
    return (
      <LockLine icon="open" intentClass="border-l-red bg-red/10 text-red">
        Unlocked{status.openSession?.openedByName ? ` by ${status.openSession.openedByName}` : ""} — save & relock, or discard, when done.
      </LockLine>
    );
  }

  if (status.tier === "OPEN") {
    return (
      <LockLine icon="open" intentClass="border-l-line bg-paper-2 text-fg-4">
        Editing v{status.revision} (draft) — pricing is still open.
      </LockLine>
    );
  }

  if (status.tier === "HARD_LOCKED") {
    return (
      <LockLine icon="closed" intentClass="border-l-rep bg-rep-soft text-rep">
        Locked — this job is completed. Admins and its PM can open a full unlock.
      </LockLine>
    );
  }

  if (status.tier === "JUSTIFY") {
    return (
      <LockLine icon="closed" intentClass="border-l-warn bg-warn-soft text-warn">
        Changes need a reason — this job is on site.
      </LockLine>
    );
  }

  // FINANCE_LOCKED
  return (
    <LockLine icon="closed" intentClass="border-l-warn bg-warn-soft text-warn">
      {status.reason === "QUOTE_SENT"
        ? `Pricing locked — quote v${status.revision} is with the client. Create v${status.revision + 1} to change prices.`
        : "Pricing locked — this job is confirmed. Unlock financials to edit money."}
    </LockLine>
  );
}

function LockLine({ icon, intentClass, children }: { icon: "open" | "closed"; intentClass: string; children: React.ReactNode }) {
  const Icon = icon === "open" ? LockOpen : Lock;
  return (
    <div className={`flex items-center gap-2 rounded-[var(--radius)] border-l-[3px] px-3 py-2 text-sm ${intentClass}`}>
      <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      <span>{children}</span>
    </div>
  );
}
