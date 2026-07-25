"use client";

import { useState } from "react";
import { toast } from "sonner";

import { useSupplierOrderWrites } from "@/hooks/use-supplier-order-writes";
import { useServerMutation } from "@/hooks/use-server-mutation";
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
import { NativeSelect } from "@/components/ui/select";
import { Loader2 } from "lucide-react";

type OrderType = "PURCHASE" | "SUBHIRE" | "REPAIR" | "LABOUR" | "OTHER";

interface QuickCreateSupplierOrderProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  supplierId: string;
  /** Pre-fill the order number with whatever the user had typed into the combobox. */
  initialOrderNumber?: string;
  onCreated?: (order: { id: string; orderNumber: string }) => void;
}

/**
 * Inline "create a new supplier order" dialog — same pattern as QuickCreateLocation /
 * QuickCreateSupplier, triggered from the asset form's order-number combobox
 * (issue #789) when the typed order number doesn't match an existing SupplierOrder
 * for the selected supplier. Only the fields needed to get a usable order on the
 * books; the rest (dates, notes, financials) are filled in later from the order
 * detail / new-order page.
 */
export function QuickCreateSupplierOrder({
  open,
  onOpenChange,
  supplierId,
  initialOrderNumber = "",
  onCreated,
}: QuickCreateSupplierOrderProps) {
  const [orderNumber, setOrderNumber] = useState(initialOrderNumber);
  const [type, setType] = useState<OrderType>("PURCHASE");

  const orderWrites = useSupplierOrderWrites();
  const mutation = useServerMutation({
    mutationFn: () =>
      orderWrites.create({ supplierId, orderNumber, type, status: "DRAFT", orderDate: "", expectedDate: "", notes: "" }),
    onSuccess: (result: { id: string }) => {
      toast.success("Order created");
      onCreated?.({ id: result.id, orderNumber });
      onOpenChange(false);
      setOrderNumber("");
      setType("PURCHASE");
    },
    onError: (e) => toast.error(e.message),
  });

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next);
        if (next) setOrderNumber(initialOrderNumber);
      }}
    >
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>New Order</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <div className="space-y-2">
            <Label htmlFor="quick-order-number">Order / PO number</Label>
            <Input
              id="quick-order-number"
              value={orderNumber}
              onChange={(e) => setOrderNumber(e.target.value)}
              placeholder="e.g. PO-2024-001"
              onKeyDown={(e) => {
                if (e.key === "Enter" && orderNumber.trim()) {
                  e.preventDefault();
                  mutation.mutate();
                }
              }}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="quick-order-type">Type</Label>
            <NativeSelect
              variant="compact"
              id="quick-order-type"
              value={type}
              onChange={(e) => setType(e.target.value as OrderType)}
            >
              <option value="PURCHASE">Purchase</option>
              <option value="SUBHIRE">Subhire</option>
              <option value="REPAIR">Repair</option>
              <option value="LABOUR">Labour</option>
              <option value="OTHER">Other</option>
            </NativeSelect>
          </div>
        </div>
        <DialogFooter>
          <Button
            onClick={() => mutation.mutate()}
            disabled={!orderNumber.trim() || mutation.isPending}
          >
            {mutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Create
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
