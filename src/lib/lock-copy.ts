import type { ColorIntent } from "@/lib/status-colors";

/**
 * #990 (Phase E) shared lock copy — ONE module so the six lock surfaces (header
 * chip, lock strip, `<LockedField>` tooltip, gated-action tooltip, list/board
 * glyph tooltip, justify hint) can't drift into subtly different wording
 * (POLICY.md R-3.1). Formula (finance-workflow-ux.md §7.1):
 *
 *   [state] — [consequence]. [the exit].
 *
 * Every surface renders a subset of the same `LockCopy` object rather than
 * re-deriving its own sentence.
 */

type LockTier = "OPEN" | "FINANCE_LOCKED" | "JUSTIFY" | "HARD_LOCKED";
type LockReason = "STATUS" | "QUOTE_SENT";

export interface LockCopyOpenSession {
  scope: "FINANCIAL" | "FULL";
  justification: string;
  openedByName?: string;
  openedAt: number;
  /** The UNLOCK snapshot this session opened against — the diff target for
   *  `<SnapshotDiffSummary>` before Save & relock / Discard (#990). */
  snapshotId: string;
}

export interface LockCopyStatus {
  tier: LockTier;
  reason?: LockReason;
  /** The allocator — the highest version number ever handed out. Used for the
   *  "Create quote v(N+1)" exit, since that's what `newVersionNative` actually
   *  allocates off. */
  revision?: number;
  /** The version currently projected onto the live tables (#1080/#1085) — the
   *  one a QUOTE_SENT reason is actually describing. Absent ⇒ `revision`
   *  (every pre-#1085 project, where the two numbers were the same field). */
  liveRevision?: number;
  hasOpenSession?: boolean;
  openSession?: LockCopyOpenSession | null;
}

export interface LockCopy {
  /** `status-colors.ts` intent — the ONE thing every surface colours by. */
  intent: ColorIntent;
  /** The `[state]` clause, e.g. "Pricing locked". */
  headline: string;
  /** The `[consequence]` clause, e.g. "quote v2 is with the client." */
  detail: string;
  /** The `[the exit]` clause as a short CTA label, or null when there is no
   *  single-button exit (e.g. JUSTIFY — edits proceed inline, no session to open). */
  exitLabel: string | null;
  /** Short label for the always-mounted header chip. Null means "don't render
   *  a chip" — reserved for OPEN with no open session, since there is nothing
   *  to communicate (absence of a chip already reads as "editing normally"). */
  chipLabel: string | null;
  /** One-line `[state] — [consequence]` sentence for banner-style surfaces. */
  oneLiner: string;
}

/** `elapsed()` uses `now` as an explicit input (never `Date.now()` inline) so
 *  callers stay reactive/testable — same convention as `useProjectLockStatus`'s
 *  own `now` param. */
export function formatLockElapsed(openedAt: number, now: number): string {
  const diffMs = Math.max(0, now - openedAt);
  const diffMin = Math.floor(diffMs / 60_000);

  const openedDate = new Date(openedAt);
  const nowDate = new Date(now);
  const sameDay =
    openedDate.getFullYear() === nowDate.getFullYear() &&
    openedDate.getMonth() === nowDate.getMonth() &&
    openedDate.getDate() === nowDate.getDate();

  if (!sameDay) {
    const isYesterday = Math.floor(diffMs / 86_400_000) <= 1;
    const time = openedDate.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
    return isYesterday ? `since yesterday ${time}` : `since ${openedDate.toLocaleDateString()} ${time}`;
  }

  if (diffMin < 1) return "just now";
  if (diffMin < 60) return `${diffMin}m`;
  const hours = Math.floor(diffMin / 60);
  if (hours >= 3) return "3h+";
  const mins = diffMin % 60;
  return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
}

/** The single place tier → colour intent is decided (mirrors the choices
 *  `quote-lock-strip.tsx` shipped in Phase D — kept identical here rather than
 *  re-invented, then generalised out to every surface). */
