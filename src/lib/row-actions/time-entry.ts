import { CheckCircle, Download, Pencil, Send, MessageSquareWarning, Trash2, UserRound } from "lucide-react";

import type { ActionItem, ActionMenuSpec, BulkAction } from "@/lib/primitives/types";
import {
  TIME_ENTRY_LOCKED_STATUS,
  canTransition,
  type TimeEntryTransition,
} from "../../../convex/lib/timeEntryTransitions";

/**
 * The timesheet row ⋯ and bulk bar (UX Phase 15, spec §9h.4). Which verb a
 * row offers comes from the ONE transition table the server gates on
 * (`convex/lib/timeEntryTransitions.ts`), so the menu never offers a verb the
 * write would skip. An omitted handler (no permission) or a verb that would
 * not change the row is ABSENT, never disabled. Exported rows are locked: no
 * menu at all (as live).
 */
export interface TimeEntryActionRow {
  /** `Ana Ruiz · Fri 7 Nov`, for the Delete confirm. */
  title: string;
  status: string;
}

export interface TimeEntryActionCtx {
  onEdit?: () => void;
  onSubmit?: () => void;
  onApprove?: () => void;
  /** Opens the Query… dialog (it asks for the reason itself). */
  onQuery?: () => void;
  onOpenPerson?: () => void;
  onDelete?: () => void;
}

type Entry = ActionItem | false | undefined | null;

const compact = (entries: Entry[]): ActionItem[] => entries.filter((e): e is ActionItem => !!e);

function verb(row: TimeEntryActionRow, t: TimeEntryTransition, handler: (() => void) | undefined, item: Omit<ActionItem, "onSelect">): Entry {
  return !!handler && canTransition(row.status, t) && { ...item, onSelect: handler };
}

/** The row's ⋯. Empty (no menu) for an Exported entry. */
export function buildTimeEntryActions(row: TimeEntryActionRow, ctx: TimeEntryActionCtx): ActionMenuSpec {
  if (row.status === TIME_ENTRY_LOCKED_STATUS) return { items: [] };
  return {
    items: compact([
      ctx.onEdit && { key: "edit", label: "Edit entry", group: "edit", icon: Pencil, kbd: "E", onSelect: ctx.onEdit },
      verb(row, "submit", ctx.onSubmit, { key: "submit", label: "Submit", group: "edit", icon: Send }),
      verb(row, "approve", ctx.onApprove, { key: "approve", label: "Approve", group: "edit", icon: CheckCircle }),
      verb(row, "query", ctx.onQuery, { key: "query", label: "Query…", group: "edit", icon: MessageSquareWarning }),
      ctx.onOpenPerson && { key: "person", label: "Open crew member", group: "organise", icon: UserRound, onSelect: ctx.onOpenPerson },
      ctx.onDelete && {
        key: "delete",
        label: "Delete entry",
        group: "danger",
        icon: Trash2,
        danger: true,
        onSelect: ctx.onDelete,
        confirm: {
          title: `Delete ${row.title}?`,
          body: "The hours leave the timesheet and the crew member's total. An approved entry stops counting toward pay. This cannot be undone.",
          confirmLabel: "Delete entry",
        },
      },
    ]),
  };
}

/** How many of the selected rows each verb would change. */
export function bulkEligibility(statuses: readonly string[]): Record<TimeEntryTransition, number> {
  const count = (t: TimeEntryTransition) => statuses.filter((s) => canTransition(s, t)).length;
  return { submit: count("submit"), approve: count("approve"), query: count("query") };
}

export interface TimeEntryBulkCtx {
  onApprove?: () => void;
  onSubmit?: () => void;
  onQuery?: () => void;
  onExport?: () => void;
}

/**
 * `Approve 4 · Submit 2 · Query… · Export` (§9h.4). Each label carries the
 * number of rows it would CHANGE (not the selection size); a verb that would
 * change none is absent. The write still gates every row and the toast names
 * what it skipped.
 */
export function buildTimeEntryBulkActions(statuses: readonly string[], ctx: TimeEntryBulkCtx): BulkAction[] {
  const n = bulkEligibility(statuses);
  const out: (BulkAction | false | undefined)[] = [
    !!ctx.onApprove && n.approve > 0 && { key: "approve", label: () => `Approve ${n.approve}`, group: "edit", icon: CheckCircle, onSelect: ctx.onApprove },
    !!ctx.onSubmit && n.submit > 0 && { key: "submit", label: () => `Submit ${n.submit}`, group: "edit", icon: Send, onSelect: ctx.onSubmit },
    !!ctx.onQuery && n.query > 0 && { key: "query", label: () => "Query…", group: "edit", icon: MessageSquareWarning, onSelect: ctx.onQuery },
    !!ctx.onExport && { key: "export", label: () => "Export", group: "reporting", icon: Download, onSelect: ctx.onExport },
  ];
  return out.filter((a): a is BulkAction => !!a);
}
