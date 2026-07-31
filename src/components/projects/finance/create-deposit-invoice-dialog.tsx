"use client";

import { useState } from "react";
import { toast } from "sonner";

import { useInvoiceWrites } from "@/hooks/use-invoice-writes";
import { formatCurrency } from "@/lib/formatters";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

interface CreateDepositInvoiceDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  clientId: string;
  /** The client's `profileDepositPercent` (or 25) — the % field's default. */
  defaultDepositPercent: number;
  /** The project's current tax-inclusive total — bounds the $ mode input and
   *  is shown as a hint (R-9.3: not sent to the server, just a UI hint). */
  projectTotal: number;
  onCreated?: () => void;
}

/**
 * Deposit invoice creation (#1055) — the two ways an operator can size a
 * DEPOSIT invoice: a percentage of the project's tax-inclusive total (the
 * original, still-default behaviour), or a fixed dollar amount. The server
 * (`invoicesWrites.ts createNative`) re-derives total/tax from whichever mode
 * is submitted and re-validates the $ bound — this dialog's own bound is UX
 * only.
 */
export function CreateDepositInvoiceDialog({
  open,
  onOpenChange,
  projectId,
  clientId,
  defaultDepositPercent,
  projectTotal,
  onCreated,
}: CreateDepositInvoiceDialogProps) {
  const invoiceWrites = useInvoiceWrites();
  const [mode, setMode] = useState<"%" | "$">("%");
  const [percentValue, setPercentValue] = useState(String(defaultDepositPercent));
  const [amountValue, setAmountValue] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function reset() {
    setMode("%");
    setPercentValue(String(defaultDepositPercent));
    setAmountValue("");
    setError(null);
  }

  function handleOpenChange(next: boolean) {
    if (!next) reset();
    onOpenChange(next);
  }

  const previewTotal =
    mode === "%"
      ? Math.round(projectTotal * ((Number(percentValue) || 0) / 100) * 100) / 100
      : Number(amountValue) || 0;

  async function handleCreate() {
    setCreating(true);
    setError(null);
    try {
      await invoiceWrites.create(projectId, clientId, {
        kind: "DEPOSIT",
        depositMode: mode,
        depositPercent: mode === "%" ? Number(percentValue) : undefined,
        depositAmount: mode === "$" ? Number(amountValue) : undefined,
      });
      toast.success("Deposit invoice draft created");
      onCreated?.();
      handleOpenChange(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to create deposit invoice");
    } finally {
      setCreating(false);
    }
  }

  const invalid = mode === "%" ? !(Number(percentValue) > 0) : !(Number(amountValue) > 0 && Number(amountValue) <= projectTotal);

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Create deposit invoice</DialogTitle>
          <DialogDescription>Draft only — nothing is numbered or sent until you issue it.</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="flex gap-1 rounded-[var(--radius)] border border-line p-0.5">
            {(["%", "$"] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setMode(m)}
                className={cn(
                  "flex-1 rounded-[calc(var(--radius)-2px)] py-1.5 text-sm font-medium transition-colors",
                  mode === m ? "bg-fg text-bg" : "text-fg-4 hover:text-fg",
                )}
              >
                {m === "%" ? "Percentage" : "Fixed amount"}
              </button>
            ))}
          </div>

          {mode === "%" ? (
            <div className="space-y-1.5">
              <Label htmlFor="deposit-percent">% of project total</Label>
              <Input
                id="deposit-percent"
                type="number"
                min={0}
                max={100}
                step="0.1"
                value={percentValue}
                onChange={(e) => setPercentValue(e.target.value)}
              />
            </div>
          ) : (
            <div className="space-y-1.5">
              <Label htmlFor="deposit-amount">Deposit amount</Label>
              <Input
                id="deposit-amount"
                type="number"
                min={0}
                max={projectTotal}
                step="0.01"
                value={amountValue}
                onChange={(e) => setAmountValue(e.target.value)}
                placeholder="0.00"
              />
              <p className="t-micro text-fg-4">Project total is {formatCurrency(projectTotal)}.</p>
            </div>
          )}

          <div className="flex justify-between rounded-[var(--radius)] border border-line px-3 py-2.5 text-sm font-medium">
            <span>This deposit</span>
            <span className="tabular-nums">{formatCurrency(previewTotal)}</span>
          </div>

          {error && (
            <p role="alert" className="rounded-[var(--radius)] border-l-[3px] border-l-t-out bg-out-soft px-3 py-2 text-sm text-t-out">
              {error}
            </p>
          )}
        </div>

        <DialogFooter>
          <Button type="button" variant="line" onClick={() => handleOpenChange(false)} disabled={creating}>
            Cancel
          </Button>
          <Button type="button" loading={creating} disabled={invalid} onClick={() => void handleCreate()}>
            Create draft
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
