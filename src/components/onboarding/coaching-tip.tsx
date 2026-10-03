"use client";

import { usePersistentPref } from "@/hooks/use-persistent-pref";
import { useActiveMilestoneKey } from "@/hooks/use-activation-milestones";
import { TOUR_CONTENT } from "@/lib/onboarding-tour";
import type { MilestoneKey } from "@/lib/activation-milestones";
import { cn } from "@/lib/utils";

/**
 * D2 (#1106) — drop-in replacement for a form's normal helper-rail tip
 * block (`SmartFormRail`'s eyebrow+tip markup, reproduced here so this works
 * in both `SmartFormLayout`-based forms and the pre-migration inline-aside
 * ones like `asset-form.tsx`/`project-wizard.tsx`). Shows the milestone's
 * coaching copy ONLY while that milestone is the org's next not-yet-done one
 * (`useActiveMilestoneKey`, shared with the dashboard checklist, D1/#1105);
 * otherwise renders the form's own ordinary hint unchanged, so a returning
 * user who's long past onboarding sees nothing different.
 *
 * "Hide tips" is honest about its scope (the issue's own requirement): it
 * hides this coaching rail-wide, everywhere, and says so — it does NOT touch
 * the dashboard's "Get started" checklist (D1), which is a separate,
 * separately-dismissible card.
 */
export function CoachingTip({
  orgId,
  milestoneKey,
  fallbackEyebrow,
  fallbackTip,
  hideWhenInactive = false,
}: {
  orgId: string | undefined;
  milestoneKey: MilestoneKey;
  fallbackEyebrow: string;
  fallbackTip: string;
  /** Render nothing (instead of the fallback block) once coaching stops
   *  applying — for a call site that only exists FOR the coaching (the
   *  Equipment tab's "Tips" sidebar section, which has no ordinary hint of
   *  its own to fall back to). */
  hideWhenInactive?: boolean;
}) {
  const activeKey = useActiveMilestoneKey(orgId);
  const [hidden, setHidden] = usePersistentPref("onboarding-tips-hidden", false);
  const showCoaching = activeKey === milestoneKey && !hidden;

  if (!showCoaching) {
    if (hideWhenInactive) return null;
    return (
      <div>
        <p className="t-overline text-faint">{fallbackEyebrow}</p>
        <p className="mt-1 font-hand text-[15px] text-t-out">{fallbackTip}</p>
      </div>
    );
  }

  const step = TOUR_CONTENT[milestoneKey];
  return (
    <div>
      <p className="t-overline text-faint">{step.eyebrow}</p>
      <p className="mt-1 font-hand text-[15px] text-t-out">{step.tip}</p>
      <button
        type="button"
        onClick={() => setHidden(true)}
        className={cn("mt-1.5 text-[11px] text-faint underline-offset-2 hover:text-muted hover:underline")}
      >
        Hide tips (just this coaching — your &ldquo;Get started&rdquo; checklist stays put)
      </button>
    </div>
  );
}
