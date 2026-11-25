import { Boxes, ExternalLink, Handshake, PackagePlus } from "lucide-react";

import type { ActionItem, ActionMenuSpec } from "@/lib/primitives/types";

/**
 * Overbookings list verbs (UX Phase 14, 14a-4). An omitted handler means the caller cannot (or the row cannot),
 * so the item is ABSENT, never disabled: a crew row never offers Sub-hire, only a hard gear row does, and only a
 * sale-stock row offers Reorder. Every verb here only navigates or opens the existing prefilled sub-hire dialog,
 * so none has an Undo to offer: the cover itself is written on the job's Equipment tab.
 */
export interface OverbookingActionCtx {
  /** The jobs this row involves: one `Open job` each (a single job reads `Open job`). */
  jobs: { id: string; projectNumber: string }[];
  onOpenJob: (projectId: string) => void;
  onOpenModel?: () => void;
  /** Present only for a hard gear row. */
  onSubHire?: () => void;
  /** Present only for a sale-stock row: opens Sales stock filtered to the model. */
  onReorder?: () => void;
}

type Entry = ActionItem | false | undefined | null;

export function buildOverbookingActions(ctx: OverbookingActionCtx): ActionMenuSpec {
  const many = ctx.jobs.length > 1;
  const jobItems: ActionItem[] = ctx.jobs.map((j) => ({
    key: `open-${j.id}`,
    label: many ? `Open ${j.projectNumber}` : "Open job",
    group: "edit",
    icon: ExternalLink,
    onSelect: () => ctx.onOpenJob(j.id),
  }));
  const entries: Entry[] = [
    ...jobItems,
    ctx.onOpenModel && { key: "open-model", label: "Open model", group: "edit", icon: Boxes, onSelect: ctx.onOpenModel },
    ctx.onSubHire && { key: "sub-hire", label: "Sub-hire…", group: "organise", icon: Handshake, onSelect: ctx.onSubHire },
    ctx.onReorder && { key: "reorder", label: "Reorder", group: "organise", icon: PackagePlus, onSelect: ctx.onReorder },
  ];
  return { items: entries.filter((e): e is ActionItem => !!e) };
}
