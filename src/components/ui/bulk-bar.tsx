"use client";

import * as React from "react";
import { createPortal } from "react-dom";
import { ChevronDown, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ActionMenu } from "@/components/ui/action-menu";
import { useIsMobile } from "@/hooks/use-mobile";
import { showError } from "@/lib/show-error";
import type { ActionMenuSpec, BulkAction, RowSelection } from "@/lib/primitives/types";
import { cn } from "@/lib/utils";

/**
 * `BulkBar` — the one bulk surface (spec §5.6, playbook §3.5). Evolved from
 * `BulkActionBar` (R-3.8); there is no second bar.
 *
 * Reads a `RowSelection` (only `count` + `clear` are needed, so a surface on
 * the older `useSelection` can adapt with `{ count, clear }`) and a
 * `BulkAction[]`: every verb's label carries the count (`Force return 3`),
 * danger verbs sort last, render red and — when they carry `confirm` — ask
 * first. ✕ clears.
 *
 * **Desktop:** inline in normal flow; the caller places it at the list footer.
 * **Mobile:** portaled to `<body>` and pinned above the bottom nav
 * (`position: fixed`); on a phone it replaces the sticky primary action.
 * The portal is load-bearing: an inline bar that exists only while something
 * is selected reflows the list on every tap, and a `fixed` element left in
 * place resolves against `<main>` (its page-enter animation leaves a
 * `transform`), not the viewport. Do not drop the portal.
 *
 * **Inside a modal Dialog, `inDialog`:** a Radix modal Dialog puts `pointer-events: none` on `<body>`, and a
 * portaled sibling inherits it (every click swallowed). So there the bar stays INSIDE `DialogContent`, sticky
 * to its bottom, on every breakpoint. The portal stays for everywhere else.
 */
export interface BulkBarProps {
  selection: Pick<RowSelection, "count" | "clear">;
  actions: BulkAction[];
  /** Noun for the selected rows: "line" → "3 lines selected". */
  noun?: string;
  /** Optional leading control (e.g. a select-all checkbox) kept from a surface. */
  leading?: React.ReactNode;
  className?: string;
  /** Render inside a modal Dialog's content (sticky, no portal) instead of the phone's body portal. */
  inDialog?: boolean;
}

/** Danger verbs last (stable otherwise). */
export function orderBulkActions(actions: BulkAction[]): BulkAction[] {
  return [...actions.filter((a) => !a.danger), ...actions.filter((a) => a.danger)];
}

/** Runs a verb; a rejection is surfaced as a toast, never an unhandled rejection. */
async function runSafely(action: BulkAction): Promise<void> {
  try {
    await action.onSelect();
  } catch (e) {
    showError(e);
  }
}

/** A verb's sub-items as an `ActionMenuSpec`, labels pre-computed with the count,
 *  so the one menu renderer (`ActionMenu`) draws it. */
function childSpec(children: BulkAction[], count: number): ActionMenuSpec {
  return {
    items: children.map((c) => ({
      key: c.key,
      label: c.label(count),
      group: c.group,
      danger: c.danger,
      confirm: c.confirm,
      onSelect: () => runSafely(c),
    })),
  };
}

function ConfirmDialog({
  action,
  count,
  onCancel,
}: {
  action: BulkAction | null;
  count: number;
  onCancel: () => void;
}) {
  const [busy, setBusy] = React.useState(false);
  const confirm = action?.confirm;
  const run = async () => {
    if (!action) return;
    setBusy(true);
    try {
      await runSafely(action);
    } finally {
      setBusy(false);
      onCancel();
    }
  };
  return (
    <Dialog open={!!action && !!confirm} onOpenChange={(o) => !o && onCancel()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{confirm?.title}</DialogTitle>
          <DialogDescription>{confirm?.body}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="line" onClick={onCancel}>
            Cancel
          </Button>
          <Button variant="primary" disabled={busy} onClick={run}>
            {confirm?.confirmLabel ?? action?.label(count)}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function verbClass(action: BulkAction) {
  return action.danger ? "text-red-text" : undefined;
}

function Verb({
  action,
  count,
  onRun,
}: {
  action: BulkAction;
  count: number;
  onRun: (a: BulkAction) => void;
}) {
  if (action.children?.length) {
    return (
      <ActionMenu
        spec={childSpec(action.children, count)}
        label={action.label(count)}
        trigger={
          <Button size="sm" variant="line" className={verbClass(action)}>
            {action.label(count)}
            <ChevronDown className="h-3 w-3" />
          </Button>
        }
      />
    );
  }
  return (
    <Button size="sm" variant="line" className={verbClass(action)} onClick={() => onRun(action)}>
      {action.icon ? <action.icon className="mr-1 h-3 w-3" /> : null}
      {action.label(count)}
    </Button>
  );
}

export function BulkBar({ selection, actions, noun = "item", leading, className, inDialog = false }: BulkBarProps) {
  const isMobile = useIsMobile() && !inDialog;
  const [pending, setPending] = React.useState<BulkAction | null>(null);
  const { count } = selection;
  if (count <= 0) return null;

  const run = (a: BulkAction) => {
    if (a.confirm) setPending(a);
    else void runSafely(a);
  };

  const bar = (
    <div
      className={cn(
        "flex flex-wrap items-center gap-3 rounded-[var(--r)] border-2 border-line-2 px-4 py-2",
        // Opaque + raised when floating on mobile so scrolling content doesn't bleed through.
        isMobile ? "bg-elev shadow-[var(--sh-card)]" : "bg-paper-2/50",
        inDialog && "sticky bottom-0 bg-elev",
        className,
      )}
      role="toolbar"
      aria-label="Bulk actions"
    >
      <span className="text-ui-text font-medium text-ink tabular-nums">
        {count} {noun}
        {count === 1 ? "" : "s"} selected
      </span>
      {leading}
      {orderBulkActions(actions).map((a) => (
        <Verb key={a.key} action={a} count={count} onRun={run} />
      ))}
      <Button
        size="icon"
        variant="ghost"
        className="ml-auto"
        aria-label="Clear selection"
        onClick={selection.clear}
      >
        <X className="h-4 w-4" />
      </Button>
      <ConfirmDialog action={pending} count={count} onCancel={() => setPending(null)} />
    </div>
  );

  if (isMobile) return <PinnedAboveBottomNav>{bar}</PinnedAboveBottomNav>;
  return bar;
}

/**
 * The phone dock: portaled to `<body>` and pinned above the bottom nav (see the BulkBar note on why the
 * portal is load-bearing). Shared by `BulkBar` and the warehouse job's sticky action bar so the two can
 * never disagree about where "above the nav" is.
 */
export function PinnedAboveBottomNav({ children }: { children: React.ReactNode }) {
  if (typeof document === "undefined") return <>{children}</>;
  // env() lives in an inline style, not a Tailwind arbitrary value (project convention).
  return createPortal(
    <div
      className="fixed inset-x-2 z-40"
      style={{ bottom: "calc(3.5rem + env(safe-area-inset-bottom, 0px) + 0.5rem)" }}
    >
      {children}
    </div>,
    document.body,
  );
}
