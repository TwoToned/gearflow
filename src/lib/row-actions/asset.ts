import { Archive, ExternalLink, Pencil, RotateCcw, Tag } from "lucide-react";

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
