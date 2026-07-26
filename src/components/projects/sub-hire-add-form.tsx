"use client";

/**
 * Sub-hire add form — body of the "Add Sub-Hire to Project" flow,
 * mirrors EquipmentAddForm / KitAddForm / CustomItemAddForm so it can
 * render inline inside UnifiedAddDialog. No Dialog wrapper here — the
 * caller supplies that.
 *
 * Captures only the order-level fields (supplier, reference, dates,
 * notes). After createSubHire returns, the parent dialog hands off to
 * SubHireOrderDialog's manage view so the user can add items to the
 * newly-created order without a context switch.
 */

import { useState } from "react";
import { useServerMutation } from "@/hooks/use-server-mutation";
import { toast } from "sonner";

import { useSubHireWrites } from "@/hooks/use-sub-hire-writes";
import { useSupplier, useSupplierSearch } from "@/hooks/use-suppliers";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ComboboxPicker } from "@/components/ui/combobox-picker";
import { QuickCreateSupplier } from "@/components/assets/quick-create-supplier";
import { SectionTitle, Field } from "./line-item-form-fields";
import { useActiveOrganization } from "@/lib/auth-client";

export interface SubHireAddFormProps {
  projectId: string;
  /** Pre-fill the hire window from the project's rental dates if set. */
  rentalStartDate?: Date;
  rentalEndDate?: Date;
  /** Called after createSubHire succeeds. Parent uses this to close the
   *  unified dialog and open SubHireOrderDialog on the new order. */
  onCreated: (subHireId: string) => void;
  /** Close the surrounding dialog (Cancel button). */
  onClose: () => void;
}

function toDateInput(d?: Date): string {
  if (!d) return "";
  // YYYY-MM-DD in local time — matches <input type="date">.
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

export function SubHireAddForm({
  projectId,
  rentalStartDate,
  rentalEndDate,
  onCreated,
  onClose,
}: SubHireAddFormProps) {
  const { data: activeOrg } = useActiveOrganization();
  const orgId = activeOrg?.id;

  const [supplierId, setSupplierId] = useState("");
  const [supplierReference, setSupplierReference] = useState("");
  const [hireStart, setHireStart] = useState(toDateInput(rentalStartDate));
  const [hireEnd, setHireEnd] = useState(toDateInput(rentalEndDate));
  const [notes, setNotes] = useState("");
  const [showCreateSupplier, setShowCreateSupplier] = useState(false);
  const [supplierQuery, setSupplierQuery] = useState("");

  // Phase 7 — native INDEXED supplier search (bounded, reactive) instead of
  // loading the whole org list to JS-filter. Debounced as the user types.
  const debouncedSupplierQuery = useDebouncedValue(supplierQuery, 200);
  const supplierResults = useSupplierSearch(orgId, debouncedSupplierQuery);
  const supplierOptions = (supplierResults ?? [])
    .filter((s) => s.isActive ?? true)
    .map((s) => ({ value: s.id, label: s.name }));

  // Resolve the selected supplier's label directly (it may not be in the current
  // search page) so the trigger + summary always show the chosen name.
  const selectedSupplier = useSupplier(supplierId || undefined);
  const supplierName = selectedSupplier?.name;

  const subHireWrites = useSubHireWrites();
  const createMut = useServerMutation({
    mutationFn: () =>
      subHireWrites.create({
        supplierId,
        projectId,
        supplierReference: supplierReference || undefined,
        hireStart: hireStart || undefined,
        hireEnd: hireEnd || undefined,
        showOnDocs: false,
        notes: notes || undefined,
      }),
    onSuccess: (result: { id: string }) => {
      toast.success("Sub-hire order created");
      onCreated(result.id);
    },
    onError: (e) => toast.error((e as Error).message),
  });

  const canSubmit = supplierId.length > 0 && !createMut.isPending;

  return (
    <>
      <div className="space-y-6 py-2">
        {/* Supplier */}
        <section className="space-y-4">
          <SectionTitle title="Supplier" hint="Who you're hiring from." />
          <Field label="Supplier" required>
            <ComboboxPicker
              value={supplierId}
              onChange={setSupplierId}
              options={supplierOptions}
              onSearchChange={setSupplierQuery}
              loading={supplierResults === undefined}
              selectedLabel={supplierName}
              placeholder="Select a supplier…"
              searchPlaceholder="Search suppliers…"
              emptyMessage="No suppliers found."
              onCreateNew={() => setShowCreateSupplier(true)}
              createNewLabel="New supplier"
            />
          </Field>
          <Field label="Supplier reference">
            <Input
              id="sub-hire-ref"
              value={supplierReference}
              onChange={(e) => setSupplierReference(e.target.value)}
              placeholder="Invoice #, PO #, quote ref, etc."
            />
          </Field>
        </section>

        {/* Hire window */}
        <section className="space-y-4 border-t border-line pt-5">
          <SectionTitle title="Hire window" hint="Pre-filled from the project dates — adjust if needed." />
          <div className="grid grid-cols-2 gap-3">
            <Field label="Hire start">
              <Input
                id="sub-hire-start"
                type="date"
                value={hireStart}
                onChange={(e) => setHireStart(e.target.value)}
              />
            </Field>
            <Field label="Hire end">
              <Input
                id="sub-hire-end"
                type="date"
                value={hireEnd}
                onChange={(e) => setHireEnd(e.target.value)}
              />
            </Field>
          </div>
        </section>

        {/* Notes */}
        <section className="space-y-4 border-t border-line pt-5">
          <SectionTitle title="Notes" hint="Optional — internal context for this order." />
          <Field label="Notes">
            <Textarea
              id="sub-hire-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Optional notes…"
              rows={2}
            />
          </Field>
        </section>

        {supplierName && (
          <div className="rounded-[var(--r)] border border-line bg-paper-2/50 px-3 py-2 text-caption text-ink-2">
            Creating an order with <span className="font-medium text-ink">{supplierName}</span>
            {hireStart && hireEnd && <span> for {hireStart} → {hireEnd}</span>}. You&apos;ll add items next.
          </div>
        )}
      </div>

      <DialogFooter>
        <Button type="button" variant="line" onClick={onClose}>
          Cancel
        </Button>
        <Button type="button" onClick={() => createMut.mutate()} loading={createMut.isPending} disabled={!canSubmit}>
          Create &amp; add items
        </Button>
      </DialogFooter>

      <QuickCreateSupplier
        open={showCreateSupplier}
        onOpenChange={setShowCreateSupplier}
        onCreated={(id) => setSupplierId(id)}
      />
    </>
  );
}
