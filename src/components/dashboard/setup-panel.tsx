"use client";

import { useState } from "react";
import Link from "next/link";
import { useFinishSetupState } from "@/components/dashboard/finish-setup-checklist";
import { useActivationState } from "@/components/dashboard/activation-checklist";
import { useActivationMilestoneAnalytics } from "@/hooks/use-activation-milestones";
import type { SetupPanelHalf, SetupPanelItem } from "@/components/dashboard/setup-panel-types";
import { WidgetAction, WidgetCount } from "@/components/dashboard/widget-chrome";
import { announceListWrite } from "@/lib/list-write-toast";
import { capture, AnalyticsEvent } from "@/lib/analytics";
import { showError } from "@/lib/show-error";
import { cn, focusRing } from "@/lib/utils";

/** Either half still has something to do: the panel's slot renders. */
export function useSetupPanelVisible(orgId: string | undefined): boolean {
  const setup = useFinishSetupState(orgId);
  const activation = useActivationState(orgId);
  return setup.visible || activation.visible;
}

/**
 * Dismiss both visible halves at once, with ONE Undo closure that reverses
 * exactly the rows this click created (§6c.2: Dismiss now has Undo). A half
 * that was already dismissed returns null and is not touched by the Undo.
 */
async function dismissPanel(halves: SetupPanelHalf[], activationDone: number | null): Promise<void> {
  if (activationDone !== null) capture(AnalyticsEvent.ActivationChecklistDismissed, { milestones_done: activationDone });
  const ids = await Promise.all(halves.map((h) => h.dismiss()));
  const created = halves.flatMap((h, i) => (ids[i] ? [{ half: h, id: ids[i] as string }] : []));
  announceListWrite({
    title: "Setup panel dismissed",
    undoneTitle: "Setup panel is back",
    performUndo: created.length
      ? async () => {
          await Promise.all(created.map((c) => c.half.undismiss(c.id)));
        }
      : undefined,
  });
}

function SetupRow({ item }: { item: SetupPanelItem }) {
  return (
    <li className="break-inside-avoid">
      <Link
        href={item.href}
        className={cn("flex min-h-11 items-center gap-3 border-t border-line py-2 text-[13.5px]", focusRing, item.done ? "text-muted" : "text-ink")}
      >
        <span aria-hidden className={cn("size-2 shrink-0 rounded-full", item.done ? "bg-ok" : "bg-warn")} />
        <span className={cn("min-w-0 flex-1 truncate", item.done && "line-through")}>{item.label}</span>
        {item.done && item.meta && <span className="truncate font-mono text-[12px] text-faint">{item.meta}</span>}
        <span className="shrink-0 whitespace-nowrap text-[12.5px] text-muted">{item.done ? "done" : `${item.where} ›`}</span>
      </Link>
    </li>
  );
}

/**
 * Home's ONE setup panel (UX Phase 11, §6c.2): "Finish setup" (configure the
 * company) and "Get started" (do the first work) as one progress line and one
 * list of rows, each with a destination word. Both widget kinds stay in the
 * registry so saved boards load; the grid renders this in whichever of the two
 * slots comes first and drops the other, so it never shows twice.
 */
export function SetupPanel({ orgId }: { orgId: string | undefined }) {
  const setup = useFinishSetupState(orgId);
  const activation = useActivationState(orgId);
  // D4 (#1108): keeps reporting milestone completions while the panel is mounted.
  useActivationMilestoneAnalytics(orgId);
  const [busy, setBusy] = useState(false);

  const halves = [setup, activation].filter((h) => h.visible);
  if (halves.length === 0) return null;
  const items = halves.flatMap((h) => h.items);
  const done = items.filter((i) => i.done).length;

  const onDismiss = async () => {
    setBusy(true);
    try {
      await dismissPanel(halves, activation.visible ? activation.doneCount : null);
    } catch (e) {
      showError(e, { fallbackTitle: "Couldn't dismiss the setup panel" });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <WidgetCount>
        {done} of {items.length}
      </WidgetCount>
      <WidgetAction>
        <button
          type="button"
          disabled={busy}
          onClick={() => void onDismiss()}
          className={cn("rounded-sm text-[12.5px] font-semibold text-muted hover:text-ink disabled:opacity-50", focusRing)}
        >
          Dismiss
        </button>
      </WidgetAction>
      <div className="mb-2 flex max-w-[360px] gap-1" aria-label={`${done} of ${items.length} done`} role="img">
        {[...items]
          .sort((a, b) => Number(b.done) - Number(a.done))
          .map((i) => (
            <span key={i.key} className={cn("h-[3px] flex-1 rounded-sm", i.done ? "bg-ink-2" : "bg-line-2")} />
          ))}
      </div>
      <ul className="gap-x-8 sm:columns-2">
        {items.map((item) => (
          <SetupRow key={item.key} item={item} />
        ))}
      </ul>
    </div>
  );
}
