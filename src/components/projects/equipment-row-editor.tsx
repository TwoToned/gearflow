"use client";

import { RowEditorSheet } from "@/components/ui/row-editor-sheet";
import type { ActionMenuSpec } from "@/lib/primitives/types";
import type { RowSheetPatch } from "@/lib/line-item-edit-payload";
import { CommentButton, type CommentTarget } from "./equipment-row-extras";
import { LineAssetsIndicator } from "./line-assets-indicator";
import type { OverbookedInfo } from "@/lib/overbooking-core";
import type { LineItemData } from "./equipment-row-types";

/**
 * Phone: a full-row tap on an Equipment line opens this `RowEditorSheet` (spec §5.8, §9l.3)
 * instead of the desktop's inline cells. It carries everything the desktop row shows in
 * `cells` so the phone loses nothing: quantity / price / discount `$ %` (the sheet's own
 * fields, saved through the SAME `patchNative` path as the inline cells), the discussion
 * badge (count, opens the thread) and the serial indicator (reassign / swap), the
 * availability notice with the sub-hire shortcut, and the rest of the row's own menu.
 */
export interface EquipmentRowEditorTarget {
  item: LineItemData;
  /** The row's own action menu (built once by the sections builder; never re-derived here). */
  menu?: ActionMenuSpec;
  over?: OverbookedInfo | null;
}

interface Props {
  target: EquipmentRowEditorTarget | null;
  onClose: () => void;
  comments?: CommentTarget;
  /** Money fields are read-only while pricing is locked. */
  moneyLocked: boolean;
  onSave: (item: LineItemData, patch: RowSheetPatch) => Promise<unknown>;
  onEditDetails: (item: LineItemData) => void;
  /** Absent without `subHire:create`: the availability notice then has no shortcut. */
  onSubHireShortfall?: (item: LineItemData, short: number) => void;
}

const num = (v: unknown): number | null => (v == null || v === "" ? null : Number(v));

function RowContext({ item, comments }: { item: LineItemData; comments?: CommentTarget }) {
  const hasSerials = (item.units ?? []).length > 0 || !!item.asset?.assetTag;
  if (!comments && !hasSerials) return null;
  return (
    <div className="-mx-4 flex flex-col border-t border-line">
      {comments ? (
        <div className="flex min-h-12 items-center justify-between gap-3 px-4 text-card-title">
          <span>Discussion</span>
          <CommentButton target={comments} lineId={item.id} touch />
        </div>
      ) : null}
      {hasSerials ? (
        <div className="flex min-h-12 items-center justify-between gap-3 border-t border-line px-4 text-card-title first:border-t-0">
          <span>Serials</span>
          <LineAssetsIndicator
            units={item.units}
            lineAssetTag={item.asset?.assetTag}
            lineItemId={item.id}
            modelId={item.modelId}
            disableReassign={item.childKind === "ACCESSORY"}
            touch
          />
        </div>
      ) : null}
    </div>
  );
}

export function EquipmentRowEditor({ target, onClose, comments, moneyLocked, onSave, onEditDetails, onSubHireShortfall }: Props) {
  const item = target?.item;
  const short = target?.over && target.over.overBy > 0 && !target.over.inherited ? target.over.overBy : 0;
  return (
    <RowEditorSheet
      open={!!target}
      onOpenChange={(o) => !o && onClose()}
      title={item?.model?.name ?? item?.description ?? "Item"}
      subtitle={item?.model?.name && item.description && item.description !== item.model.name ? item.description : undefined}
      initial={{
        quantity: item?.quantity ?? 1,
        unitPrice: num(item?.unitPrice),
        discount: num(item?.discount),
        discountMode: item?.discountMode === "%" ? "%" : "$",
        duration: item?.duration ?? 1,
      }}
      priceEditable={!moneyLocked}
      availability={
        short > 0
          ? {
              message: `${short} short on this job's dates.`,
              tone: "warning",
              action:
                onSubHireShortfall && item
                  ? { label: "Sub-hire shortfall", onSelect: () => { onClose(); onSubHireShortfall(item, short); } }
                  : undefined,
            }
          : undefined
      }
      contextSlot={item ? <RowContext item={item} comments={comments} /> : undefined}
      drillIns={item ? [{ key: "details", label: "All details", onOpen: () => { onClose(); onEditDetails(item); } }] : undefined}
      menu={target?.menu}
      onSave={(patch) => (item ? onSave(item, patch).then(() => undefined) : undefined)}
    />
  );
}
