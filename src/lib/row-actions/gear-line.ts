import {
  ArrowRightLeft,
  AlertTriangle,
  BookmarkPlus,
  Eye,
  EyeOff,
  Handshake,
  Pencil,
  Puzzle,
  RefreshCw,
  Trash2,
  TrendingDown,
  TrendingUp,
} from "lucide-react";

import { canRevealPriceInRollup } from "@/lib/category-pricing-display";
import { canDiscloseGroupChild } from "@/lib/group-child-disclosure";
import type { ActionItem, ActionMenuSpec, RowActionBuilder } from "@/lib/primitives/types";
import { canExcludeFromRoi } from "@/lib/roi";

/** The facts about a gear line the menu depends on (all already on the row). */
export interface GearLineActionRow {
  title: string;
  status?: string | null;
  modelId?: string | null;
  type?: string | null;
  kitId?: string | null;
  isKitChild?: boolean | null;
  isCustomItem?: boolean | null;
  isContainerLineItem?: boolean | null;
  subHireId?: string | null;
  revealPriceInRollup?: boolean | null;
  showInGroupOnDocs?: boolean | null;
  excludeFromRoi?: boolean | null;
  /** An open (not resolved) needs-review / follow-up marker exists. */
  hasOpenMarker?: boolean;
}

/**
 * Where the row sits, plus the handlers. A handler that is omitted means the
 * caller cannot do that action, so the item is absent (never disabled).
 */
export interface GearLineActionCtx {
  inRollupCategory?: boolean;
  inProjectGroup?: boolean;
  isSubHireGroupChild?: boolean;
  onEdit?: () => void;
  onMoveToCategory?: () => void;
  onMoveToGroup?: () => void;
  onEditAccessories?: () => void;
  onMarker?: (status: "needs_review" | "follow_up" | "resolved") => void;
  onReportIssue?: () => void;
  onTogglePriceReveal?: () => void;
  onToggleGroupDisclosure?: () => void;
  onToggleRoiExclusion?: () => void;
  onRemove?: () => void;
  /** Caller-built items for stateful entries (e.g. the custom-unit conversion). */
  extraItems?: ActionItem[];
}

type Entry = ActionItem | false | undefined | null;

function editItems(ctx: GearLineActionCtx): Entry[] {
  return [
    ctx.onEdit && { key: "edit", label: "Edit", group: "edit", kbd: "E", icon: Pencil, onSelect: ctx.onEdit },
    ctx.onEditAccessories && {
      key: "edit-accessories", label: "Edit accessories", group: "edit", icon: Puzzle, onSelect: ctx.onEditAccessories,
    },
  ];
}

function organiseItems(ctx: GearLineActionCtx): Entry[] {
  return [
    ctx.onMoveToCategory && {
      key: "move-category", label: "Move to category", group: "organise", kbd: "M", icon: ArrowRightLeft,
      onSelect: ctx.onMoveToCategory,
    },
    ctx.onMoveToGroup && {
      key: "move-group", label: "Move to group", group: "organise", icon: ArrowRightLeft, onSelect: ctx.onMoveToGroup,
    },
  ];
}

function revealItem(row: GearLineActionRow, ctx: GearLineActionCtx): Entry {
  const ok =
    ctx.inRollupCategory &&
    ctx.onTogglePriceReveal &&
    canRevealPriceInRollup({
      inProjectGroup: ctx.inProjectGroup,
      isSubHireGroupChild: ctx.isSubHireGroupChild,
      isKitChild: row.isKitChild,
    });
  return (
    ok && {
      key: "price-reveal", label: row.revealPriceInRollup ? "Hide this price" : "Show this price", group: "documents",
      icon: row.revealPriceInRollup ? EyeOff : Eye, onSelect: ctx.onTogglePriceReveal!,
    }
  );
}

function discloseItem(row: GearLineActionRow, ctx: GearLineActionCtx): Entry {
  const ok = ctx.inProjectGroup && ctx.onToggleGroupDisclosure && canDiscloseGroupChild(row);
  return (
    ok && {
      key: "group-disclosure", label: row.showInGroupOnDocs ? "Hide this item" : "Show this item", group: "documents",
      icon: row.showInGroupOnDocs ? EyeOff : Eye, onSelect: ctx.onToggleGroupDisclosure!,
    }
  );
}

function documentItems(row: GearLineActionRow, ctx: GearLineActionCtx): Entry[] {
  return [revealItem(row, ctx), discloseItem(row, ctx)];
}

function markerItems(row: GearLineActionRow, ctx: GearLineActionCtx): Entry[] {
  const mark = ctx.onMarker;
  return [
    mark && { key: "needs-review", label: "Needs review", group: "reporting", icon: BookmarkPlus, onSelect: () => mark("needs_review") },
    mark && { key: "follow-up", label: "Follow up", group: "reporting", icon: Handshake, onSelect: () => mark("follow_up") },
    mark && row.hasOpenMarker && { key: "resolve-marker", label: "Resolve marker", group: "reporting", icon: RefreshCw, onSelect: () => mark("resolved") },
  ];
}

function reportingItems(row: GearLineActionRow, ctx: GearLineActionCtx): Entry[] {
  return [
    ctx.onToggleRoiExclusion &&
      canExcludeFromRoi(row) && {
        key: "roi", label: row.excludeFromRoi ? "Include in ROI" : "Exclude from ROI", group: "reporting",
        icon: row.excludeFromRoi ? TrendingUp : TrendingDown, onSelect: ctx.onToggleRoiExclusion,
      },
    ...markerItems(row, ctx),
    // Only a deployed line can have an issue reported (GitHub #898).
    ctx.onReportIssue && row.status === "CHECKED_OUT" && {
      key: "report-issue", label: "Report issue", group: "reporting", icon: AlertTriangle, onSelect: ctx.onReportIssue,
    },
  ];
}

function dangerItems(row: GearLineActionRow, ctx: GearLineActionCtx): Entry[] {
  return [
    ctx.onRemove && {
      key: "delete", label: "Delete", group: "danger", kbd: "D", danger: true, icon: Trash2, onSelect: ctx.onRemove,
      confirm: {
        title: `Delete ${row.title}?`,
        body: "Removes this line from the job, releases its reservation and drops it from documents. Quotes already sent keep their copy.",
        confirmLabel: "Delete line",
      },
    },
  ];
}

/**
 * The gear line's ⋯ menu as a pure function — the Equipment row's menu today,
 * and (Phase 3) the warehouse row's, so both surfaces share one gear menu
 * (spec §5.2). Every `when` is evaluated here; an action that does not apply
 * is absent from the spec.
 */
export const buildGearLineActions: RowActionBuilder<GearLineActionRow, GearLineActionCtx> = (row, ctx): ActionMenuSpec => ({
  items: [
    ...editItems(ctx),
    ...organiseItems(ctx),
    ...(ctx.extraItems ?? []),
    ...documentItems(row, ctx),
    ...reportingItems(row, ctx),
    ...dangerItems(row, ctx),
  ].filter((e): e is ActionItem => !!e),
});
