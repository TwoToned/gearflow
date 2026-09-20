"use client";

/**
 * "Edit accessories" — the row kebab's standalone accessory picker for a line
 * ALREADY on the project (issue #794's originally-planned post-add entry
 * point). The SAME picker now also renders as an Accessories section inside
 * `EditLineItemDialog` (the Edit Item window), which is where most PMs will
 * meet it; this dialog stays as the direct one-click route from the row menu.
 *
 * Both entry points share `useAccessoryPlanEditor` (catalog + stored plan +
 * seeding + derive) and `AccessorySelectionFields` (the checkbox UI), so the
 * two can't drift (R-3.1). Only the save differs: here it's the dialog's own
 * button; there it rides the Edit Item save.
 *
 * Eligibility (top-level line, has a model/asset, not deployed) is enforced
 * both here (menu visibility, `canEditAccessoryPlan`) and server-side
 * (`assertLineOwnsAccessoryPlan` — the authority; this is UX only).
 */

import { useServerMutation } from "@/hooks/use-server-mutation";
import { useLineItemWrites } from "@/hooks/use-line-item-writes";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { AccessorySelectionFields } from "./accessory-selection-fields";
import { useAccessoryPlanEditor } from "./use-accessory-plan-editor";
import type { LineItemData } from "./equipment-row-types";
import { toast } from "sonner";

export interface EditAccessoryPlanDialogProps {
  /** The line being edited — needs `id`/`modelId`/`asset.assetTag`/`quantity`/
   *  `description` from the already-loaded row; `accessoryPlan` isn't on this
   *  type, so the editor hook fetches it fresh. */
  item: LineItemData | null;
  onClose: () => void;
}

export function EditAccessoryPlanDialog({ item, onClose }: EditAccessoryPlanDialogProps) {
  const lineItemWrites = useLineItemWrites();
  const editor = useAccessoryPlanEditor(item);

  const mutation = useServerMutation({
    mutationFn: () => {
      if (!item) throw new Error("No line selected");
      return lineItemWrites.updateAccessoryPlan(item.id, editor.planToSave);
    },
    onSuccess: () => {
      toast.success("Accessories updated");
      onClose();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Dialog open={!!item} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Edit accessories</DialogTitle>
        </DialogHeader>
        {item && editor.accessories.length === 0 ? (
          <p className="text-caption text-muted">
            {item.description ?? "This item"} has no configurable accessories.
          </p>
        ) : (
          <AccessorySelectionFields
            accessories={editor.accessories}
            quantity={item?.quantity ?? 1}
            selection={editor.selection}
            onSelectionChange={editor.setSelection}
            excludeReasons={editor.excludeReasons}
            onExcludeReasonsChange={editor.setExcludeReasons}
          />
        )}
        <DialogFooter>
          <Button type="button" variant="line" onClick={onClose}>
            Cancel
          </Button>
          <Button
            type="button"
            loading={mutation.isPending}
            disabled={!lineItemWrites.enabled || editor.accessories.length === 0}
            onClick={() => mutation.mutate()}
          >
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
