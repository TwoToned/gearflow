"use client";

/**
 * UnifiedAddDialog — single dialog for adding any kind of line item to a
 * project (own-stock equipment, kit, sub-hire, custom item). Renders a
 * segmented switcher at the top and swaps the body inline based on the
 * selected kind. The "Sub-Hire" kind is a bounce: it closes this dialog
 * and invokes onOpenSubHire to launch the existing PO workflow
 * (SubHireOrderDialog) — that stays separate per the cross-type
 * unification plan.
 *
 * Replaces the four standalone toolbar entry points (Add Equipment / Add
 * Kit / Custom Item / Sub-Hire Orders) and the two group-kebab actions
 * (onAddEquipment / onAddKit).
 */

import { useEffect, useState } from "react";

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { EquipmentAddForm } from "./equipment-add-form";
import { KitAddForm } from "./kit-add-form";
import { CustomItemAddForm } from "./custom-item-add-form";
import type { CategoryData } from "./equipment-rows";

export type UnifiedAddKind = "own-stock" | "kit" | "sub-hire" | "custom";

interface UnifiedAddDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Which kind to show on open. Defaults to own-stock per the 8G decision. */
  initialKind?: UnifiedAddKind;
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
  /** Open the sub-hire PO workflow. Called when the user picks the Sub-Hire
   *  tab; this dialog closes and SubHireOrderDialog opens. */
  onOpenSubHire: () => void;
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
];

const KIND_TITLES: Record<UnifiedAddKind, string> = {
  "own-stock": "Add equipment",
  kit: "Add kit",
  "sub-hire": "Add sub-hire",
  custom: "Add custom item",
};

export function UnifiedAddDialog({
  open,
  onOpenChange,
  initialKind = "own-stock",
  projectId,
  rentalStartDate,
  rentalEndDate,
  categoryId,
  groupId,
  targetLabel,
  categories,
  onInvalidate,
  onOpenSubHire,
}: UnifiedAddDialogProps) {
  const [kind, setKind] = useState<UnifiedAddKind>(initialKind);

  // Reset to the requested initial kind every time the dialog opens.
  useEffect(() => {
    if (open) setKind(initialKind);
  }, [open, initialKind]);

  // Sub-hire is a bounce — close this dialog and open the existing
  // SubHireOrderDialog (PO workflow). Done in an effect so the user sees
  // the segmented switcher highlight briefly before the bounce.
  useEffect(() => {
    if (open && kind === "sub-hire") {
      onOpenChange(false);
      onOpenSubHire();
    }
  }, [open, kind, onOpenChange, onOpenSubHire]);

  function handleClose() {
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{KIND_TITLES[kind]}</DialogTitle>
        </DialogHeader>

        {/* Segmented kind switcher */}
        <div role="tablist" aria-label="Add type" className="flex rounded-md border">
          {KIND_OPTIONS.map((opt) => {
            const active = kind === opt.value;
            return (
              <button
                key={opt.value}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => setKind(opt.value)}
                className={`flex-1 px-3 py-1.5 text-sm font-medium transition-colors ${
                  active ? "bg-primary text-primary-foreground" : "hover:bg-accent"
                }`}
              >
                {opt.label}
              </button>
            );
          })}
        </div>

        {/* Body swap by kind. Sub-hire renders nothing — the effect above
            bounces to onOpenSubHire on the next tick. */}
        {open && kind === "own-stock" && (
          <EquipmentAddForm
            projectId={projectId}
            rentalStartDate={rentalStartDate}
            rentalEndDate={rentalEndDate}
            categoryId={categoryId}
            groupId={groupId}
            targetLabel={targetLabel}
            onInvalidate={onInvalidate}
            onClose={handleClose}
            onOpenSubHire={onOpenSubHire}
          />
        )}
        {open && kind === "kit" && (
          <KitAddForm
            projectId={projectId}
            rentalStartDate={rentalStartDate}
            rentalEndDate={rentalEndDate}
            categoryId={categoryId}
            groupId={groupId}
            targetLabel={targetLabel}
            onInvalidate={onInvalidate}
            onClose={handleClose}
          />
        )}
        {open && kind === "custom" && (
          <CustomItemAddForm
            projectId={projectId}
            categories={categories}
            defaultCategoryId={categoryId}
            defaultGroupId={groupId}
            onInvalidate={onInvalidate}
            onClose={handleClose}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
