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
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { XeroAccountCodeField, XeroTaxTypeField } from "@/components/settings/xero-coding-fields";
import { useXeroLinked } from "@/hooks/use-xero-linked";
import {
  DiscountField,
  discountEntryValue,
  resolveDiscountAmount,
  toDiscountMode,
  type DiscountMode,
} from "./line-item-form-fields";
import type { GroupData } from "./equipment-rows";

export interface EditGroupFormValues {
  title: string;
  description?: string;
  quantity: number;
  xeroAccountCode?: string;
  xeroTaxType?: string;
}

interface EditGroupDialogProps {
  group: GroupData | null;
  isPending: boolean;
  onClose: () => void;
  /** Called when the user clicks Save. The parent decides which
   *  mutation(s) to fire and whether to apply the optional price/discount
   *  alongside the main update. */
  onSubmit: (
    groupId: string,
    values: EditGroupFormValues,
    price: number | undefined,
    discount: number | undefined,
    /** #1012 — how `discount` was entered; persisted for document display. */
    discountMode: DiscountMode | undefined,
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
  const discountVal = group.discount != null ? Number(group.discount) : null;

  const [title, setTitle] = useState(group.title);
  const [description, setDescription] = useState(group.description ?? "");
  const [quantity, setQuantity] = useState(String(group.quantity));
  const [price, setPrice] = useState(priceVal != null ? String(priceVal) : "");
  // #1012 — reopen showing the discount the way it was ENTERED (a group saved
  // as 10% comes back as "10" with the `%` toggle), not the resolved dollar
  // amount with the toggle reset to `$`.
  const initialDiscountMode = toDiscountMode(group.discountMode);
  const [discount, setDiscount] = useState(
    discountEntryValue(discountVal, initialDiscountMode, (priceVal ?? 0) * (group.quantity || 1)),
  );
  const [discountMode, setDiscountMode] = useState<DiscountMode>(initialDiscountMode);
  const [xeroAccountCode, setXeroAccountCode] = useState(group.xeroAccountCode ?? "");
  const [xeroTaxType, setXeroTaxType] = useState(group.xeroTaxType ?? "");
  const xeroLinked = useXeroLinked();

  function handleSave() {
    if (!title.trim()) return;
    const resolvedPrice = price !== "" ? parseFloat(price) || 0 : undefined;
    const gross = (resolvedPrice ?? priceVal ?? 0) * (parseInt(quantity) || 1);
    const resolvedDiscount = resolveDiscountAmount(discountMode, discount, gross);
    onSubmit(
      group.id,
      {
        title: title.trim(),
        description: description.trim() || undefined,
        quantity: parseInt(quantity) || 1,
        // NOT `|| undefined` (unlike description above): an omitted/undefined
        // key never reaches the Convex mutation at all (JSON.stringify drops
        // `undefined` values), so "clear the override" would be silently lost
        // instead of patching back to unset. Always send the raw string —
        // updateGroupNative's `a.xeroAccountCode || undefined` does the
        // clear-on-empty itself, the way it's meant to work.
        xeroAccountCode,
        xeroTaxType,
      },
      resolvedPrice,
      resolvedDiscount,
      discountMode,
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
        <DiscountField
          value={discount}
          onValueChange={setDiscount}
          mode={discountMode}
          onModeChange={setDiscountMode}
        />
        {xeroLinked && (
          <Accordion type="single" collapsible>
            <AccordionItem value="xero-coding" className="border-line">
              <AccordionTrigger>Advanced: Xero coding</AccordionTrigger>
              <AccordionContent>
                <div className="space-y-4 pt-1">
                  <p className="text-caption text-muted">Overrides the category default for this group&apos;s invoice line only.</p>
                  <XeroAccountCodeField value={xeroAccountCode} onChange={setXeroAccountCode} label="Account" placeholder="Inherit default" />
                  <XeroTaxTypeField value={xeroTaxType} onChange={setXeroTaxType} label="Tax type" placeholder="Use org default" />
                </div>
              </AccordionContent>
            </AccordionItem>
          </Accordion>
        )}
      </div>
      <DialogFooter>
        <Button variant="line" onClick={onClose}>
          Cancel
        </Button>
        <Button onClick={handleSave} loading={isPending} disabled={!title.trim()}>
          Save
        </Button>
      </DialogFooter>
    </>
  );
}
