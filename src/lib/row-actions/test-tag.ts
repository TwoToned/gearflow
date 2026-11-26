import { Archive, CalendarPlus, ExternalLink, FileDown, FileText, Printer, RefreshCw, RotateCcw, Trash2, Zap } from "lucide-react";

import type { ActionItem, ActionMenuSpec, BulkAction } from "@/lib/primitives/types";

/**
 * Test and tag list verbs (UX Phase 14, 14a-3). An omitted handler means the caller cannot do it, so the item
 * is ABSENT, never disabled. `Reactivate` appears only on a retired item and has the existing exact Undo.
 * The record page (14b-4) adds Edit, Retire (now with an exact Undo) and Delete; 14a-3b adds Schedule…, Export report and
 * the bulk Print tags.
 */
export interface TestTagActionCtx {
  onOpen: () => void;
  /** Absent when the caller cannot record a test. */
  onQuickTest?: () => void;
  /** Present only for a retired item. */
  onReactivate?: () => void;
  /** Absent without `maintenance:create`. */
  onSchedule?: () => void;
  /** Absent without `reports:view`: that item's history as a PDF. */
  onExportReport?: () => void;
}

type Entry = ActionItem | false | undefined | null;

export function buildTestTagActions(ctx: TestTagActionCtx): ActionMenuSpec {
  const entries: Entry[] = [
    { key: "open", label: "Open", group: "edit", icon: ExternalLink, onSelect: ctx.onOpen },
    ctx.onQuickTest && { key: "quick-test", label: "Quick test", group: "organise", icon: Zap, onSelect: ctx.onQuickTest },
    ctx.onReactivate && { key: "reactivate", label: "Reactivate", group: "organise", icon: RotateCcw, onSelect: ctx.onReactivate },
    ctx.onSchedule && { key: "schedule", label: "Schedule…", group: "organise", icon: CalendarPlus, onSelect: ctx.onSchedule },
    ctx.onExportReport && { key: "export-report", label: "Export report", group: "documents", icon: FileDown, onSelect: ctx.onExportReport },
  ];
  return { items: entries.filter((e): e is ActionItem => !!e) };
}

/** The selection's verbs: `Print tags` (a label per item) and `Schedule…`; each absent when the caller cannot. */
export function buildTestTagBulkActions(ctx: { onPrintTags?: () => void; onSchedule?: () => void }): BulkAction[] {
  const actions: (BulkAction | false | undefined)[] = [
    ctx.onPrintTags && { key: "print-tags", label: (n) => `Print tags (${n})`, group: "documents", icon: Printer, onSelect: ctx.onPrintTags },
    ctx.onSchedule && { key: "schedule", label: (n) => `Schedule ${n}…`, group: "organise", icon: CalendarPlus, onSelect: ctx.onSchedule },
  ];
  return actions.filter((a): a is BulkAction => !!a);
}

/** The page ⋯ words: Sync from assets, Quick test, Reports… (the dialog; absent without `reports:view`). */
export function buildTestTagPageMenu(ctx: { onSync?: () => void; onQuickTest?: () => void; onReports?: () => void }): ActionMenuSpec {
  const entries: Entry[] = [
    ctx.onSync && { key: "sync", label: "Sync from assets", group: "organise", icon: RefreshCw, onSelect: ctx.onSync },
    ctx.onQuickTest && { key: "quick-test", label: "Quick test", group: "organise", icon: Zap, onSelect: ctx.onQuickTest },
    ctx.onReports && { key: "reports", label: "Reports…", group: "documents", icon: FileText, onSelect: ctx.onReports },
  ];
  return { items: entries.filter((e): e is ActionItem => !!e) };
}

export interface TestTagRecordCtx {
  testTagId: string;
  retired: boolean;
  /** Present only when the item has a test to print a label for (the browser print dialog over the one label template). */
  onPrintLabel?: () => void;
  /** Each absent when the caller cannot (`testTag:update` for Retire / Reactivate, `testTag:delete` for Delete). */
  onRetire?: () => void;
  onReactivate?: () => void;
  onDelete?: () => void;
  /** Absent without `maintenance:create` or on a retired item. */
  onSchedule?: () => void;
  /** Absent without `reports:view`. */
  onExportReport?: () => void;
}

/**
 * The record page's ⋯ (UX Phase 14, 14b-4, D80): Print label (when there is a test to print), Retire (active items; its toast carries the exact Undo, so no confirm)
 * or Reactivate (retired ones), and Delete… ONLY for a retired item: red, last, with a confirm that names what goes with it.
 */
export function buildTestTagRecordActions(ctx: TestTagRecordCtx): ActionMenuSpec {
  const entries: Entry[] = [
    ctx.onPrintLabel && { key: "print-label", label: "Print label", group: "documents", icon: Printer, onSelect: ctx.onPrintLabel },
    ctx.onExportReport && { key: "export-report", label: "Export report", group: "documents", icon: FileDown, onSelect: ctx.onExportReport },
    !ctx.retired && ctx.onSchedule && { key: "schedule", label: "Schedule…", group: "organise", icon: CalendarPlus, onSelect: ctx.onSchedule },
    !ctx.retired && ctx.onRetire && { key: "retire", label: "Retire", group: "organise", icon: Archive, onSelect: ctx.onRetire },
    ctx.retired && ctx.onReactivate && { key: "reactivate", label: "Reactivate", group: "organise", icon: RotateCcw, onSelect: ctx.onReactivate },
    ctx.retired && ctx.onDelete && {
      key: "delete",
      label: "Delete…",
      group: "danger",
      icon: Trash2,
      danger: true,
      onSelect: ctx.onDelete,
      confirm: {
        title: `Delete ${ctx.testTagId}?`,
        body: "This permanently removes the item, every test recorded against it and their readings. The linked asset is not touched. This can't be undone.",
        confirmLabel: "Delete item",
      },
    },
  ];
  return { items: entries.filter((e): e is ActionItem => !!e) };
}
