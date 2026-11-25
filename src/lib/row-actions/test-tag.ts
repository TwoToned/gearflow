import { ExternalLink, FileText, RefreshCw, RotateCcw, Zap } from "lucide-react";

import type { ActionItem, ActionMenuSpec } from "@/lib/primitives/types";

/**
 * Test and tag list verbs (UX Phase 14, 14a-3). An omitted handler means the caller cannot do it, so the item
 * is ABSENT, never disabled. `Reactivate` appears only on a retired item and has the existing exact Undo.
 * Retire / Edit / Schedule… / Print tags arrive with the record page (14b-4): retire has no exact reverse yet.
 */
export interface TestTagActionCtx {
  onOpen: () => void;
  /** Absent when the caller cannot record a test. */
  onQuickTest?: () => void;
  /** Present only for a retired item. */
  onReactivate?: () => void;
}

type Entry = ActionItem | false | undefined | null;

export function buildTestTagActions(ctx: TestTagActionCtx): ActionMenuSpec {
  const entries: Entry[] = [
    { key: "open", label: "Open", group: "edit", icon: ExternalLink, onSelect: ctx.onOpen },
    ctx.onQuickTest && { key: "quick-test", label: "Quick test", group: "organise", icon: Zap, onSelect: ctx.onQuickTest },
    ctx.onReactivate && { key: "reactivate", label: "Reactivate", group: "organise", icon: RotateCcw, onSelect: ctx.onReactivate },
  ];
  return { items: entries.filter((e): e is ActionItem => !!e) };
}

/** The page ⋯ words: Sync from assets, Quick test, Reports (the reports page until it moves into a dialog). */
export function buildTestTagPageMenu(ctx: { onSync?: () => void; onQuickTest?: () => void; onReports: () => void }): ActionMenuSpec {
  const entries: Entry[] = [
    ctx.onSync && { key: "sync", label: "Sync from assets", group: "organise", icon: RefreshCw, onSelect: ctx.onSync },
    ctx.onQuickTest && { key: "quick-test", label: "Quick test", group: "organise", icon: Zap, onSelect: ctx.onQuickTest },
    { key: "reports", label: "Reports…", group: "documents", icon: FileText, onSelect: ctx.onReports },
  ];
  return { items: entries.filter((e): e is ActionItem => !!e) };
}
