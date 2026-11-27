"use client";
// use-client: form state and a write (R-8.1.1)

import * as React from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { useInvoiceWrites } from "@/hooks/use-invoice-writes";
import { convexErrorMessage } from "@/lib/errors/convex-error-message";
import { VOID_INVOICE_COPY } from "@/lib/row-actions/finance";

/**
 * Void an invoice from the hub. The write is the existing `invoicesWrites.voidNative` (its own gate; the number stays used, the document stays, Xero is untouched); this only
 * collects the reason. A void has no Undo (the confirm says what stays), as on the job's Finance tab.
 */
export function VoidInvoiceDialog({ target, onClose }: { target: { id: string; label: string } | null; onClose: () => void }) {
  const writes = useInvoiceWrites();
  const [reason, setReason] = React.useState("");
  const [pending, setPending] = React.useState(false);

  const close = () => {
    setReason("");
    onClose();
  };

  const confirm = async () => {
    if (!target) return;
    setPending(true);
    try {
      await writes.void(target.id, reason.trim());
      toast.success(`Voided ${target.label}`);
      close();
    } catch (e) {
      toast.error(convexErrorMessage(e, "Failed to void invoice"));
    } finally {
      setPending(false);
    }
  };

  return (
    <Dialog open={target != null} onOpenChange={(o) => !o && close()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{VOID_INVOICE_COPY.title(target?.label ?? "this invoice")}</DialogTitle>
          <DialogDescription>{VOID_INVOICE_COPY.body}</DialogDescription>
        </DialogHeader>
        <div className="space-y-1.5">
          <Label htmlFor="void-reason">Reason</Label>
          <Input id="void-reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why is it being voided?" className="text-base md:text-ui-text" />
        </div>
        <DialogFooter>
          <Button type="button" variant="line" onClick={close}>
            Cancel
          </Button>
          <Button type="button" variant="primary" loading={pending} disabled={pending || reason.trim().length === 0} onClick={confirm}>
            {VOID_INVOICE_COPY.confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
