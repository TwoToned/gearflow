"use client";

/**
 * UnifiedAddDialog — single dialog for adding any kind of line item to a
 * project (own-stock equipment, kit, sub-hire, custom item). Renders a
 * segmented switcher at the top and swaps the body inline based on the
 * selected kind.
 *
 * The "Sub-Hire" kind now renders SubHireAddForm inline. After the
 * order is created, the parent uses onSubHireCreated(id) to close this
 * dialog and open SubHireOrderDialog in manage mode so the user can add
 * items without a context switch.
 *
 * Replaces the four standalone toolbar entry points (Add Equipment / Add
 * Kit / Custom Item / Sub-Hire Orders) and the two group-kebab actions
 * (onAddEquipment / onAddKit).
 *
 * #1221 follow-up — `versionId` (the version currently being viewed) is
 * threaded to the own-stock/kit/custom forms, which now all support an
 * explicit non-live target (convex/lib/versionScope.ts's
 * resolveWriteVersionId). Two kinds are deliberately left out:
 * - **Sub-hire** creates rows in `subHireGroups`/`subHireOrders`, tables
 *   Project Versioning v2 never touched (no `versionId` column, no live/
 *   non-live distinction) — same "not version-aware" bucket as Labour/Tasks/
 *   Files, not a new gap this phase introduces.
 * - **Sale** (`saleMode: "FROM_RENTAL_STOCK"`) immediately mutates REAL
 *   stock on add (`sellSerializedAssetForSale`, convex/lineItemWrites.ts) —
 *   a physical, right-now side effect, not a plan entry. Selling stock
 *   "into" a non-live version would execute that real disposal against a
 *   plan that isn't the one currently governing the job, so the Sale tab
 *   stays disabled while `versionId` targets a non-live version (mirrors
 *   the "reality only ever lives on the live version" invariant
 *   `versions.ts`'s `makeLiveNative` step 3 documents).
 */


import { useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { EquipmentAddForm } from "./equipment-add-form";
import { KitAddForm } from "./kit-add-form";
import { CustomItemAddForm } from "./custom-item-add-form";
import { SubHireAddForm } from "./sub-hire-add-form";
import { SaleAddForm } from "./sale-add-form";
import type { CategoryData } from "./equipment-rows";

// WS11 (#950) — "sale" is the 5th kind (spec: "fifth kind 'Sale' in
// unified-add-dialog").
export type UnifiedAddKind = "own-stock" | "kit" | "sub-hire" | "custom" | "sale";

interface UnifiedAddDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Active kind. Parent owns it so the four toolbar buttons can each
   *  open the dialog on their respective tab. */
  kind: UnifiedAddKind;
  /** Called when the user picks a different kind via the segmented switcher.
   *  Implementations should ignore "sub-hire" — see onOpenSubHire below. */
  onKindChange: (kind: UnifiedAddKind) => void;
  projectId: string;
  rentalStartDate?: Date;
  rentalEndDate?: Date;
  /** Pre-set destination category for the new line item. */
  categoryId?: string;
  /** Pre-set destination group for the new line item. */
  groupId?: string;
  /** Human-readable label like "Audio > PA System" for the destination chip. */
  targetLabel?: string;
  /** Available categories (used by the custom-item form for its
   *  category/group picker). */
  categories: CategoryData[];
  /** Invalidate parent-owned queries after a successful add. */
  onInvalidate: () => void;
  /** Called after SubHireAddForm successfully creates an order. Parent
   *  should close this dialog and open SubHireOrderDialog in manage mode
   *  on the new id so the user can add items. */
  onSubHireCreated: (subHireId: string) => void;
  /** D3 (#1107) — pre-select this model on the "own-stock" body when the
   *  dialog was opened via the "Add <model> to it" chained hand-off. */
  preselectedModelId?: string;
  /** #1221 follow-up — the version currently being viewed. Absent = live.
   *  Threaded to own-stock/kit/custom; see the file header for why sub-hire
   *  and sale are excluded. */
  versionId?: string;
}

interface KindOption {
  value: UnifiedAddKind;
  label: string;
}

const KIND_OPTIONS: KindOption[] = [
  { value: "own-stock", label: "Own stock" },
  { value: "kit", label: "Kit" },
  { value: "sub-hire", label: "Sub-hire" },
  { value: "custom", label: "Custom" },
  { value: "sale", label: "Sale" },
];

const KIND_TITLES: Record<UnifiedAddKind, string> = {
  "own-stock": "Add equipment",
  kit: "Add kit",
  "sub-hire": "Add sub-hire",
  custom: "Add custom item",
  sale: "Add sale",
};

