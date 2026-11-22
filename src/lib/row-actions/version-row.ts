import { ArrowRightLeft, Copy, Eye, Pencil, Sparkles, Trash2 } from "lucide-react";

import type { ActionItem, ActionMenuSpec } from "@/lib/primitives/types";

/**
 * The Versions tab's row ⋯ (spec §7b.4): Open this version · Make vN live… ·
 * Compare with vN… · Rename… · Save a copy as new version… · Delete… (red,
 * last, never on the live row). One pure builder; an action that does not
 * apply is ABSENT, never disabled (principle 2). The caller resolves the
 * permissions (`canPublish` = the panel's own gate for Make live / copy /
 * delete; Rename stays open to anyone who can see the tab).
 */
export interface VersionRowTarget {
  number: number;
  isLive: boolean;
  contentState: "ready" | "missing";
}

export interface VersionRowContext {
  canPublish: boolean;
  /** This row is the one on screen (`?v=`, or live when none). */
  onScreen: boolean;
  /** The other side of a Compare: live for a draft row, the viewed or newest draft for the live row. `null` when there is only one version. */
  compareWith: number | null;
}

export interface VersionRowHandlers {
  open: () => void;
  makeLive: () => void;
  compare: () => void;
  rename: () => void;
  saveCopy: () => void;
  remove: () => void;
}

function writeVerbs(v: VersionRowTarget, ctx: VersionRowContext, h: VersionRowHandlers): ActionItem[] {
  if (!ctx.canPublish) return [];
  const verbs: ActionItem[] = [];
  if (!v.isLive && v.contentState === "ready") {
    verbs.push({ key: "make-live", label: `Make v${v.number} live…`, group: "organise", icon: Sparkles, onSelect: h.makeLive });
  }
  if (v.contentState === "ready") {
    verbs.push({ key: "save-copy", label: "Save a copy as new version…", group: "organise", icon: Copy, onSelect: h.saveCopy });
  }
  return verbs;
}

export function buildVersionRowActions(v: VersionRowTarget, ctx: VersionRowContext, h: VersionRowHandlers): ActionMenuSpec {
  const items: ActionItem[] = [];
  if (!ctx.onScreen) items.push({ key: "open", label: "Open this version", group: "organise", icon: Eye, onSelect: h.open });
  items.push(...writeVerbs(v, ctx, h));
  if (ctx.compareWith != null) {
    items.push({ key: "compare", label: `Compare with v${ctx.compareWith}…`, group: "organise", icon: ArrowRightLeft, onSelect: h.compare });
  }
  items.push({ key: "rename", label: "Rename…", group: "edit", icon: Pencil, onSelect: h.rename });
  if (ctx.canPublish && !v.isLive) {
    items.push({
      key: "delete",
      label: "Delete…",
      group: "danger",
      icon: Trash2,
      danger: true,
      onSelect: h.remove,
      confirm: {
        title: `Delete v${v.number}?`,
        body: `This permanently deletes v${v.number} and every line on it. The live version, invoices and the warehouse are not touched. This can't be undone.`,
        confirmLabel: "Delete version",
      },
    });
  }
  return { items };
}
