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
import { useMutation, useQuery } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

import { createSubHire } from "@/server/sub-hires";
import { getSuppliers } from "@/server/suppliers";
import { DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ComboboxPicker } from "@/components/ui/combobox-picker";
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

  const { data: suppliersData } = useQuery({
    queryKey: ["suppliers", orgId],
    queryFn: () => getSuppliers(),
  });
  const supplierOptions = ((suppliersData || []) as Array<Record<string, unknown>>).map(
    (s) => ({ value: s.id as string, label: s.name as string }),
  );

  const createMut = useMutation({
    mutationFn: () =>
      createSubHire({
        supplierId,
        projectId,
        supplierReference: supplierReference || undefined,
        hireStart: hireStart || undefined,
        hireEnd: hireEnd || undefined,
        showOnDocs: false,
        notes: notes || undefined,
      }),
    onSuccess: (result: Record<string, unknown>) => {
      toast.success("Sub-hire order created");
      onCreated(result.id as string);
    },
    onError: (e) => toast.error((e as Error).message),
  });

  const canSubmit = supplierId.length > 0 && !createMut.isPending;

  return (
    <>
      <div className="space-y-4 py-2">
        <div className="space-y-2">
          <Label>Supplier</Label>
          <ComboboxPicker
            value={supplierId}
            onChange={setSupplierId}
            options={supplierOptions}
            placeholder="Select supplier..."
            searchPlaceholder="Search suppliers..."
            emptyMessage="No suppliers found."
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="sub-hire-ref">Supplier Reference</Label>
          <Input
            id="sub-hire-ref"
            value={supplierReference}
            onChange={(e) => setSupplierReference(e.target.value)}
            placeholder="Invoice #, PO #, quote ref, etc."
          />
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label htmlFor="sub-hire-start">Hire Start</Label>
            <Input
              id="sub-hire-start"
              type="date"
              value={hireStart}
              onChange={(e) => setHireStart(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="sub-hire-end">Hire End</Label>
            <Input
              id="sub-hire-end"
              type="date"
              value={hireEnd}
              onChange={(e) => setHireEnd(e.target.value)}
            />
          </div>
        </div>
        <div className="space-y-2">
          <Label htmlFor="sub-hire-notes">Notes</Label>
          <Textarea
            id="sub-hire-notes"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Optional notes..."
            rows={2}
          />
        </div>
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={onClose}>
          Cancel
        </Button>
        <Button onClick={() => createMut.mutate()} disabled={!canSubmit}>
          {createMut.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          Create &amp; Add Items
        </Button>
      </DialogFooter>
    </>
  );
}
