"use client";

/**
 * Edit-group dialog — title, description, quantity, and price for a
 * ProjectGroup. Extracted from equipment-tab.tsx in Phase 7.
 *
 * State lives inside this component, seeded from the `group` prop on
 * each fresh open via the wrapper + keyed-body pattern. The parent
 * owns updateGroupMut + updateGroupPrice and receives a single
 * onSubmit callback with the form values.
 */

import { useState } from "react";

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { formatCurrency } from "@/lib/formatters";
import { useEditLock } from "@/hooks/use-collaboration";
import { LockedEditorOverlay } from "@/components/collaboration/locked-editor-overlay";
import { COLLAB_TARGET_TYPES } from "@/lib/collaboration-targets";
import { DiscountField, resolveDiscountAmount, type DiscountMode } from "./line-item-form-fields";
import type { GroupData } from "./equipment-rows";

export interface EditGroupFormValues {
  title: string;
  description?: string;
  quantity: number;
}

interface EditGroupDialogProps {
  group: GroupData | null;
  isPending: boolean;
  /** Project + org for the collaboration edit lock. Lock is skipped if absent. */
  projectId?: string;
  orgId?: string;
  onClose: () => void;
  /** Called when the user clicks Save. The parent decides which
   *  mutation(s) to fire and whether to apply the optional price/discount
   *  alongside the main update. */
  onSubmit: (
    groupId: string,
    values: EditGroupFormValues,
    price: number | undefined,
    discount: number | undefined,
  ) => void;
}

export function EditGroupDialog(props: EditGroupDialogProps) {
  return (
    <Dialog open={props.group != null} onOpenChange={(open) => { if (!open) props.onClose(); }}>
      <DialogContent className="max-w-sm">
        {props.group && <EditGroupDialogBody key={props.group.id} {...props} group={props.group} />}
      </DialogContent>
    </Dialog>
  );
}

function EditGroupDialogBody({
  group,
  isPending,
  projectId,
  orgId,
  onClose,
  onSubmit,
}: EditGroupDialogProps & { group: GroupData }) {
  // Edit lock — held while this group editor is open. Released on unmount.
  const { lockState, isLocked, isStale, takeover } = useEditLock({
    entityType: "project",
    entityId: projectId ?? "",
    targetType: COLLAB_TARGET_TYPES.group,
    targetId: group.id,
    active: true,
    enabled: !!orgId && !!projectId,
  });
  const formDisabled = isLocked;

  const priceVal = group.price != null ? Number(group.price) : null;
  const discountVal = group.discount != null ? Number(group.discount) : null;

  const [title, setTitle] = useState(group.title);
  const [description, setDescription] = useState(group.description ?? "");
  const [quantity, setQuantity] = useState(String(group.quantity));
  const [price, setPrice] = useState(priceVal != null ? String(priceVal) : "");
  const [discount, setDiscount] = useState(discountVal != null ? String(discountVal) : "");
  const [discountMode, setDiscountMode] = useState<DiscountMode>("$");

  function handleSave() {
    if (!title.trim() || formDisabled) return;
    const resolvedPrice = price !== "" ? parseFloat(price) || 0 : undefined;
    const gross = (resolvedPrice ?? priceVal ?? 0) * (parseInt(quantity) || 1);
    const resolvedDiscount = resolveDiscountAmount(discountMode, discount, gross);
    onSubmit(
      group.id,
      {
        title: title.trim(),
        description: description.trim() || undefined,
        quantity: parseInt(quantity) || 1,
      },
      resolvedPrice,
      resolvedDiscount,
    );
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>Edit Group</DialogTitle>
        <DialogDescription>
          Update the group&apos;s title, description, and quantity.
        </DialogDescription>
      </DialogHeader>
      <LockedEditorOverlay
        lockState={lockState}
        onTakeover={isStale ? () => void takeover() : undefined}
      />
      <div className={`space-y-4 ${formDisabled ? "pointer-events-none opacity-60" : ""}`}>
        <div className="space-y-2">
          <Label>Title</Label>
          <Input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Group title"
            autoFocus
          />
        </div>
        <div className="space-y-2">
          <Label>Description</Label>
          <Textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Optional description..."
            rows={3}
          />
        </div>
        <div className="space-y-2">
          <Label>Quantity</Label>
          <Input
            type="number"
            min="1"
            value={quantity}
            onChange={(e) => setQuantity(e.target.value)}
          />
        </div>
        <div className="space-y-2">
          <Label>Price</Label>
          <Input
            type="number"
            min="0"
            step="0.01"
            value={price}
            onChange={(e) => setPrice(e.target.value)}
            placeholder="Leave blank for no price"
          />
          {group.suggestedPrice != null && (
            <button
              type="button"
              className="text-xs text-fg-3 hover:text-fg transition-colors"
              onClick={() => setPrice(String(Number(group.suggestedPrice)))}
            >
              Suggested: {formatCurrency(Number(group.suggestedPrice))}
            </button>
          )}
        </div>
        <DiscountField
          value={discount}
          onValueChange={setDiscount}
          mode={discountMode}
          onModeChange={setDiscountMode}
          disabled={formDisabled}
        />
      </div>
      <DialogFooter>
        <Button variant="line" onClick={onClose}>
          Cancel
        </Button>
        <Button onClick={handleSave} loading={isPending} disabled={!title.trim() || formDisabled}>
          Save
        </Button>
      </DialogFooter>
    </>
  );
}
