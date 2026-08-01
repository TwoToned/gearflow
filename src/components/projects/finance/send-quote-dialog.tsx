"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Download, Eye } from "lucide-react";

import { useQuoteWrites } from "@/hooks/use-quote-writes";
import { useClientContacts } from "@/hooks/use-clients";
import { useDocumentDatesConfig } from "@/hooks/use-document-dates-config";
import { useNativeProjectStatus } from "@/hooks/use-native-project-writes";
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
import { ComboboxPicker } from "@/components/ui/combobox-picker";
import type { QuoteStatusOffer } from "@/hooks/use-quote-writes";

function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

interface SendQuoteDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  projectNumber: string;
  orgId: string | undefined;
  clientId?: string | null;
  /** The revision this send will freeze — `projects.revision` before the send. */
  revision: number;
  /** #1080/#1097 — the outgoing draft's internal label, if one was set (via
   *  "Rename version" on the row, or carried over from `saveVersionNative`).
   *  Drives the "print this label on the document" checkbox below. */
  currentLabel?: string;
  subtotal: number | null;
  taxAmount: number | null;
  total: number | null;
  projectStatus?: string | null;
}

interface SentState {
  version: number;
  validUntil: number;
  quoteId: string;
  artifactReady: boolean;
  offerStatusChange: QuoteStatusOffer;
}

/**
 * The one place a quote leaves the building (#989 §4). Captures quote date +
 * validity + recipient + notes — NO monetary input (R-9.3), the read-only
 * summary below comes straight from the project's own recalc-owned totals.
 *
 * Does not close on success — it becomes the handover: download the PDF, copy
 * a summary for the user's own email, and (if applicable) a passive offer to
 * advance the project's status. Flow does not email the client itself
 * (decision 7) — the footer says so outright.
 */
