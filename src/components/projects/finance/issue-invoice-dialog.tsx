"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Download, Eye } from "lucide-react";

import { useInvoiceWrites } from "@/hooks/use-invoice-writes";
import { useDocumentDatesConfig } from "@/hooks/use-document-dates-config";
import { computeValidUntil } from "@/lib/quote-validity";
import { formatCurrency, formatDate } from "@/lib/formatters";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
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

interface IssueInvoiceDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  invoiceId: string;
  invoiceKind: string;
  total: number;
  /** Fired once issuing succeeds — the caller uses this to offer advancing the
   *  project's status (a passive follow-up, not something this dialog forces
   *  or knows about; matches the send-quote dialog's own offer pattern). */
  onIssued?: (invoiceNumber: string) => void;
}

interface IssuedState {
  invoiceNumber: string;
  artifactReady: boolean;
}

/**
 * The invoice half of #989's issue-time parity with the quote send dialog.
 * Invoice date + due date (defaulting to invoice date + the org's
 * `paymentTermsDays`, labelled "Net N") + notes — a real dialog, not the bare
 * `issueInvoice(id)` call that used to skip the due date entirely (the
 * "every invoice issued has no due date" bug, #985). No monetary input — the
 * amount is the invoice's own already-computed total (R-9.3).
 */
export function IssueInvoiceDialog({ open, onOpenChange, projectId, invoiceId, invoiceKind, total, onIssued }: IssueInvoiceDialogProps) {
  const invoiceWrites = useInvoiceWrites();
  const dates = useDocumentDatesConfig();

  const [invoiceDateStr, setInvoiceDateStr] = useState(todayStr());
  const [dueDateStr, setDueDateStr] = useState<string | null>(null);
  const [notes, setNotes] = useState("");
  const [issuing, setIssuing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [issued, setIssued] = useState<IssuedState | null>(null);

  const invoiceDateMs = new Date(`${invoiceDateStr}T00:00:00`).getTime();
  const previewDueDate =
    dueDateStr != null
      ? new Date(`${dueDateStr}T00:00:00`).getTime()
      : Number.isFinite(invoiceDateMs)
        ? computeValidUntil(invoiceDateMs, dates.paymentTermsDays, dates.timezone)
        : null;

  function reset() {
    setInvoiceDateStr(todayStr());
    setDueDateStr(null);
    setNotes("");
    setError(null);
    setIssued(null);
  }

  function handleOpenChange(next: boolean) {
    if (!next) reset();
    onOpenChange(next);
  }

  async function handleIssue() {
    setIssuing(true);
    setError(null);
    try {
      const result = await invoiceWrites.issue(invoiceId, {
        invoiceDate: new Date(invoiceDateStr),
        dueDate: dueDateStr ? new Date(dueDateStr) : undefined,
        notes: notes || undefined,
      });
      setIssued({ invoiceNumber: result.invoiceNumber, artifactReady: result.artifactReady });
      onIssued?.(result.invoiceNumber);
      if (!result.artifactReady) {
        toast.warning("The document didn't generate yet — you can retry from the invoice row.");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to issue invoice");
    } finally {
      setIssuing(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-md">
        {!issued ? (
          <>
            <DialogHeader>
              <DialogTitle>Issue {invoiceKind.toLowerCase()} invoice</DialogTitle>
              <DialogDescription>
                Issuing assigns the invoice number and locks this invoice. Corrections need a credit note.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="invoice-date">Invoice date</Label>
                  <Input id="invoice-date" type="date" value={invoiceDateStr} onChange={(e) => setInvoiceDateStr(e.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="invoice-due-date">
                    Due date {dueDateStr == null && `(Net ${dates.paymentTermsDays})`}
                  </Label>
                  <Input
                    id="invoice-due-date"
                    type="date"
                    value={dueDateStr ?? (previewDueDate != null ? new Date(previewDueDate).toISOString().slice(0, 10) : "")}
                    onChange={(e) => setDueDateStr(e.target.value)}
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="invoice-notes">Notes</Label>
                <Textarea id="invoice-notes" value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} maxLength={2000} />
              </div>

              <div className="flex justify-between rounded-[var(--radius)] border border-line px-3 py-2.5 text-sm font-medium">
                <span>Total</span>
                <span className="tabular-nums">{formatCurrency(total)}</span>
              </div>

              {error && (
                <p role="alert" className="rounded-[var(--radius)] border-l-[3px] border-l-t-out bg-out-soft px-3 py-2 text-sm text-t-out">
                  {error}
                </p>
              )}
            </div>

            <DialogFooter>
              <Button type="button" variant="line" onClick={() => handleOpenChange(false)} disabled={issuing}>
                Cancel
              </Button>
              <Button type="button" asChild variant="line">
                <a href={`/api/documents/${projectId}?type=invoice&preview=1&invoiceId=${invoiceId}`} target="_blank" rel="noopener noreferrer">
                  <Eye className="h-3.5 w-3.5" /> Preview
                </a>
              </Button>
              <Button type="button" loading={issuing} onClick={() => void handleIssue()}>
                Issue
              </Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>{issued.invoiceNumber} issued</DialogTitle>
              <DialogDescription>Due {previewDueDate != null ? formatDate(new Date(previewDueDate)) : "—"}.</DialogDescription>
            </DialogHeader>

            {issued.artifactReady ? (
              <Button variant="line" asChild className="w-fit">
                <a href={`/api/finance/invoice/${invoiceId}/pdf`} target="_blank" rel="noopener noreferrer">
                  <Download className="h-3.5 w-3.5" /> Download PDF
                </a>
              </Button>
            ) : (
              <p className="text-sm text-warn">Document generating — we&rsquo;ll have it shortly.</p>
            )}

            <DialogFooter>
              <Button type="button" onClick={() => handleOpenChange(false)}>
                Done
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
