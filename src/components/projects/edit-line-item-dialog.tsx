"use client";

/**
 * Edit-line-item dialog — description, quantity, unit price, discount,
 * placement (category/group), the optional flag, notes, and the overbook
 * confirmation flow. Rebuilt on the equipment-add-form reference pattern
 * (#883): RHF + zodResolver(lineItemSchema), the shared SectionTitle/Field/
 * DiscountField primitives, and PlacementFields — closing the biggest gap
 * called out in the issue (this dialog previously had NO placement or
 * isOptional editing at all, and silently reset isOptional to false on
 * every save since it was never included in the submitted payload).
 *
 * State + the availability query live inside the body keyed by
 * item.id so re-opening for a different row remounts the body and
 * seeds fresh from the new item. Parent owns updateLineItemMut and
 * receives the computed payload via onSubmit; placement changes go
 * through a separate `onMove` callback since they're a different
 * mutation (groupWrites.moveLineItem) with its own slot/suggested-price
 * side effects — mirrors how EditGroupDialog fires price as a second,
 * independent call alongside its main update.
 */

import { useState } from "react";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
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
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { checkAvailability } from "@/server/line-items";
import { lineItemSchema, type LineItemFormValues } from "@/lib/validations/line-item";
import { XeroAccountCodeField, XeroTaxTypeField } from "@/components/settings/xero-coding-fields";
import { useXeroLinked } from "@/hooks/use-xero-linked";
import { PlacementFields } from "./placement-fields";
import { SectionTitle, Field, DiscountField, type DiscountMode } from "./line-item-form-fields";
import type { LineItemData, CategoryData } from "./equipment-rows";

export interface EditLineItemPayload {
  type: string;
  quantity: number;
  unitPrice?: number;
  description: string;
  pricingType: string;
  duration: number;
  discount?: number;
  notes?: string;
  isOptional: boolean;
  xeroAccountCode?: string;
  xeroTaxType?: string;
}

export interface EditLineItemPlacement {
  categoryId: string | null;
  groupId: string | null;
}

interface EditLineItemDialogProps {
  /** Line item being edited. Null closes the dialog. */
  item: LineItemData | null;
  projectId: string;
  rentalStartDate?: Date | null;
  rentalEndDate?: Date | null;
  /** Active organization id — used in the availability query key. */
  orgId?: string;
  /** Categories (+ groups) for the placement picker. Omit/empty to hide
   *  the Placement section (e.g. when categories haven't loaded yet). */
  categories?: CategoryData[];
  /** The item's current category/group, resolved by the caller from where
   *  in the tree the row was clicked (line items don't carry categoryId/
   *  groupId directly — the tree position IS the placement). */
  initialCategoryId?: string;
  initialGroupId?: string;
  isPending: boolean;
  onClose: () => void;
  onSubmit: (
    id: string,
    data: EditLineItemPayload,
    allowOverbook: boolean,
    baseUpdatedAt?: string | number | null,
  ) => void;
  /** Fired separately from onSubmit only when the placement picker's value
   *  differs from initialCategoryId/initialGroupId — a no-op move is never
   *  sent. Omitted (or the Placement section hidden) when the item is a kit
   *  child, which moves with its parent kit rather than independently. */
  onMove?: (id: string, placement: EditLineItemPlacement) => void;
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
  categories,
  initialCategoryId,
  initialGroupId,
  isPending,
  onClose,
  onSubmit,
  onMove,
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
  const xeroLinked = useXeroLinked();

  const form = useForm<LineItemFormValues>({
    resolver: zodResolver(lineItemSchema),
    defaultValues: {
      type: (item.type as LineItemFormValues["type"]) ?? "EQUIPMENT",
      description: item.description ?? item.model?.name ?? "",
      quantity: item.quantity,
      unitPrice: item.unitPrice != null ? Number(item.unitPrice) : undefined,
      pricingType: (item.pricingType as LineItemFormValues["pricingType"]) ?? "PER_DAY",
      duration: item.duration ?? 1,
      discount: item.discount != null && Number(item.discount) > 0 ? Number(item.discount) : undefined,
      notes: item.notes ?? "",
      isOptional: item.isOptional ?? false,
      xeroAccountCode: item.xeroAccountCode ?? "",
      xeroTaxType: item.xeroTaxType ?? "",
    },
  });
  const [discountMode, setDiscountMode] = useState<DiscountMode>("$");
  const [overbookConfirmed, setOverbookConfirmed] = useState(false);