export function SendQuoteDialog({
  open,
  onOpenChange,
  projectId,
  projectNumber,
  orgId,
  clientId,
  revision,
  currentLabel,
  subtotal,
  taxAmount,
  total,
  projectStatus,
}: SendQuoteDialogProps) {
  const quoteWrites = useQuoteWrites();
  const contacts = useClientContacts(clientId ?? undefined, orgId);
  const dates = useDocumentDatesConfig();
  const { updateStatus } = useNativeProjectStatus(orgId);

  const [quoteDateStr, setQuoteDateStr] = useState(todayStr());
  const [validityDays, setValidityDays] = useState<number | null>(null);
  const [recipientContactId, setRecipientContactId] = useState("");
  const [notes, setNotes] = useState("");
  const [labelOnDocument, setLabelOnDocument] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<SentState | null>(null);
  const [statusMoved, setStatusMoved] = useState(false);

  const resolvedValidityDays = validityDays ?? dates.quoteValidityDays;
  const quoteDateMs = new Date(`${quoteDateStr}T00:00:00`).getTime();
  const previewValidUntil = Number.isFinite(quoteDateMs)
    ? computeValidUntil(quoteDateMs, resolvedValidityDays, dates.timezone)
    : null;

  function reset() {
    setQuoteDateStr(todayStr());
    setValidityDays(null);
    setRecipientContactId("");
    setNotes("");
    setLabelOnDocument(false);
    setError(null);
    setSent(null);
    setStatusMoved(false);
  }

  function handleOpenChange(next: boolean) {
    if (!next) reset();
    onOpenChange(next);
  }

  async function handleSend() {
    setSending(true);
    setError(null);
    try {
      const result = await quoteWrites.send(projectId, {
        quoteDate: new Date(quoteDateStr),
        validityDays: resolvedValidityDays,
        recipientContactId: recipientContactId || undefined,
        notes: notes || undefined,
        labelOnDocument,
      });
      setSent({
        version: result.version,
        validUntil: result.validUntil,
        quoteId: result.id,
        artifactReady: result.artifactReady,
        offerStatusChange: result.offerStatusChange,
      });
      if (!result.artifactReady) {
        toast.warning("The document didn't generate yet — you can retry from the revision row.");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to send quote");
    } finally {
      setSending(false);
    }
  }

  async function handleMoveStatus() {
    if (!sent?.offerStatusChange) return;
    try {
      await updateStatus(projectId, sent.offerStatusChange);
      setStatusMoved(true);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to update status");
    }
  }

  function copySummary() {
    const lines = [
      `Quote — ${projectNumber} v${sent?.version ?? revision}`,
      subtotal != null ? `Subtotal: ${formatCurrency(subtotal)}` : null,
      taxAmount != null ? `GST: ${formatCurrency(taxAmount)}` : null,
      total != null ? `Total: ${formatCurrency(total)}` : null,
      sent ? `Valid until: ${formatDate(new Date(sent.validUntil))}` : null,
    ].filter(Boolean);
    void navigator.clipboard.writeText(lines.join("\n"));
    toast.success("Summary copied");
  }

  const contactOptions = (contacts ?? []).map((c) => ({
    value: c.id,
    label: c.name || c.email || "Unnamed contact",
    description: c.email || undefined,
  }));

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-lg">
        {!sent ? (
          <SendQuoteForm
            revision={revision}
            currentLabel={currentLabel}
            labelOnDocument={labelOnDocument}
            onLabelOnDocumentChange={setLabelOnDocument}
            projectId={projectId}
            clientId={clientId}
            quoteDateStr={quoteDateStr}
            onQuoteDateChange={setQuoteDateStr}
            resolvedValidityDays={resolvedValidityDays}
            onValidityDaysChange={setValidityDays}
            previewValidUntil={previewValidUntil}
            recipientContactId={recipientContactId}
            onRecipientChange={setRecipientContactId}
            contactOptions={contactOptions}
            notes={notes}
            onNotesChange={setNotes}
            subtotal={subtotal}
            taxAmount={taxAmount}
            total={total}
            error={error}
            sending={sending}
            onCancel={() => handleOpenChange(false)}
            onSend={() => void handleSend()}
          />
        ) : (
          <SendQuoteHandover
            sent={sent}
            projectStatus={projectStatus}
            statusMoved={statusMoved}
            onCopySummary={copySummary}
            onMoveStatus={() => void handleMoveStatus()}
            onDone={() => handleOpenChange(false)}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

interface SendQuoteFormProps {
  revision: number;
  currentLabel?: string;
  labelOnDocument: boolean;
  onLabelOnDocumentChange: (value: boolean) => void;
  projectId: string;
  clientId?: string | null;
  quoteDateStr: string;
  onQuoteDateChange: (value: string) => void;
  resolvedValidityDays: number;
  onValidityDaysChange: (value: number | null) => void;
  previewValidUntil: number | null;
  recipientContactId: string;
  onRecipientChange: (value: string) => void;
  contactOptions: { value: string; label: string; description?: string }[];
  notes: string;
  onNotesChange: (value: string) => void;
  subtotal: number | null;
  taxAmount: number | null;
  total: number | null;
  error: string | null;
  sending: boolean;
  onCancel: () => void;
  onSend: () => void;
}

function SendQuoteForm({
  revision,
  currentLabel,
  labelOnDocument,
  onLabelOnDocumentChange,
  projectId,
  clientId,
  quoteDateStr,
  onQuoteDateChange,
  resolvedValidityDays,
  onValidityDaysChange,
  previewValidUntil,
  recipientContactId,
  onRecipientChange,
  contactOptions,
  notes,
  onNotesChange,
  subtotal,
  taxAmount,
  total,
  error,
  sending,
  onCancel,
  onSend,
}: SendQuoteFormProps) {
  return (
    <>
      <DialogHeader>
        <DialogTitle>Send quote v{revision}</DialogTitle>
        <DialogDescription>
          Sending freezes pricing at v{revision}. To change prices afterwards, create v{revision + 1}.
        </DialogDescription>
      </DialogHeader>

      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="quote-date">Quote date</Label>
            <Input
              id="quote-date"
              type="date"
              value={quoteDateStr}
              onChange={(e) => onQuoteDateChange(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="quote-validity">Valid for (days)</Label>
            <Input
              id="quote-validity"
              type="number"
              min={1}
              max={365}
              value={resolvedValidityDays}
              onChange={(e) => onValidityDaysChange(e.target.valueAsNumber || null)}
            />
          </div>
        </div>
        {previewValidUntil != null && (
          <p className="text-xs text-fg-4">
            Valid until <span className="font-medium text-fg">{formatDate(new Date(previewValidUntil))}</span>
          </p>
        )}

        <div className="space-y-1.5">
          <Label>Send to</Label>
          {clientId ? (
            <ComboboxPicker
              value={recipientContactId}
              onChange={onRecipientChange}
              options={contactOptions}
              placeholder="Select a contact…"
              searchPlaceholder="Search contacts…"
              emptyMessage="No contacts on this client."
              allowClear
            />
          ) : (
            <p className="text-xs text-fg-4">Assign a client to this project to pick a recipient.</p>
          )}
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="quote-notes">Notes to client</Label>
          <Textarea
            id="quote-notes"
            value={notes}
            onChange={(e) => onNotesChange(e.target.value)}
            placeholder="Optional notes printed on the quote"
            rows={2}
            maxLength={2000}
          />
        </div>

        {currentLabel && (
          <label className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              className="mt-0.5"
              checked={labelOnDocument}
              onChange={(e) => onLabelOnDocumentChange(e.target.checked)}
            />
            <span>
              Print this label on the document —{" "}
              <span className="font-medium text-fg">&ldquo;{currentLabel}&rdquo;</span> will appear next to the version
              number in the PDF header. Off by default: an unexplained label on a client document invites the
              obvious question about what the other options were.
            </span>
          </label>
        )}

        <div className="space-y-1 rounded-[var(--radius)] border border-line px-3 py-2.5 text-sm">
          <p className="t-overline text-fg-3">Summary</p>
          {subtotal != null && <div className="flex justify-between"><span className="text-fg-4">Subtotal</span><span className="tabular-nums">{formatCurrency(subtotal)}</span></div>}
          {taxAmount != null && <div className="flex justify-between"><span className="text-fg-4">GST</span><span className="tabular-nums">{formatCurrency(taxAmount)}</span></div>}
          {total != null && <div className="flex justify-between font-medium"><span>Total</span><span className="tabular-nums">{formatCurrency(total)}</span></div>}
        </div>

        {error && (
          <p role="alert" className="rounded-[var(--radius)] border-l-[3px] border-l-t-out bg-out-soft px-3 py-2 text-sm text-t-out">
            {error}
          </p>
        )}

        <p className="text-xs text-fg-4">
          Flow doesn&rsquo;t email clients — this generates the PDF for you to send.
        </p>
      </div>

      <DialogFooter>
        <Button type="button" variant="line" onClick={onCancel} disabled={sending}>
          Cancel
        </Button>
        <Button type="button" asChild variant="line">
          <a href={`/api/documents/${projectId}?type=quote&preview=1`} target="_blank" rel="noopener noreferrer">
            <Eye className="h-3.5 w-3.5" /> Preview draft
          </a>
        </Button>
        <Button type="button" loading={sending} onClick={onSend}>
          Send quote
        </Button>
      </DialogFooter>
    </>
  );
}

function SendQuoteHandover({
  sent,
  projectStatus,
  statusMoved,
  onCopySummary,
  onMoveStatus,
  onDone,
}: {
  sent: SentState;
  projectStatus?: string | null;
  statusMoved: boolean;
  onCopySummary: () => void;
  onMoveStatus: () => void;
  onDone: () => void;
}) {
  return (
    <>
      <DialogHeader>
        <DialogTitle>Quote v{sent.version} sent</DialogTitle>
        <DialogDescription>
          Pricing is now locked at v{sent.version}. Valid until {formatDate(new Date(sent.validUntil))}.
        </DialogDescription>
      </DialogHeader>

      <div className="flex flex-wrap gap-2">
        {sent.artifactReady ? (
          <Button variant="line" asChild>
            <a href={`/api/finance/quote/${sent.quoteId}/pdf`} target="_blank" rel="noopener noreferrer">
              <Download className="h-3.5 w-3.5" /> Download PDF
            </a>
          </Button>
        ) : (
          <p className="text-sm text-warn">Document generating — we&rsquo;ll have it shortly.</p>
        )}
        <Button type="button" variant="line" onClick={onCopySummary}>
          Copy summary for email
        </Button>
      </div>

      {sent.offerStatusChange && !statusMoved && projectStatus !== sent.offerStatusChange && (
        <p className="rounded-[var(--radius)] border border-line px-3 py-2 text-sm">
          This job is at {projectStatus}. Move it to {sent.offerStatusChange}?{" "}
          <button type="button" className="font-semibold underline underline-offset-2" onClick={onMoveStatus}>
            Move
          </button>
        </p>
      )}

      <DialogFooter>
        <Button type="button" onClick={onDone}>
          Done
        </Button>
      </DialogFooter>
    </>
  );
}
