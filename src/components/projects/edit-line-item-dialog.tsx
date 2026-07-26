"use client";

/**
 * Edit-line-item dialog — description, quantity, unit price (manual),
 * discount, notes, and the overbook confirmation flow. Extracted from
 * equipment-tab.tsx in Phase 7.
 *
 * State + the availability query live inside the body keyed by
 * item.id so re-opening for a different row remounts the body and
 * seeds fresh from the new item. Parent owns updateLineItemMut and
 * receives the computed payload via onSubmit.
 */

import { useState } from "react";
import { useServerQuery } from "@/hooks/use-server-query";
import { useEditLock } from "@/hooks/use-collaboration";
import { LockedEditorOverlay } from "@/components/collaboration/locked-editor-overlay";
import { AlertTriangle } from "lucide-react";

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { checkAvailability } from "@/server/line-items";
import type { LineItemData } from "./equipment-rows";
import { DiscountField, resolveDiscountAmount, type DiscountMode } from "./line-item-form-fields";

export interface EditLineItemPayload {
  type: string;
  quantity: number;
  unitPrice?: number;
  description: string;
  pricingType: string;
  duration: number;
  discount?: number;
  notes?: string;
  isOptional?: boolean;
}

interface EditLineItemDialogProps {
  /** Line item being edited. Null closes the dialog. */
  item: LineItemData | null;
  projectId: string;
  rentalStartDate?: Date | null;
  rentalEndDate?: Date | null;
  /** Active organization id — used in the availability query key. */
  orgId?: string;
  isPending: boolean;
  onClose: () => void;
  onSubmit: (
    id: string,
    data: EditLineItemPayload,
    allowOverbook: boolean,
    baseUpdatedAt?: string | number | null,
  ) => void;
}

export function EditLineItemDialog(props: EditLineItemDialogProps) {
  return (
    <Dialog open={props.item != null} onOpenChange={(open) => { if (!open) props.onClose(); }}>
      <DialogContent className="sm:max-w-md">
        {props.item && (
          <EditLineItemDialogBody key={props.item.id} {...props} item={props.item} />
        )}
      </DialogContent>
    </Dialog>
  );
}