  // Placement — kit children move with their parent kit, not independently.
  const canEditPlacement = !item.isKitChild && !!onMove && !!categories?.length;
  const [categoryId, setCategoryId] = useState(initialCategoryId ?? "");
  const [groupId, setGroupId] = useState(initialGroupId ?? "");

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

  const requestedQty = Number(form.watch("quantity")) || 1;
  const isOverbooked =
    availableForEdit != null && requestedQty > availableForEdit;

  function handleSave(data: LineItemFormValues) {
    const qty = Number(data.quantity) || 1;
    const price = data.unitPrice != null ? Number(data.unitPrice) : undefined;
    const dur = Number(data.duration) || item.duration || 1;
    let disc = data.discount != null ? Number(data.discount) : undefined;
    if (disc && discountMode === "%" && price != null) {
      disc = Math.round((price * qty * dur * disc) / 100 * 100) / 100;
    }
    onSubmit(
      item.id,
      {
        type: data.type ?? item.type ?? "EQUIPMENT",
        quantity: qty,
        unitPrice: price,
        description: data.description ?? "",
        pricingType: data.pricingType ?? item.pricingType ?? "PER_DAY",
        duration: dur,
        discount: disc,
        notes: data.notes || undefined,
        isOptional: data.isOptional ?? false,
        xeroAccountCode: data.xeroAccountCode || undefined,
        xeroTaxType: data.xeroTaxType || undefined,
      },
      overbookConfirmed,
      baseUpdatedAt,
    );

    if (canEditPlacement) {
      const nextCategoryId = categoryId || null;
      const nextGroupId = groupId || null;
      const placementChanged =
        (initialCategoryId ?? null) !== nextCategoryId || (initialGroupId ?? null) !== nextGroupId;
      if (placementChanged) {
        onMove!(item.id, { categoryId: nextCategoryId, groupId: nextGroupId });
      }
    }
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

      <form
        onSubmit={form.handleSubmit(handleSave)}
        className={`space-y-6 ${formDisabled ? "pointer-events-none opacity-60" : ""}`}
      >
        {/* Item */}
        <section className="space-y-4">
          <SectionTitle title="Item" hint="Description and how much of it." />
          <Field label="Description" htmlFor="edit-description">
            <Input id="edit-description" {...form.register("description")} disabled={formDisabled} />
          </Field>
          <Field label="Quantity" htmlFor="edit-quantity">
            <Input
              id="edit-quantity"
              type="number"
              min={1}
              {...form.register("quantity")}
              disabled={formDisabled}
            />
          </Field>

          {availability && item.modelId && (
            <div className="space-y-1 rounded-[var(--r)] border border-line bg-paper-2/50 p-3 text-caption">
              <p className={isOverbooked ? "text-t-out" : "text-muted"}>
                <span className="t-data font-semibold">{availableForEdit ?? 0}</span>{" "}
                available out of{" "}
                <span className="t-data font-semibold">{availability.effectiveStock ?? availability.totalStock}</span>{" "}
                {availability.dateless ? "in stock" : "usable"}
                {availability.dateless && (
                  <span className="font-normal text-muted"> (no dates set — showing stock only)</span>
                )}
              </p>
              {(availability.unavailable ?? 0) > 0 && (
                <p className="text-blue t-micro">
                  {availability.unavailable} of {availability.totalStock} total not usable
                  {" "}({[
                    availability.inMaintenance ? `${availability.inMaintenance} in maintenance` : "",
                    availability.lost ? `${availability.lost} lost` : "",
                  ].filter(Boolean).join(", ")})
                </p>
              )}
              {availability.conflicts && availability.conflicts.length > 0 && (
                <div className="flex items-start gap-2 text-warn">
                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  <div>
                    <p className="font-medium">Conflicts:</p>
                    <ul className="list-disc pl-4">
                      {availability.conflicts.map((c) => (
                        <li key={String(c)}>{String(c)}</li>
                      ))}
                    </ul>
                  </div>
                </div>
              )}
            </div>
          )}
        </section>

        {/* Pricing */}
        <section className="space-y-4 border-t border-line pt-5">
          <SectionTitle title="Pricing" hint="Rate and discount for this line." />
          <Field label="Unit price ($)" htmlFor="edit-unitPrice">
            <Input
              id="edit-unitPrice"
              type="number"
              step="0.01"
              min={0}
              placeholder="Enter price"
              {...form.register("unitPrice")}
              disabled={formDisabled}
            />
          </Field>
          <Controller
            control={form.control}
            name="discount"
            render={({ field }) => (
              <DiscountField
                id="edit-discount"
                value={field.value == null ? "" : String(field.value)}
                onValueChange={field.onChange}
                mode={discountMode}
                onModeChange={setDiscountMode}
                disabled={formDisabled}
              />
            )}
          />
        </section>

        {xeroLinked && (
          <section className="space-y-4 border-t border-line pt-5">
            <SectionTitle title="Xero coding" hint="Overrides the model/kit/category default for this line only." />
            <Controller
              control={form.control}
              name="xeroAccountCode"
              render={({ field }) => (
                <XeroAccountCodeField value={field.value} onChange={field.onChange} label="Account" placeholder="Inherit default" />
              )}
            />
            <Controller
              control={form.control}
              name="xeroTaxType"
              render={({ field }) => (
                <XeroTaxTypeField value={field.value} onChange={field.onChange} label="Tax type" placeholder="Use org default" />
              )}
            />
          </section>
        )}

        {/* Placement & options */}
        <section className="space-y-4 border-t border-line pt-5">
          <SectionTitle title="Placement & options" hint="Where it lands and how it's treated." />

          {canEditPlacement && (
            <PlacementFields
              categories={categories!}
              categoryId={categoryId}
              groupId={groupId}
              onChange={({ categoryId, groupId }) => {
                setCategoryId(categoryId);
                setGroupId(groupId);
              }}
            />
          )}

          <Field label="Notes" htmlFor="edit-notes">
            <Textarea id="edit-notes" {...form.register("notes")} rows={2} disabled={formDisabled} />
          </Field>

          <label className="flex cursor-pointer items-center gap-2.5">
            <Controller
              control={form.control}
              name="isOptional"
              render={({ field }) => (
                <Checkbox
                  id="edit-isOptional"
                  checked={field.value ?? false}
                  onCheckedChange={field.onChange}
                  disabled={formDisabled}
                />
              )}
            />
            <span className="text-ui-text text-ink-2">Optional item (excluded from totals)</span>
          </label>
        </section>

        {!formDisabled && isOverbooked && (
          <div className="space-y-2 rounded-[var(--r)] border-l-[3px] border-t-out bg-out-soft px-3 py-2.5">
            <p className="flex items-start gap-1.5 text-caption font-medium text-t-out">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>
                {rentalStartDate && rentalEndDate
                  ? `This will overbook ${requestedQty} units with only ${availableForEdit ?? 0} available across overlapping projects`
                  : `Only ${availableForEdit ?? 0} in stock — requesting ${requestedQty}`}
              </span>
            </p>
            {availability?.dateless && (
              <p className="t-micro text-t-out/80">
                No dates set — checking stock only (not cross-project conflicts)
              </p>
            )}
            {availability?.conflicts && availability.conflicts.length > 0 && (
              <p className="t-micro text-t-out/80">
                Conflicts with: {availability.conflicts.join(", ")}
              </p>
            )}
            <label className="flex cursor-pointer items-center gap-2 text-caption">
              <Checkbox
                checked={overbookConfirmed}
                onCheckedChange={(c) => setOverbookConfirmed(c === true)}
              />
              <span className="text-t-out">I understand, overbook anyway</span>
            </label>
          </div>
        )}

        <DialogFooter>
          <Button type="button" variant="line" onClick={onClose}>
            Cancel
          </Button>
          <Button
            type="submit"
            loading={isPending}
            disabled={formDisabled || (isOverbooked && !overbookConfirmed)}
          >
            Save
          </Button>
        </DialogFooter>
      </form>
    </>
  );
}