export function UnifiedAddDialog({
  open,
  onOpenChange,
  kind,
  onKindChange,
  projectId,
  rentalStartDate,
  rentalEndDate,
  categoryId,
  groupId,
  targetLabel,
  categories,
  onInvalidate,
  onSubHireCreated,
  preselectedModelId,
  versionId,
}: UnifiedAddDialogProps) {
  // #1221 follow-up — `kind` is owned by the parent and persists across
  // opens/closes; if the dialog was last left on "Sale" and the viewed
  // version changes to non-live before it's reopened, land on "Own stock"
  // instead of a disabled tab with a form mounted behind it.
  const saleDisabled = versionId != null;
  useEffect(() => {
    if (open && saleDisabled && kind === "sale") onKindChange("own-stock");
  }, [open, saleDisabled, kind, onKindChange]);

  function handleClose() {
    onOpenChange(false);
  }

  function handlePickKind(next: UnifiedAddKind) {
    if (next === "sale" && saleDisabled) return;
    onKindChange(next);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{KIND_TITLES[kind]}</DialogTitle>
        </DialogHeader>

        {/* Segmented kind switcher */}
        <TooltipProvider>
          <div role="tablist" aria-label="Add type" className="flex rounded-md border">
            {KIND_OPTIONS.map((opt) => {
              const active = kind === opt.value;
              const disabled = opt.value === "sale" && saleDisabled;
              const tab = (
                <button
                  key={opt.value}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  aria-disabled={disabled || undefined}
                  disabled={disabled}
                  onClick={() => handlePickKind(opt.value)}
                  className={`flex-1 px-3 py-1.5 text-sm font-medium transition-colors ${
                    active ? "bg-primary text-primary-foreground" : "hover:bg-accent"
                  } ${disabled ? "opacity-45 cursor-not-allowed hover:bg-transparent" : ""}`}
                >
                  {opt.label}
                </button>
              );
              if (!disabled) return tab;
              return (
                <Tooltip key={opt.value}>
                  <TooltipTrigger asChild>{tab}</TooltipTrigger>
                  <TooltipContent className="max-w-xs">
                    <p>Sale immediately sells real stock — it always applies to the live version, not the one you&apos;re viewing.</p>
                  </TooltipContent>
                </Tooltip>
              );
            })}
          </div>
        </TooltipProvider>

        {/* Body swap by kind — dispatched to its own component (not inlined
            here) so a 5th/6th kind never grows THIS function's cyclomatic
            complexity (R-3.6); AddFormBody owns its own budget for that. */}
        {open && (
          <AddFormBody
            kind={kind}
            onKindChange={onKindChange}
            projectId={projectId}
            rentalStartDate={rentalStartDate}
            rentalEndDate={rentalEndDate}
            categoryId={categoryId}
            groupId={groupId}
            targetLabel={targetLabel}
            categories={categories}
            onInvalidate={onInvalidate}
            onSubHireCreated={onSubHireCreated}
            onClose={handleClose}
            preselectedModelId={preselectedModelId}
            versionId={versionId}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

type AddFormBodyProps = Pick<
  UnifiedAddDialogProps,
  | "kind"
  | "onKindChange"
  | "projectId"
  | "rentalStartDate"
  | "rentalEndDate"
  | "categoryId"
  | "groupId"
  | "targetLabel"
  | "categories"
  | "onInvalidate"
  | "onSubHireCreated"
  | "preselectedModelId"
  | "versionId"
> & { onClose: () => void };

function AddFormBody({
  kind,
  onKindChange,
  projectId,
  rentalStartDate,
  rentalEndDate,
  categoryId,
  groupId,
  targetLabel,
  categories,
  onInvalidate,
  onSubHireCreated,
  onClose,
  preselectedModelId,
  versionId,
}: AddFormBodyProps) {
  switch (kind) {
    case "own-stock":
      return (
        <EquipmentAddForm
          projectId={projectId}
          rentalStartDate={rentalStartDate}
          rentalEndDate={rentalEndDate}
          categoryId={categoryId}
          groupId={groupId}
          targetLabel={targetLabel}
          onInvalidate={onInvalidate}
          onClose={onClose}
          onOpenSubHire={() => {
            // EquipmentAddForm uses this for the overbooking-fallback CTA.
            // Route it through the unified switcher so the user lands on
            // the inline sub-hire form, not a separate dialog.
            onKindChange("sub-hire");
          }}
          preselectedModelId={preselectedModelId}
          versionId={versionId}
        />
      );
    case "kit":
      return (
        <KitAddForm
          projectId={projectId}
          rentalStartDate={rentalStartDate}
          rentalEndDate={rentalEndDate}
          categoryId={categoryId}
          groupId={groupId}
          categories={categories}
          targetLabel={targetLabel}
          onInvalidate={onInvalidate}
          onClose={onClose}
          versionId={versionId}
        />
      );
    case "sub-hire":
      return (
        <SubHireAddForm
          projectId={projectId}
          rentalStartDate={rentalStartDate}
          rentalEndDate={rentalEndDate}
          onCreated={(id) => {
            onInvalidate();
            onSubHireCreated(id);
          }}
          onClose={onClose}
        />
      );
    case "custom":
      return (
        <CustomItemAddForm
          projectId={projectId}
          categories={categories}
          defaultCategoryId={categoryId}
          defaultGroupId={groupId}
          onInvalidate={onInvalidate}
          onClose={onClose}
          versionId={versionId}
        />
      );
    case "sale":
      return (
        <SaleAddForm
          projectId={projectId}
          categoryId={categoryId}
          groupId={groupId}
          targetLabel={targetLabel}
          onInvalidate={onInvalidate}
          onClose={onClose}
        />
      );
  }
}
