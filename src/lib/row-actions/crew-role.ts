import { Archive, ArchiveRestore, ArrowDown, ArrowUp, Pencil } from "lucide-react";

import type { ActionItem, ActionMenuSpec } from "@/lib/primitives/types";

/**
 * A crew role's ⋯ in the Crew roles & rates sheet (spec §9h.5): Edit… ·
 * Move up / Move down · Archive… for an active role, Restore for an archived
 * one. Moves exist only for active roles and only where there is a neighbour
 * (absent at the ends, never disabled). Archive… opens its own usage dialog,
 * so it carries no menu-level confirm.
 */
export interface CrewRoleActionRow {
  isActive: boolean;
  /** Position among the ACTIVE roles. */
  index: number;
  activeCount: number;
}

export interface CrewRoleActionCtx {
  onEdit?: () => void;
  onMove?: (direction: "up" | "down") => void;
  onArchive?: () => void;
  onRestore?: () => void;
}

type Entry = ActionItem | false | undefined | null;

const compact = (entries: Entry[]): ActionItem[] => entries.filter((e): e is ActionItem => !!e);

function moveItems(row: CrewRoleActionRow, onMove: CrewRoleActionCtx["onMove"]): Entry[] {
  if (!onMove || !row.isActive) return [];
  return [
    row.index > 0 && { key: "up", label: "Move up", group: "organise", icon: ArrowUp, onSelect: () => onMove("up") },
    row.index < row.activeCount - 1 && { key: "down", label: "Move down", group: "organise", icon: ArrowDown, onSelect: () => onMove("down") },
  ];
}

export function buildCrewRoleActions(row: CrewRoleActionRow, ctx: CrewRoleActionCtx): ActionMenuSpec {
  return {
    items: compact([
      ctx.onEdit && { key: "edit", label: "Edit…", group: "edit", icon: Pencil, onSelect: ctx.onEdit },
      ...moveItems(row, ctx.onMove),
      row.isActive && ctx.onArchive && { key: "archive", label: "Archive…", group: "danger", icon: Archive, danger: true, onSelect: ctx.onArchive },
      !row.isActive && ctx.onRestore && { key: "restore", label: "Restore", group: "organise", icon: ArchiveRestore, onSelect: ctx.onRestore },
    ]),
  };
}
