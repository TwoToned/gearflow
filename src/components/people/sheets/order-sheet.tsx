"use client";

import { useState } from "react";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";

import { supplierOrderSchema, type SupplierOrderFormValues } from "@/lib/validations/supplier-order";
import { useSupplierOrderWrites } from "@/hooks/use-supplier-order-writes";
import { supplierOrderStatusLabels, supplierOrderTypeLabels } from "@/lib/status-labels";
import { showError } from "@/lib/show-error";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { FormSheet } from "@/components/ui/form-sheet";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SmartFormSection, SmartFormField } from "@/components/ui/smart-form";
import { orderStatusTargets } from "../../../../convex/lib/orderStatusMachine";
import { useSheetAnnounce } from "./use-sheet-announce";

/**
 * `OrderSheet` (UX Phase 13 slice 4): the ONE create and edit surface for a supplier order, on `FormSheet` (it replaces
 * the `/suppliers/[id]/orders/new` page and the order page's edit dialog). Create is `?new-order=1` on the supplier;
 * edit is `?edit=1` on the order. An edit changes only status, dates and notes (the number, type and supplier are fixed
 * at creation; status is machine-guarded on the server). Every save toasts with the server's exact Undo.
 */
const TYPE_ORDER = ["PURCHASE", "SUBHIRE", "REPAIR", "LABOUR", "OTHER"] as const;
const STATUS_ORDER = ["DRAFT", "ORDERED", "PARTIAL", "RECEIVED", "CANCELLED"] as const;
/** A new order may start anywhere; an existing one offers only its current status and the moves the status machine allows (`lib/orderStatusMachine.ts`, the same table the server enforces). */
const statusOptions = (current: string | undefined): readonly string[] => (current ? orderStatusTargets(current) : STATUS_ORDER);

export interface OrderSheetProps {
  supplierId: string;
  supplierName: string;
  /** Edit: the stored order (dates as `YYYY-MM-DD`). Create: omit. */
  initialData?: SupplierOrderFormValues & { id: string };
  onClose: () => void;
  onSaved?: (r: { id: string }) => void;
}

export function OrderSheet({ supplierId, supplierName, initialData, onClose, onSaved }: OrderSheetProps) {
  const isEditing = !!initialData;
  const orderWrites = useSupplierOrderWrites();
  const announce = useSheetAnnounce("supplierOrder");
  const [saving, setSaving] = useState(false);
  const form = useForm<SupplierOrderFormValues>({
    resolver: zodResolver(supplierOrderSchema),
    defaultValues: initialData ?? { supplierId, orderNumber: "", type: "PURCHASE", status: "DRAFT", orderDate: "", expectedDate: "", notes: "" },
  });

  const submit = form.handleSubmit(async (data) => {
    setSaving(true);
    try {
      const saved = initialData
        ? await orderWrites.update(initialData.id, { status: data.status, orderDate: data.orderDate, expectedDate: data.expectedDate, notes: data.notes })
        : await orderWrites.create(data);
      if (initialData) announce.updated("order", data.orderNumber, saved);
      else announce.created("order", data.orderNumber, saved);
      onClose();
      onSaved?.(saved);
    } catch (e) {
      showError(e, { fallbackTitle: "Could not save the order" });
    } finally {
      setSaving(false);
    }
  });

  return (
    <FormSheet
      open
      onOpenChange={(o) => !o && onClose()}
      size="narrow"
      title={isEditing ? `Edit order ${initialData.orderNumber}` : "New order"}
      description={isEditing ? `${supplierName}. The number and type are fixed once an order exists.` : `A purchase order for ${supplierName}. Lines are added once it exists.`}
      primaryLabel={isEditing ? "Save" : "Create order"}
      onSubmit={submit}
      submitting={saving}
      dirty={form.formState.isDirty}
    >
      <input type="hidden" {...form.register("supplierId")} />
      <div className="space-y-8">
        <SmartFormSection title="Order" hint="Reference and classification." divider={false}>
          <div className="grid gap-5 sm:grid-cols-2">
            {isEditing ? null : (
              <>
                <div className="sm:col-span-2">
                  <SmartFormField label="Order / PO number" required error={form.formState.errors.orderNumber?.message}>
                    <Input {...form.register("orderNumber")} placeholder="e.g. PO-2024-001" aria-invalid={!!form.formState.errors.orderNumber} />
                  </SmartFormField>
                </div>
                <SmartFormField label="Type">
                  <Controller control={form.control} name="type" render={({ field }) => (
                    <Select value={field.value} onValueChange={field.onChange}>
                      <SelectTrigger><SelectValue>{supplierOrderTypeLabels[field.value ?? "PURCHASE"] ?? "Purchase"}</SelectValue></SelectTrigger>
                      <SelectContent>{TYPE_ORDER.map((t) => <SelectItem key={t} value={t}>{supplierOrderTypeLabels[t]}</SelectItem>)}</SelectContent>
                    </Select>
                  )} />
                </SmartFormField>
              </>
            )}
            <SmartFormField label="Status">
              <Controller control={form.control} name="status" render={({ field }) => (
                <Select value={field.value} onValueChange={field.onChange}>
                  <SelectTrigger><SelectValue>{supplierOrderStatusLabels[field.value ?? "DRAFT"] ?? "Draft"}</SelectValue></SelectTrigger>
                  <SelectContent>{statusOptions(initialData?.status).map((s) => <SelectItem key={s} value={s}>{supplierOrderStatusLabels[s]}</SelectItem>)}</SelectContent>
                </Select>
              )} />
            </SmartFormField>
          </div>
        </SmartFormSection>
        <SmartFormSection title="Dates" hint="When it was ordered and when to expect it.">
          <div className="grid gap-5 sm:grid-cols-2">
            <SmartFormField label="Order date"><Input type="date" {...form.register("orderDate")} /></SmartFormField>
            <SmartFormField label="Expected date"><Input type="date" {...form.register("expectedDate")} /></SmartFormField>
          </div>
        </SmartFormSection>
        <SmartFormSection title="Notes" hint="Anything else worth recording.">
          <SmartFormField label="Notes"><Textarea {...form.register("notes")} placeholder="Order notes…" rows={3} /></SmartFormField>
        </SmartFormSection>
      </div>
    </FormSheet>
  );
}
