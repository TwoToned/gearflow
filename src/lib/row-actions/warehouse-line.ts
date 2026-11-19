import { ArrowLeftRight, PackageOpen, Undo2, Wrench } from "lucide-react";

import { buildGearLineActions, type GearLineActionRow } from "@/lib/row-actions/gear-line";
import type { ActionItem, ActionMenuSpec, RowActionBuilder } from "@/lib/primitives/types";
import type { JobStage } from "@/lib/warehouse-job-rows";

/**
 * The warehouse row's ⋯ (spec §5.2, §9.2): the SHARED gear menu plus the
 * warehouse verbs. Every handler that is omitted means the caller cannot do
 * that action, so the item is ABSENT, never disabled.
 */
export interface WarehouseLineActionCtx {
  stage: JobStage;
  onReportIssue?: () => void;
  onMoveToCase?: () => void;
  /** Reverse one stage (Prepped → To pick, Out → Prepped, Returned → Out, De-prepped → Returned). */
  onMoveBack?: () => void;
  onConvertToCustom?: () => void;
  onConvertBackToInventory?: () => void;
}

const BACK_LABEL: Record<JobStage, string | null> = {
  pick: null, prepped: "Move to To pick", out: "Move to Prepped", returned: "Move to Out", deprepped: "Move to Returned",
};

function warehouseItems(ctx: WarehouseLineActionCtx): ActionItem[] {
  const back = BACK_LABEL[ctx.stage];
  const items: Array<ActionItem | null> = [
    ctx.onMoveToCase && ctx.stage !== "deprepped" ? { key: "move-to-case", label: "Move to case…", group: "organise", icon: ArrowLeftRight, onSelect: ctx.onMoveToCase } : null,
    ctx.onMoveBack && back ? { key: "move-back", label: back, group: "organise", icon: Undo2, onSelect: ctx.onMoveBack } : null,
    ctx.onConvertToCustom ? { key: "prep-as-custom", label: "Prep as custom item", group: "organise", icon: PackageOpen, onSelect: ctx.onConvertToCustom } : null,
    ctx.onConvertBackToInventory ? { key: "custom-back", label: "Convert back to inventory", group: "organise", icon: Wrench, onSelect: ctx.onConvertBackToInventory } : null,
  ];
  return items.filter((i): i is ActionItem => !!i);
}

export const buildWarehouseLineActions: RowActionBuilder<GearLineActionRow, WarehouseLineActionCtx> = (row, ctx): ActionMenuSpec =>
  buildGearLineActions(row, { onReportIssue: ctx.onReportIssue, extraItems: warehouseItems(ctx) });
