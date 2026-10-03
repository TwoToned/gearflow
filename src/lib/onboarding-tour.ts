import type { MilestoneKey } from "@/lib/activation-milestones";

/**
 * D2 (#1106) — helper-rail coaching copy for the four activation milestones
 * (D1, #1105). No tour library: this renders INTO each form's existing
 * sticky helper rail (the `asset-form.tsx`/`SmartFormLayout` pattern,
 * FEATUREDOCS/08), never a portalled overlay — see the issue body for why
 * (Radix modal `Dialog`'s `pointer-events: none` body lock + the
 * `OverlayLockReset` scar tissue this codebase already carries).
 *
 * `anchor` is a `data-tour-anchor` value that MUST exist on a real element in
 * the corresponding form — `onboarding-tour-anchors.test.ts` greps the
 * source tree for every anchor named here and fails if one goes missing, so
 * a moved/renamed field becomes a red test instead of a silently stale tour
 * (the issue's own "anti-rot" requirement). The milestones themselves never
 * need this kind of guard — they're derived from live data (D1) — only the
 * coaching copy's anchor is UI-coupled, and there are deliberately few of
 * them (one per form).
 */
export interface TourStep {
  anchor: string;
  eyebrow: string;
  tip: string;
}

export const TOUR_CONTENT: Record<MilestoneKey, TourStep> = {
  model: {
    anchor: "tour-model-name",
    eyebrow: "Get started",
    tip: "This is your first model — the spec sheet for something you rent, not a physical unit. Name it now; you'll add the real unit next.",
  },
  asset: {
    anchor: "tour-asset-model-field",
    eyebrow: "Get started",
    tip: "Models are the thing you rent. Assets are the physical units of it — pick the model you just made and this one inherits its details.",
  },
  project: {
    anchor: "tour-project-name",
    eyebrow: "Get started",
    tip: "One real job gets you the rest of the way there. Name it — everything else on this screen is optional for now.",
  },
  lineItem: {
    anchor: "tour-equipment-add",
    eyebrow: "Get started",
    tip: "Last step: use Add above to put the gear you just created onto this job.",
  },
};

/** Every anchor name the tour references — consumed by the anchor-integrity test. */
export const TOUR_ANCHOR_NAMES: readonly string[] = Object.values(TOUR_CONTENT).map((step) => step.anchor);
