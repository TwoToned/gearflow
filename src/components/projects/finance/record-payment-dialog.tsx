"use client";

import { useState } from "react";
import { toast } from "sonner";

import { usePaymentWrites } from "@/hooks/use-payment-writes";
import { formatCurrency } from "@/lib/formatters";
import { PAYMENT_METHOD_LABELS } from "@/lib/payment-method-labels";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

interface RecordPaymentDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  invoiceId: string;
  invoiceNumber: string;
  /** `total - amountPaid` at the moment the dialog opened — prefills `amount`,
   *  never sent to the server (R-9.3: the mutation only requires ISSUED
   *  status, an overpayment is allowed, not silently capped). */
  balanceRemaining: number;
  onRecorded?: () => void;
}

/** Record a payment against an ISSUED invoice (#1055). Recomputes the
 *  invoice's amountPaid/paymentStatus server-side (paymentsWrites.ts
 *  recordNative) — this dialog only collects the bookkeeping fields. */
export function RecordPaymentDialog({ open, onOpenChange, invoiceId, invoiceNumber, balanceRemaining, onRecorded }: RecordPaymentDialogProps) {
  const paymentWrites = usePaymentWrites();
  const [amount, setAmount] = useState(balanceRemaining > 0 ? balanceRemaining.toFixed(2) : "");
  const [method, setMethod] = useState("BANK_TRANSFER");
  const [reference, setReference] = useState("");
  const [paidAtStr, setPaidAtStr] = useState(todayStr());
  const [notes, setNotes] = useState("");
  const [recording, setRecording] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function reset() {
    setAmount(balanceRemaining > 0 ? balanceRemaining.toFixed(2) : "");
    setMethod("BANK_TRANSFER");
    setReference("");
    setPaidAtStr(todayStr());
    setNotes("");
    setError(null);
  }

  function handleOpenChange(next: boolean) {
    if (!next) reset();
    onOpenChange(next);
  }

  async function handleRecord() {
    setRecording(true);
    setError(null);
    try {
      await paymentWrites.record(invoiceId, {
        amount,
        method: method as never,
        reference: reference || undefined,
        paidAt: new Date(paidAtStr),
        notes: notes || undefined,
      });
      toast.success("Payment recorded");
      onRecorded?.();
      handleOpenChange(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to record payment");
    } finally {
      setRecording(false);
    }
  }

  const invalid = !(Number(amount) > 0);

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Record payment</DialogTitle>
          <DialogDescription>Against invoice {invoiceNumber}. Balance remaining is {formatCurrency(balanceRemaining)}.</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="payment-amount">Amount</Label>
              <Input id="payment-amount" type="number" min={0.01} step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="payment-date">Date received</Label>
              <Input id="payment-date" type="date" value={paidAtStr} onChange={(e) => setPaidAtStr(e.target.value)} />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="payment-method">Method</Label>
            <Select value={method} onValueChange={setMethod}>
              <SelectTrigger id="payment-method">
                <SelectValue>{PAYMENT_METHOD_LABELS[method] ?? method}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {Object.entries(PAYMENT_METHOD_LABELS).map(([value, label]) => (
                  <SelectItem key={value} value={value}>{label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="payment-reference">Reference (optional)</Label>
            <Input id="payment-reference" value={reference} onChange={(e) => setReference(e.target.value)} maxLength={200} placeholder="e.g. bank ref, receipt #" />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="payment-notes">Notes (optional)</Label>
            <Textarea id="payment-notes" value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} maxLength={2000} />
          </div>

          {error && (
            <p role="alert" className="rounded-[var(--radius)] border-l-[3px] border-l-t-out bg-out-soft px-3 py-2 text-sm text-t-out">
              {error}
            </p>
          )}
        </div>

        <DialogFooter>
          <Button type="button" variant="line" onClick={() => handleOpenChange(false)} disabled={recording}>
            Cancel
          </Button>
          <Button type="button" loading={recording} disabled={invalid} onClick={() => void handleRecord()}>
            Record payment
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
