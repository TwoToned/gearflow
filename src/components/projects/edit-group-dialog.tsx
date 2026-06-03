"use client";

/**
 * Edit-group dialog — title, description, quantity, billing override,
 * and price for a ProjectGroup. Extracted from equipment-tab.tsx in
 * Phase 7.
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
import type { GroupData } from "./equipment-rows";

export interface EditGroupFormValues {
  title: string;
  description?: string;
  quantity: number;
  billingMonths?: number;
  billingWeeks?: number;
  billingDays?: number;
}

interface EditGroupDialogProps {
  group: GroupData | null;
  isPending: boolean;
  onClose: () => void;
  /** Called when the user clicks Save. The parent decides which
   *  mutation(s) to fire and whether to apply the optional price
   *  alongside the main update. */
  onSubmit: (
    groupId: string,
    values: EditGroupFormValues,
    price: number | undefined,
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
  onClose,
  onSubmit,
}: EditGroupDialogProps & { group: GroupData }) {
  const priceVal = group.price != null ? Number(group.price) : null;

  const [title, setTitle] = useState(group.title);
  const [description, setDescription] = useState(group.description ?? "");
  const [quantity, setQuantity] = useState(String(group.quantity));
  const [price, setPrice] = useState(priceVal != null ? String(priceVal) : "");
  const [billingMonths, setBillingMonths] = useState(
    group.billingMonths != null ? String(group.billingMonths) : "",
  );
  const [billingWeeks, setBillingWeeks] = useState(
    group.billingWeeks != null ? String(group.billingWeeks) : "",
  );
  const [billingDays, setBillingDays] = useState(
    group.billingDays != null ? String(group.billingDays) : "",
  );

  function handleSave() {
    if (!title.trim()) return;
    onSubmit(
      group.id,
      {
        title: title.trim(),
        description: description.trim() || undefined,
        quantity: parseInt(quantity) || 1,
        billingMonths: billingMonths !== "" ? parseInt(billingMonths) : undefined,
        billingWeeks: billingWeeks !== "" ? parseInt(billingWeeks) : undefined,
        billingDays: billingDays !== "" ? parseInt(billingDays) : undefined,
      },
      price !== "" ? parseFloat(price) || 0 : undefined,
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
      <div className="space-y-4">
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
        <div className="space-y-2">
          <Label className="text-muted-foreground text-xs">
            Billing Override (leave blank to use project defaults)
          </Label>
          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-1">
              <Label>Months</Label>
              <Input
                type="number"
                min="0"
                value={billingMonths}
                onChange={(e) => setBillingMonths(e.target.value)}
                placeholder="—"
              />
            </div>
            <div className="space-y-1">
              <Label>Weeks</Label>
              <Input
                type="number"
                min="0"
                value={billingWeeks}
                onChange={(e) => setBillingWeeks(e.target.value)}
                placeholder="—"
              />
            </div>
            <div className="space-y-1">
              <Label>Days</Label>
              <Input
                type="number"
                min="0"
                value={billingDays}
                onChange={(e) => setBillingDays(e.target.value)}
                placeholder="—"
              />
            </div>
          </div>
        </div>
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={onClose}>
          Cancel
        </Button>
        <Button onClick={handleSave} disabled={!title.trim() || isPending}>
          Save
        </Button>
      </DialogFooter>
    </>
  );
}
