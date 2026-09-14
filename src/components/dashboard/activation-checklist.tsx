"use client";

import { useState } from "react";
import Link from "next/link";
import { Check } from "lucide-react";
import { useActivationMilestones, useActivationMilestoneAnalytics } from "@/hooks/use-activation-milestones";
import { useActivationDismissal } from "@/hooks/use-activation-dismissal";
import { MILESTONE_ORDER, milestoneDone, type ActivationMilestonesState, type MilestoneKey } from "@/lib/activation-milestones";
import { capture, AnalyticsEvent } from "@/lib/analytics";
import { cn, focusRing } from "@/lib/utils";

interface MilestoneItem {
  key: MilestoneKey;
  label: string;
  cta: string;
  href: string;
  done: boolean;
  /** Shown on a done row instead of the tick alone — e.g. the model's actual
   *  name, so the row reads as a real fact rather than a generic checkbox. */
  meta?: string;
}

const CARD = "rounded-[var(--r-lg)] border border-line bg-card shadow-[var(--sh-card)]";

const LABELS: Record<MilestoneKey, { label: string; cta: string }> = {
  model: { label: "Add a piece of gear you own", cta: "Add a model" },
  asset: { label: "Add a real unit of it", cta: "Add an asset" },
  project: { label: "Create your first job", cta: "Create a project" },
  lineItem: { label: "Put that gear on the job", cta: "Add it to the job" },
};

function hrefFor(key: MilestoneKey, state: ActivationMilestonesState): string {
  switch (key) {
    case "model":
      return "/assets/models/new";
    case "asset":
      return state.firstModelId ? `/assets/registry/new?modelId=${state.firstModelId}` : "/assets/models/new";
    case "project":
      return "/projects/new";
    case "lineItem":
      return state.firstProjectId ? `/projects/${state.firstProjectId}?tab=equipment` : "/projects/new";
  }
}

function metaFor(key: MilestoneKey, state: ActivationMilestonesState): string | undefined {
  if (key === "model") return state.firstModelName ?? undefined;
  if (key === "project") return state.firstProjectName ?? undefined;
  return undefined;
}

/** Every item is computed live from the org's actual models/assets/projects/
 *  line items — nothing here tracks "step N done" (D1, #1105; same R-3.1
 *  derivation rule as the setup checklist beside it). A user who adds five
 *  models by hand without ever opening this card finds it already ticked.
 *  `milestoneDone`/`MILESTONE_ORDER` are shared with the D2 (#1106)
 *  helper-rail coaching (`src/lib/activation-milestones.ts`) — one
 *  definition of "which milestone, in what order". */
function buildItems(state: ActivationMilestonesState): MilestoneItem[] {
  return MILESTONE_ORDER.map((key) => {
    const done = milestoneDone(state, key);
    return {
      key,
      ...LABELS[key],
      href: hrefFor(key, state),
      done,
      meta: done ? metaFor(key, state) : undefined,
    };
  });
}

/**
 * Dashboard "Get started" activation card (D1, #1105) — the tour that keeps
 * up when someone ignores it. Every milestone is derived live from real org
 * state (`useActivationMilestones`); the only persisted bit is the dismissal
 * (`useActivationDismissal`, its own Convex table — see the schema comment
 * on `orgActivationDismissals`). Lives BESIDE the setup checklist (#1104),
 * never merged with it — setup is "configure the company", activation is
 * "do the work". Disappears for good once dismissed OR all four are done.
 */
export function ActivationChecklist({ orgId }: { orgId: string | undefined }) {
  const state = useActivationMilestones(orgId);
  const { dismissedAt, dismiss } = useActivationDismissal();
  const [dismissing, setDismissing] = useState(false);
  // D4 (#1108) — keeps observing milestone state (and reporting new
  // completions) even past the early returns below, since this hook call
  // itself is unconditional.
  useActivationMilestoneAnalytics(orgId);

  if (state === undefined || dismissedAt === undefined || dismissedAt != null) return null;

  const items = buildItems(state);
  const doneCount = items.filter((i) => i.done).length;
  const complete = doneCount === items.length;
  if (complete) return null;
  const activeKey: MilestoneKey | undefined = items.find((i) => !i.done)?.key;

  return (
    <div className={cn(CARD, "flex flex-col gap-3 p-5")}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="t-overline text-muted">Get started</h2>
          <p className="text-xs text-fg-3">About 5 minutes. Pick up wherever you left off.</p>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs font-mono text-fg-3">
            {doneCount} / {items.length}
          </span>
          <button
            type="button"
            disabled={dismissing}
            onClick={async () => {
              setDismissing(true);
              try {
                capture(AnalyticsEvent.ActivationChecklistDismissed, { milestones_done: doneCount });
                await dismiss();
              } finally {
                setDismissing(false);
              }
            }}
            className={cn("text-xs text-muted hover:text-ink disabled:opacity-50", focusRing)}
          >
            Dismiss
          </button>
        </div>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-line-2">
        <div
          className="h-full rounded-full bg-red transition-all"
          style={{ width: `${(doneCount / items.length) * 100}%` }}
        />
      </div>
      <ul className="space-y-2">
        {items.map((item) => (
          <MilestoneRow key={item.key} item={item} active={item.key === activeKey} />
        ))}
      </ul>
    </div>
  );
}

function MilestoneRow({ item, active }: { item: MilestoneItem; active: boolean }) {
  return (
    <li className="flex items-center justify-between gap-2 text-sm">
      <span className="flex items-center gap-2">
        <span
          className={cn(
            "flex h-5 w-5 flex-none items-center justify-center rounded-full border-2",
            item.done ? "border-ok bg-ok/10 text-ok" : "border-line-2 text-transparent",
          )}
        >
          <Check className="h-3 w-3" aria-hidden />
        </span>
        <span className={item.done ? "text-fg-3 line-through" : "text-ink"}>{item.label}</span>
        {item.done && item.meta && <span className="font-mono text-xs text-fg-3">{item.meta}</span>}
      </span>
      {active && (
        <Link
          href={item.href}
          className={cn(
            "rounded-[var(--r-sm)] bg-red px-2.5 py-1 text-xs font-medium text-white hover:bg-red/90",
            focusRing,
          )}
        >
          {item.cta}
        </Link>
      )}
    </li>
  );
}
