"use client";

import { useState } from "react";
import Link from "next/link";
import { useFinishSetupState } from "@/components/dashboard/finish-setup-checklist";
import { useActivationState } from "@/components/dashboard/activation-checklist";
import { Skeleton } from "@/components/ui/skeleton";
import type { SetupPanelHalf, SetupPanelItem } from "@/components/dashboard/setup-panel-types";
import { HEADER_ACTION_TAP, WidgetAction, WidgetCount } from "@/components/dashboard/widget-chrome";
import { announceListWrite } from "@/lib/list-write-toast";
import { capture, AnalyticsEvent } from "@/lib/analytics";
import { showError } from "@/lib/show-error";
import { cn, focusRing } from "@/lib/utils";

/**
 * Whether the panel's slot renders (either half still has something to do, or
 * is still loading — the slot keeps its place so nothing shifts when it lands),
 * and its title: "Finish setup" while the setup half shows, else "Get started".
 * `orgId: undefined` (no setup kind on the board) skips every read.
 */
export function useSetupPanelState(orgId: string | undefined): { visible: boolean; loading: boolean; title: string } {
  const setup = useFinishSetupState(orgId);
  const activation = useActivationState(orgId);
  return {
    visible: setup.visible || activation.visible,
    loading: setup.loading || activation.loading,
    title: setup.visible || setup.loading ? "Finish setup" : "Get started",
  };
}

/** The slot's reserved height while its reads land (about one progress line and two rows). */
function SetupPanelLoading() {
  return (
    <div className="space-y-2" aria-busy="true" aria-label="Loading the setup panel">
      <Skeleton className="h-[3px] w-full max-w-[360px]" />
      <Skeleton className="h-9 w-full" />
      <Skeleton className="h-9 w-full" />
    </div>
  );
}

/**
 * Dismiss both visible halves at once, with ONE Undo closure that reverses
 * exactly the rows this click created (§6c.2: Dismiss now has Undo). A half
 * that was already dismissed returns null and is not touched by the Undo.
 */
async function dismissPanel(halves: SetupPanelHalf[], activation: SetupPanelHalf | null, activationDone: number): Promise<void> {
  // allSettled: one half failing must not lose the Undo for the half that DID dismiss.
  const settled = await Promise.allSettled(halves.map((h) => h.dismiss()));
  const created = halves.flatMap((h, i) => {
    const s = settled[i];
    return s.status === "fulfilled" && s.value ? [{ half: h, id: s.value }] : [];
  });
  const failed = settled.find((s): s is PromiseRejectedResult => s.status === "rejected");
  // Analytics only for a dismissal that happened.
  if (activation && created.some((c) => c.half === activation)) {
    capture(AnalyticsEvent.ActivationChecklistDismissed, { milestones_done: activationDone });
  }
  if (created.length > 0 || !failed) {
    announceListWrite({
      title: failed ? "Setup panel partly dismissed" : "Setup panel dismissed",
      undoneTitle: "Setup panel is back",
      performUndo: created.length
        ? async () => {
            await Promise.all(created.map((c) => c.half.undismiss(c.id)));
          }
        : undefined,
    });
  }
  if (failed) throw failed.reason;
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
        {item.done && item.meta && <span className="truncate font-mono text-[12px] text-muted">{item.meta}</span>}
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
  const [busy, setBusy] = useState(false);

  const halves = [setup, activation].filter((h) => h.visible);
  if (setup.loading || activation.loading) return <SetupPanelLoading />;
  if (halves.length === 0) return null;
  const items = halves.flatMap((h) => h.items);
  const done = items.filter((i) => i.done).length;

  const onDismiss = async () => {
    setBusy(true);
    try {
      await dismissPanel(halves, activation.visible ? activation : null, activation.doneCount);
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
          className={cn(HEADER_ACTION_TAP, "rounded-sm text-[12.5px] font-semibold text-muted hover:text-ink disabled:opacity-50", focusRing)}
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
