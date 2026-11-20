"use client";

/**
 * "Edit accessories" — the ONE accessory editor for a line ALREADY on the
 * project (spec §7.2). The row's ⋯ and the Edit Item dialog's "Edit
 * accessories…" button both open it; there is no second picker. State comes
 * from `useAccessoryPlanEditor`, the checkbox UI from `AccessorySelectionFields`.
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
        <AccessorySelectionFields
          accessories={editor.accessories}
          quantity={item?.quantity ?? 1}
          selection={editor.selection}
          onSelectionChange={editor.setSelection}
          excludeReasons={editor.excludeReasons}
          onExcludeReasonsChange={editor.setExcludeReasons}
          custom={editor.custom}
          onCustomChange={editor.setCustom}
        />
        <DialogFooter>
          <Button type="button" variant="line" onClick={onClose}>
            Cancel
          </Button>
          <Button
            type="button"
            loading={mutation.isPending}
            disabled={!lineItemWrites.enabled || !editor.loaded}
            onClick={() => mutation.mutate()}
          >
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
