import type { ColorIntent } from "@/lib/status-colors";

/**
 * #1230 pricing-lock copy — the SHRUNKEN successor to #990's `LockCopy`
 * (which rendered from the old 4-tier `LockTier`). One module so the lock
 * surfaces (header chip, lock strip, `<LockedField>` tooltip, gated-action
 * tooltip, list/board glyph tooltip) can't drift into subtly different
 * wording (POLICY.md R-3.1). Formula (unchanged from #990):
 *
 *   [state] — [consequence]. [the exit].
 *
 * Every surface renders a subset of the same `LockCopy` object rather than
 * re-deriving its own sentence.
 */

export interface LockCopyStatus {
  pricingLocked: boolean;
  pricingLockedAt?: number;
  pricingLockedByName?: string;
}

export interface LockCopy {
  /** `status-colors.ts` intent — the ONE thing every surface colours by. */
  intent: ColorIntent;
  /** The `[state]` clause, e.g. "Pricing locked". */
  headline: string;
  /** The `[consequence]` clause, e.g. "a quote has been sent." */
  detail: string;
  /** The `[the exit]` clause as a short CTA label, or null when unlocked
   *  (nothing to exit). */
  exitLabel: string | null;
  /** Short label for the always-mounted header chip. Null means "don't render
   *  a chip" — unlocked already reads as "editing normally". */
  chipLabel: string | null;
  /** One-line `[state] — [consequence]` sentence for banner-style surfaces. */
  oneLiner: string;
}

/** `elapsed()` uses `now` as an explicit input (never `Date.now()` inline) so
 *  callers stay reactive/testable. */
export function formatLockElapsed(lockedAt: number, now: number): string {
  const diffMs = Math.max(0, now - lockedAt);
  const diffDays = Math.floor(diffMs / 86_400_000);

  const lockedDate = new Date(lockedAt);
  const nowDate = new Date(now);
  const sameDay =
    lockedDate.getFullYear() === nowDate.getFullYear() &&
    lockedDate.getMonth() === nowDate.getMonth() &&
    lockedDate.getDate() === nowDate.getDate();

  if (sameDay) return "today";
  if (diffDays <= 1) return "yesterday";
  if (diffDays < 7) return `${diffDays}d ago`;
  return lockedDate.toLocaleDateString();
}

/** The locked headline; also the job header lock glyph's accessible name. */
const LOCKED_HEADLINE = "Pricing locked";

/** The one "go do something about it" action every gated field/button offers
 *  when it doesn't own an unlock affordance itself. "Unlock pricing" lives in
 *  the job header's lock glyph menu (UX Phase 7, §6b; the old lock strip and
 *  its `#lock-strip` anchor are gone, and that anchor no longer existed
 *  before then either). Any deeper surface scrolls the header
 *  (`#job-header`) into view and focuses the glyph, so Enter opens its menu.
 *  The name is kept for its callers. */
export function scrollToLockStrip(): void {
  const header = document.getElementById("job-header");
  header?.scrollIntoView({ behavior: "smooth", block: "start" });
  header?.querySelector<HTMLElement>(`button[aria-label="${LOCKED_HEADLINE}"]`)?.focus({ preventScroll: true });
}

export function resolveLockCopy(status: LockCopyStatus): LockCopy {
  if (!status.pricingLocked) {
    return {
      intent: "neutral",
      headline: "Pricing open",
      detail: "Editing normally.",
      exitLabel: null,
      chipLabel: null,
      oneLiner: "Pricing open — editing normally.",
    };
  }

  const who = status.pricingLockedByName ? ` by ${status.pricingLockedByName}` : "";
  const when = status.pricingLockedAt != null ? ` (${formatLockElapsed(status.pricingLockedAt, Date.now())})` : "";
  const detail = `A quote has been sent or this job is confirmed${who}${when}.`;
  return {
    intent: "warning",
    headline: LOCKED_HEADLINE,
    detail,
    exitLabel: "Unlock pricing",
    chipLabel: LOCKED_HEADLINE,
    oneLiner: `Pricing locked — ${detail} Unlock pricing to edit money fields.`,
  };
}