function EditLineItemDialogBody({
  item,
  projectId,
  rentalStartDate,
  rentalEndDate,
  orgId,
  isPending,
  onClose,
  onSubmit,
}: EditLineItemDialogProps & { item: LineItemData }) {
  // Edit lock — acquire while this dialog body is mounted. Released on unmount.
  const { lockState, isLocked, isStale, takeover } = useEditLock({
    entityType: "project",
    entityId: projectId,
    targetType: "lineItem",
    targetId: item.id,
    active: true,
    enabled: !!orgId,
  });

  // Disable the whole form when another user holds an active lock
  const formDisabled = isLocked;

  // Form state — seeded from item via useState initializers. Each fresh
  // open remounts the body (keyed by item.id) so these always reflect
  // the row that was clicked.
  const [description, setDescription] = useState(
    item.description ?? item.model?.name ?? "",
  );
  const [quantity, setQuantity] = useState(String(item.quantity));
  const [unitPrice, setUnitPrice] = useState(
    item.unitPrice != null ? String(Number(item.unitPrice)) : "",
  );
  const [discount, setDiscount] = useState(
    item.discount != null && Number(item.discount) > 0 ? String(Number(item.discount)) : "",
  );
  const [discountMode, setDiscountMode] = useState<DiscountMode>("$");
  const [notes, setNotes] = useState(item.notes ?? "");
  const [isOptional, setIsOptional] = useState(item.isOptional ?? false);
  const [overbookConfirmed, setOverbookConfirmed] = useState(false);

  // Optimistic-concurrency baseline — captured once when the editor opens
  // (the body remounts per item.id, so the initializer runs fresh each open).
  const [baseUpdatedAt] = useState<string | number | null>(() => {
    const u = item.updatedAt;
    if (u == null) return null;
    return u instanceof Date ? u.toISOString() : u;
  });

  // Availability query — only runs for model-backed items. Same query
  // key shape as the equipment add form's check so React Query
  // deduplicates the request.
  const { data: availability } = useServerQuery({
    queryKey: [
      "availability",
      orgId,
      item.modelId ?? null,
      rentalStartDate?.toISOString() ?? null,
      rentalEndDate?.toISOString() ?? null,
      projectId,
    ],
    queryFn: () =>
      checkAvailability(
        item.modelId!,
        rentalStartDate ?? null,
        rentalEndDate ?? null,
        projectId,
      ),
    enabled: !!item.modelId,
  });

  // "Available for this edit" = the server-computed usable pool minus
  // all overlapping bookings (including this item), plus the item's own
  // quantity added back. Matches the add dialog and agrees with the
  // overbook badge.
  const availableForEdit =
    availability ? availability.available + item.quantity : null;

  const requestedQty = Number(quantity) || 1;
  const isOverbooked =
    availableForEdit != null && requestedQty > availableForEdit;

  function handleSave() {
    const qty = Number(quantity) || 1;
    const price = unitPrice ? Number(unitPrice) : undefined;
    const dur = item.duration ?? 1;
    const gross = price != null ? price * qty * dur : undefined;
    const disc = resolveDiscountAmount(
      discountMode,
      discount ? Number(discount) : undefined,
      gross,
    );
    onSubmit(
      item.id,
      {
        type: item.type ?? "EQUIPMENT",
        quantity: qty,
        unitPrice: price,
        description,
        pricingType: item.pricingType ?? "PER_DAY",
        duration: dur,
        discount: disc,
        notes: notes || undefined,
        isOptional,
      },
      overbookConfirmed,
      baseUpdatedAt,
    );
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>Edit Item</DialogTitle>
      </DialogHeader>

      {/* Collaboration lock overlay — shown when another user holds the lock */}
      {(isLocked || isStale) && (
        <LockedEditorOverlay
          lockState={lockState}
          onTakeover={isStale ? () => void takeover() : undefined}
          className="mb-2"
        />
      )}

      <div className={`space-y-4 py-2 ${formDisabled ? "pointer-events-none opacity-60" : ""}`}>
        <div className="space-y-2">
          <Label htmlFor="edit-description">Description</Label>
          <Input
            id="edit-description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            disabled={formDisabled}
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="edit-quantity">Quantity</Label>
          <Input
            id="edit-quantity"
            type="number"
            min={1}
            value={quantity}
            onChange={(e) => setQuantity(e.target.value)}
            disabled={formDisabled}
          />
          {availability && item.modelId && (
            <div className="space-y-1 pt-1">
              <p className={isOverbooked ? "text-sm text-red-600 dark:text-red-400" : "text-sm text-fg-3"}>
                <span className="font-semibold">{availableForEdit ?? 0}</span>{" "}
                available out of{" "}
                <span className="font-semibold">{availability.effectiveStock ?? availability.totalStock}</span>{" "}
                {availability.dateless ? "in stock" : "usable"}
                {availability.dateless && (
                  <span className="text-fg-3 font-normal">
                    {" "}(no dates set — showing stock only)
                  </span>
                )}
              </p>
              {(availability.unavailable ?? 0) > 0 && (
                <p className="text-blue-600 dark:text-blue-400 text-xs">
                  {availability.unavailable} of {availability.totalStock} total not usable
                  {" "}({[
                    availability.inMaintenance ? `${availability.inMaintenance} in maintenance` : "",
                    availability.lost ? `${availability.lost} lost` : "",
                  ].filter(Boolean).join(", ")})
                </p>
              )}
              {availability.conflicts && availability.conflicts.length > 0 && (
                <div className="flex items-start gap-2 text-amber-600 dark:text-amber-400">
                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  <div>
                    <p className="text-xs font-medium">Conflicts:</p>
                    <ul className="list-disc pl-4 text-xs">
                      {availability.conflicts.map((c) => (
                        <li key={String(c)}>{String(c)}</li>
                      ))}
                    </ul>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        <div className="space-y-3">
          <Label htmlFor="edit-unitPrice">Unit price</Label>
          <div className="space-y-2">
            <Input
              id="edit-unitPrice"
              type="number"
              step="0.01"
              min={0}
              value={unitPrice}
              onChange={(e) => setUnitPrice(e.target.value)}
              placeholder="Enter price"
            />
          </div>

          <DiscountField
            id="edit-discount"
            mode={discountMode}
            onModeChange={setDiscountMode}
            disabled={formDisabled}
            inputProps={{
              value: discount,
              onChange: (e) => setDiscount(e.target.value),
            }}
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="edit-notes">Notes</Label>
          <Textarea
            id="edit-notes"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={2}
          />
        </div>

        <label className="flex cursor-pointer items-center gap-2.5">
          <Checkbox
            id="edit-isOptional"
            checked={isOptional}
            onCheckedChange={(c) => setIsOptional(c === true)}
            disabled={formDisabled}
          />
          <span className="text-ui-text text-ink-2">Optional item (excluded from totals)</span>
        </label>

        {!formDisabled && isOverbooked && (
          <div className="rounded-md border border-red-500/50 bg-red-500/10 p-3 space-y-2">
            <p className="text-sm font-medium text-red-600 dark:text-red-400">
              <AlertTriangle className="inline-block mr-1.5 h-3.5 w-3.5" />
              {rentalStartDate && rentalEndDate
                ? `This will overbook ${requestedQty} units with only ${availableForEdit ?? 0} available across overlapping projects`
                : `Only ${availableForEdit ?? 0} in stock — requesting ${requestedQty}`}
            </p>
            {availability?.dateless && (
              <p className="text-xs text-red-600/80 dark:text-red-400/80">
                No dates set — checking stock only (not cross-project conflicts)
              </p>
            )}
            {availability?.conflicts && availability.conflicts.length > 0 && (
              <p className="text-xs text-red-600/80 dark:text-red-400/80">
                Conflicts with: {availability.conflicts.join(", ")}
              </p>
            )}
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <input
                type="checkbox"
                checked={overbookConfirmed}
                onChange={(e) => setOverbookConfirmed(e.target.checked)}
                className="accent-red-500"
              />
              <span className="text-red-600 dark:text-red-400">I understand, overbook anyway</span>
            </label>
          </div>
        )}
      </div>
      <DialogFooter>
        <Button variant="line" onClick={onClose}>
          Cancel
        </Button>
        <Button
          onClick={handleSave}
          loading={isPending}
          disabled={formDisabled || (isOverbooked && !overbookConfirmed)}
        >
          Save
        </Button>
      </DialogFooter>
    </>
  );
}
