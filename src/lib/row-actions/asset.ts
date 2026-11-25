import { Archive, CalendarClock, Copy, ExternalLink, MapPin, Pencil, Printer, RotateCcw, ScanLine, Tag, Wrench } from "lucide-react";

import type { ActionItem, ActionMenuSpec, BulkAction } from "@/lib/primitives/types";

/** The facts about an asset the menu depends on. */
export interface AssetActionRow {
  title: string;
  /** Registry id (the Open and Edit links). */
  id: string;
  kind: "serialized" | "bulk";
  status?: string | null;
}

/**
 * Handlers: an omitted handler means the caller cannot do it, so the item is
 * ABSENT, never disabled. Every verb here has an existing write or route behind it.
 */
export interface AssetActionCtx {
  onOpen: () => void;
  onEdit?: () => void;
  onRetire?: () => void;
}

type Entry = ActionItem | false | undefined | null;
const compact = (entries: Entry[]): ActionItem[] => entries.filter((e): e is ActionItem => !!e);

/** Serialised assets can be retired (`assetWrites.archiveNative`); a bulk row has no such write yet. */
export function buildAssetActions(row: AssetActionRow, ctx: AssetActionCtx): ActionMenuSpec {
  const retirable = row.kind === "serialized" && row.status !== "RETIRED";
  return {
    items: compact([
      { key: "open", label: "Open", group: "edit", icon: ExternalLink, onSelect: ctx.onOpen },
      ctx.onEdit && { key: "edit", label: "Edit", group: "edit", icon: Pencil, kbd: "E", onSelect: ctx.onEdit },
      retirable &&
        ctx.onRetire && {
          key: "retire",
          label: "Retire",
          group: "danger",
          icon: Archive,
          danger: true,
          onSelect: ctx.onRetire,
          confirm: {
            title: `Retire ${row.title}?`,
            body: "The asset leaves the active registry and its test-and-tag schedule is retired. Its history is kept.",
            confirmLabel: "Retire",
          },
        },
    ]),
  };
}

// ─── The asset page's ⋯ (UX Phase 12, §9d.2) ──────────────────────────────

/** Every verb is a handler the caller may or may not have: omitted = ABSENT, never disabled. */
export interface AssetPageCtx {
  /** Camera / lookup (`Scan a tag…`, key `/`). */
  onScan?: () => void;
  onMove?: () => void;
  onScheduleService?: () => void;
  onReportIssue?: () => void;
  onPrintLabel?: () => void;
  onNewLike?: () => void;
  /** Present only for a deployed unit (Force return is meaningless otherwise, ruling Q-3). */
  onForceReturn?: () => void;
  /** Opens the Retire dialog (which holds Delete for a bare unit). */
  onRetire?: () => void;
  onReinstate?: () => void;
}

/**
 * The asset page's menu: Scan first, then the rest, `Retire…` last and red (its own
 * dialog names the downstream effects and holds Delete, so it carries no `confirm`).
 * A retired unit offers `Reinstate…` instead of Retire.
 */
export function buildAssetPageActions(row: { status?: string | null }, ctx: AssetPageCtx): ActionMenuSpec {
  const retired = row.status === "RETIRED";
  return {
    items: compact([
      ctx.onScan && { key: "scan", label: "Scan a tag…", group: "edit", icon: ScanLine, kbd: "/", onSelect: ctx.onScan },
      ctx.onMove && { key: "move", label: "Move to…", group: "organise", icon: MapPin, onSelect: ctx.onMove },
      ctx.onScheduleService && { key: "schedule", label: "Schedule service…", group: "organise", icon: CalendarClock, onSelect: ctx.onScheduleService },
      ctx.onNewLike && { key: "new-like", label: "New asset like this…", group: "organise", icon: Copy, kbd: "N", onSelect: ctx.onNewLike },
      ctx.onReportIssue && { key: "report", label: "Report issue…", group: "reporting", icon: Wrench, onSelect: ctx.onReportIssue },
      ctx.onPrintLabel && { key: "print", label: "Print label…", group: "documents", icon: Printer, onSelect: ctx.onPrintLabel },
      ctx.onForceReturn && row.status === "CHECKED_OUT" && { key: "force", label: "Force return…", group: "organise", icon: RotateCcw, onSelect: ctx.onForceReturn },
      !retired && ctx.onRetire && { key: "retire", label: "Retire…", group: "danger", icon: Archive, danger: true, onSelect: ctx.onRetire },
      retired && ctx.onReinstate && { key: "reinstate", label: "Reinstate…", group: "organise", icon: RotateCcw, onSelect: ctx.onReinstate },
    ]),
  };
}

// ─── Bulk ────────────────────────────────────────────────────────────────

export interface AssetBulkCtx {
  /** Opens the existing Bulk edit dialog (status, condition, location). */
  onEdit?: () => void;
  /** Opens the existing Add tags dialog. */
  onAddTag?: () => void;
  /** Present only when any selected asset is deployed. */
  forceReturnCount?: number;
  onForceReturn?: () => void;
  onRetire?: () => void;
}

/** Serialised-asset bulk verbs, each reusing an existing dialog or mutation. */
export function buildAssetBulkActions(ctx: AssetBulkCtx): BulkAction[] {
  const actions: (BulkAction | false | undefined)[] = [
    ctx.onEdit && { key: "edit", label: (n) => `Edit ${n}`, group: "edit", icon: Pencil, onSelect: ctx.onEdit },
    ctx.onAddTag && { key: "add-tag", label: (n) => `Add tag ${n}`, group: "organise", icon: Tag, onSelect: ctx.onAddTag },
    ctx.onForceReturn &&
      !!ctx.forceReturnCount && {
        key: "force-return",
        label: () => `Force return ${ctx.forceReturnCount}`,
        group: "organise",
        icon: RotateCcw,
        onSelect: ctx.onForceReturn,
      },
    ctx.onRetire && {
      key: "retire",
      label: (n) => `Retire ${n}`,
      group: "danger",
      icon: Archive,
      danger: true,
      onSelect: ctx.onRetire,
      confirm: {
        title: "Retire the selected assets?",
        body: "Each asset leaves the active registry and its test-and-tag schedule is retired. Assets already retired are skipped.",
        confirmLabel: "Retire",
      },
    },
  ];
  return actions.filter((a): a is BulkAction => !!a);
}