function intentFor(status: LockCopyStatus): ColorIntent {
  if (status.hasOpenSession) return "primary"; // solid red — live/active, DESIGN.md §"Status Indicators"
  switch (status.tier) {
    case "HARD_LOCKED":
      return "neutral"; // a completed job is not a problem
    case "FINANCE_LOCKED":
    case "JUSTIFY":
      return "warning";
    case "OPEN":
    default:
      return "neutral";
  }
}

/** The one "go do something about it" action every gated field/button offers
 *  when it doesn't own an unlock affordance itself — the actual "Unlock
 *  financials" / "Create quote v(N+1)" buttons live in `<ProjectLockStrip>`,
 *  mounted once at `id="lock-strip"` outside every tab (#990 surface 2), so
 *  any deeper surface (a dialog buried in the Equipment or Crew tab) just
 *  scrolls there instead of duplicating the strip's own action wiring. */
export function scrollToLockStrip(): void {
  document.getElementById("lock-strip")?.scrollIntoView({ behavior: "smooth", block: "center" });
}

/** The "session open" branch — its own function purely to keep
 *  `resolveLockCopy`'s branch count under the R-3.6 ceiling (10). */
function sessionOpenCopy(intent: ColorIntent, session: LockCopyOpenSession, now: number): LockCopy {
  const { openedByName, openedAt, justification, scope } = session;
  const elapsed = formatLockElapsed(openedAt, now);
  const who = openedByName ? ` by ${openedByName}` : "";
  const headline = `${scope === "FULL" ? "Full unlock" : "Unlocked"}${who} · ${elapsed}`;
  const detail = `“${justification}”. Save & relock, or discard.`;
  return {
    intent,
    headline,
    detail,
    exitLabel: null,
    chipLabel: `Unlocked${who} · ${elapsed}`,
    oneLiner: `${headline} — ${detail}`,
  };
}

/** The FINANCE_LOCKED branch — split out for the same reason as `sessionOpenCopy`. */
function financeLockedCopy(intent: ColorIntent, status: LockCopyStatus, revision: number): LockCopy {
  if (status.reason === "QUOTE_SENT") {
    // The sentence is about the LIVE revision (the one actually with the
    // client) — "Create v(N+1)" still allocates off the counter (`revision`),
    // since that's what `newVersionNative` does regardless of which version
    // is live (#1080/#1100).
    const liveRevision = status.liveRevision ?? revision;
    const detail = `Quote v${liveRevision} is with the client.`;
    const exitLabel = `Create quote v${revision + 1}`;
    return {
      intent,
      headline: "Pricing locked",
      detail,
      exitLabel,
      chipLabel: "Pricing locked",
      oneLiner: `Pricing locked — ${detail} ${exitLabel} to change prices.`,
    };
  }
  return {
    intent,
    headline: "Pricing locked",
    detail: "This job is confirmed.",
    exitLabel: "Unlock financials",
    chipLabel: "Pricing locked",
    oneLiner: "Pricing locked — this job is confirmed. Unlock financials to edit money.",
  };
}

export function resolveLockCopy(status: LockCopyStatus, now: number): LockCopy {
  const intent = intentFor(status);
  const revision = status.revision ?? 1;

  if (status.hasOpenSession && status.openSession) {
    return sessionOpenCopy(intent, status.openSession, now);
  }

  switch (status.tier) {
    case "OPEN":
      return {
        intent,
        headline: `Editing v${revision} (draft)`,
        detail: "Pricing is still open.",
        exitLabel: null,
        chipLabel: null,
        oneLiner: `Editing v${revision} (draft) — pricing is still open.`,
      };
    case "FINANCE_LOCKED":
      return financeLockedCopy(intent, status, revision);
    case "JUSTIFY":
      return {
        intent,
        headline: "Changes need a reason",
        detail: "This job is on site. You'll be asked why.",
        exitLabel: null,
        chipLabel: "Locked",
        oneLiner: "Changes need a reason — this job is on site. You'll be asked why.",
      };
    case "HARD_LOCKED":
    default:
      return {
        intent,
        headline: "Locked",
        detail: "This job is completed.",
        exitLabel: "Open full unlock session",
        chipLabel: "Locked",
        oneLiner: "Locked — this job is completed. Admins and its PM can open a full unlock.",
      };
  }
}
