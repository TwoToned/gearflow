import { Check, Copy, ExternalLink, Eye, FilePlus, FileText, Send, Trash2, Wallet, Ban } from "lucide-react";

import type { ActionItem, ActionMenuSpec, BulkAction } from "@/lib/primitives/types";
import type { InvoiceSource, QuoteSource } from "@/lib/list-views/finance";

/**
 * The Finance hub's row ⋯ and bulk verbs (UX Phase 17, spec §9j.2). Pure: an omitted handler means the
 * caller cannot do it (no permission), so the verb is ABSENT, never disabled; every verb calls an EXISTING
 * write or route (the hub invents none). Destructive verbs (`Void…`, `Delete draft…`) go last, red, and
 * carry a confirm that says what stays.
 *
 * The status words these read are the server's DERIVED ones (the quote's effective status, the invoice's
 * one pill); nothing here looks at a stored column. `Chase` is copy-only (D54): Flow never emails a client.
 */

type Entry = ActionItem | false | undefined | null;
const compact = (entries: Entry[]): ActionItem[] => entries.filter((e): e is ActionItem => !!e);

/** One verb: present only when its handler was given (the caller may do it) AND every condition holds. */
function verb(handler: (() => void | Promise<void>) | undefined, conditions: boolean[], spec: Omit<ActionItem, "onSelect">): Entry {
  return handler && conditions.every(Boolean) ? { ...spec, onSelect: handler } : null;
}

/** Which stored-document verb a row offers (never a regenerate: Generate only fills an empty slot). */
export function pdfVerb(row: { hasPdf: boolean; draft: boolean }): "open" | "preview" | "generate" {
  if (row.hasPdf) return "open";
  return row.draft ? "preview" : "generate";
}

export interface QuoteMenuCtx {
  onOpenJob: () => void;
  /** Streams the STORED bytes (`/api/finance/quote/{id}/pdf`). */
  onOpenPdf?: () => void;
  /** A draft only previews (watermarked, never stored). */
  onPreview?: () => void;
  /** Attach-once: fills a missing stored copy, never replaces one. Needs `invoice:publish`. */
  onGeneratePdf?: () => void;
  onAccept?: () => void;
  onAcknowledge?: () => void;
  onChase?: () => void;
}

export function buildQuoteHubActions(q: Pick<QuoteSource, "status" | "dismissed" | "hasPdf">, ctx: QuoteMenuCtx): ActionMenuSpec {
  const draft = q.status === "DRAFT";
  const sentLike = q.status === "SENT" || q.status === "EXPIRED";
  const pdf = pdfVerb({ hasPdf: q.hasPdf, draft });
  return {
    items: compact([
      { key: "open", label: "Open on the job", group: "edit", icon: ExternalLink, onSelect: ctx.onOpenJob },
      pdf === "open" && verb(ctx.onOpenPdf, [true], { key: "pdf", label: "Open PDF", group: "documents", icon: FileText }),
      pdf === "preview" && verb(ctx.onPreview, [true], { key: "preview", label: "Preview draft", group: "documents", icon: Eye }),
      pdf === "generate" && verb(ctx.onGeneratePdf, [!draft], { key: "generate", label: "Generate PDF", group: "documents", icon: FilePlus }),
      verb(ctx.onAccept, [sentLike], { key: "accept", label: "Mark accepted…", group: "organise", icon: Check }),
      verb(ctx.onAcknowledge, [q.status === "EXPIRED", !q.dismissed], { key: "ack", label: "Acknowledge expired", group: "organise" }),
      verb(ctx.onChase, [sentLike], { key: "chase", label: "Chase", group: "reporting", icon: Copy }),
    ]),
  };
}

export interface InvoiceMenuCtx {
  onOpenJob: () => void;
  onOpenPdf?: () => void;
  onPreview?: () => void;
  onGeneratePdf?: () => void;
  onRecordPayment?: () => void;
  onChase?: () => void;
  onPushXero?: () => void;
  /** Opens the Void dialog (it collects the reason). */
  onVoid?: () => void;
  onDeleteDraft?: () => void;
}

const UNSETTLED = new Set(["ISSUED", "PART_PAID", "OVERDUE"]);

