"use client";

/**
 * AddEquipmentDialog — thin wrapper around EquipmentAddForm. Preserves the
 * external API for the toolbar button and group-kebab "Add equipment" entry
 * points so they keep working unchanged during Phase 4 unification.
 *
 * Body lives in equipment-add-form.tsx so it can also be embedded inside
 * the unified add dialog.
 */

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { EquipmentAddForm } from "./equipment-add-form";

interface AddEquipmentDialogProps {
  projectId: string;
  rentalStartDate?: Date;
  rentalEndDate?: Date;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Pre-set category for the line item */
  categoryId?: string;
  /** Pre-set group for the line item */
  groupId?: string;
  /** Human-readable label like "Audio > PA System" when adding inside a group */
  targetLabel?: string;
  /** Callback to open the sub-hire order dialog instead of navigating */
  onOpenSubHire?: () => void;
}

export function AddEquipmentDialog({
  projectId,
  rentalStartDate,
  rentalEndDate,
  open,
  onOpenChange,
  categoryId,
  groupId,
  targetLabel,
  onOpenSubHire,
}: AddEquipmentDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add Equipment</DialogTitle>
        </DialogHeader>
        {open && (
          <EquipmentAddForm
            projectId={projectId}
            rentalStartDate={rentalStartDate}
            rentalEndDate={rentalEndDate}
            categoryId={categoryId}
            groupId={groupId}
            targetLabel={targetLabel}
            onClose={() => onOpenChange(false)}
            onOpenSubHire={onOpenSubHire}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