export function buildInvoiceHubActions(
  i: Pick<InvoiceSource, "pill" | "hasPdf" | "kind" | "xero" | "invoiceNumber">,
  ctx: InvoiceMenuCtx,
): ActionMenuSpec {
  const draft = i.pill === "DRAFT";
  const void_ = i.pill === "VOID";
  const unsettled = UNSETTLED.has(i.pill) && i.kind !== "CREDIT";
  const pdf = pdfVerb({ hasPdf: i.hasPdf, draft });
  const needsXero = i.xero != null && (i.xero.status === "NOT_SYNCED" || i.xero.status === "ERROR");
  const label = i.invoiceNumber ?? "this draft";
  return {
    items: compact([
      { key: "open", label: "Open on the job", group: "edit", icon: ExternalLink, onSelect: ctx.onOpenJob },
      pdf === "open" && verb(ctx.onOpenPdf, [true], { key: "pdf", label: "Open PDF", group: "documents", icon: FileText }),
      pdf === "preview" && verb(ctx.onPreview, [true], { key: "preview", label: "Preview draft", group: "documents", icon: Eye }),
      pdf === "generate" && verb(ctx.onGeneratePdf, [!draft, !void_], { key: "generate", label: "Generate PDF", group: "documents", icon: FilePlus }),
      verb(ctx.onRecordPayment, [unsettled], { key: "pay", label: "Record payment…", group: "organise", icon: Wallet }),
      verb(ctx.onChase, [unsettled], { key: "chase", label: "Chase", group: "reporting", icon: Copy }),
      verb(ctx.onPushXero, [needsXero], { key: "xero", label: i.xero?.status === "ERROR" ? "Retry push to Xero" : "Push to Xero", group: "organise", icon: Send }),
      verb(ctx.onVoid, [unsettled || i.pill === "PAID"], {
        key: "void",
        label: "Void…",
        group: "danger",
        icon: Ban,
        danger: true,
      }),
      verb(ctx.onDeleteDraft, [draft], {
        key: "delete",
        label: "Delete draft…",
        group: "danger",
        icon: Trash2,
        danger: true,
        confirm: {
          title: `Delete ${label}?`,
          body: "The draft is removed. It has no number yet, nothing was sent, and the job's money does not change. This can't be undone.",
          confirmLabel: "Delete draft",
        },
      }),
    ]),
  };
}

/** What the Void dialog says (spec §9j.2): what stays, what changes, and what blocks it. */
export const VOID_INVOICE_COPY = {
  title: (label: string) => `Void ${label}?`,
  body:
    "The number stays used and the document stays on record (the client may be holding it). If it is in Xero it is voided there too, and the job's money is recounted. A recorded payment blocks a void: void the payment first.",
  confirmLabel: "Void invoice",
};

// ─── Bulk ────────────────────────────────────────────────────────────────

export interface QuoteBulkCtx {
  onChaseMany?: () => void;
  onAcknowledgeMany?: () => void;
  onExport: () => void;
}

export function quoteHubBulk(ctx: QuoteBulkCtx): BulkAction[] {
  const out: (BulkAction | null)[] = [
    ctx.onChaseMany ? { key: "chase", label: (n) => `Chase ${n}`, group: "reporting", icon: Copy, onSelect: ctx.onChaseMany } : null,
    ctx.onAcknowledgeMany ? { key: "ack", label: (n) => `Acknowledge ${n}`, group: "organise", onSelect: ctx.onAcknowledgeMany } : null,
    { key: "export", label: (n) => `Export ${n}`, group: "reporting", onSelect: ctx.onExport },
  ];
  return out.filter((b): b is BulkAction => b != null);
}

export interface InvoiceBulkCtx {
  onChaseMany?: () => void;
  onSyncXeroMany?: () => void;
  onExport: () => void;
  onDeleteDraftsMany?: () => void;
}

export function invoiceHubBulk(ctx: InvoiceBulkCtx): BulkAction[] {
  const out: (BulkAction | null)[] = [
    ctx.onChaseMany ? { key: "chase", label: (n) => `Chase ${n}`, group: "reporting", icon: Copy, onSelect: ctx.onChaseMany } : null,
    ctx.onSyncXeroMany ? { key: "xero", label: (n) => `Sync to Xero ${n}`, group: "organise", icon: Send, onSelect: ctx.onSyncXeroMany } : null,
    { key: "export", label: (n) => `Export ${n}`, group: "reporting", onSelect: ctx.onExport },
    ctx.onDeleteDraftsMany
      ? {
          key: "delete",
          label: (n) => `Delete ${n} drafts`,
          group: "danger",
          danger: true,
          icon: Trash2,
          onSelect: ctx.onDeleteDraftsMany,
          confirm: {
            title: "Delete the selected drafts?",
            body: "Only drafts are deleted (they have no number and nothing was sent); anything else you selected is skipped, and the toast says which. This can't be undone.",
            confirmLabel: "Delete drafts",
          },
        }
      : null,
  ];
  return out.filter((b): b is BulkAction => b != null);
}
