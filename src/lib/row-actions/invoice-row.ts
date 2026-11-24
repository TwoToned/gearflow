import { Ban, FileMinus, Send, Trash2 } from "lucide-react";

import type { ActionItem } from "@/lib/primitives/types";

/**
 * The invoice row's ⋯ (UX Phase 10, spec §8b). `Issue` leaves the row and lives
 * here (2026-11-04 amendment); `Record payment` and `Push to Xero` deliberately
 * stay on the row as text links. An action that does not apply is ABSENT.
 *
 * Permission booleans mirror the `<CanDo>` gates they replace; UX only — the
 * server re-checks `invoice:issue|create|delete|void` on every write.
 *
 * Financial issue and void have NO Undo (an issued invoice is immutable and its
 * number is spent). A credit note is created as a DRAFT, which `Delete draft`
 * (confirmed, hard delete) removes — so creating one needs no Undo either.
 */

interface InvoiceMenuRow {
  status: string;
  kind: string;
}

interface Perms {
  canDelete: boolean;
  canVoid: boolean;
  canIssue: boolean;
  canCreate: boolean;
}
interface Handlers {
  onIssue: () => void;
  onCreditRequest: () => void;
  onDeleteDraft: () => void;
  onVoidRequest: () => void;
  onDeleteVoidRequest: () => void;
}

const when = (cond: boolean, item: ActionItem): ActionItem[] => (cond ? [item] : []);

function draftActions(perms: Perms, h: Handlers): ActionItem[] {
  return [
    ...when(perms.canIssue, { key: "issue", label: "Issue…", group: "organise", icon: Send, onSelect: h.onIssue }),
    ...when(perms.canDelete, { key: "delete-draft", label: "Delete draft", group: "danger", icon: Trash2, onSelect: h.onDeleteDraft, danger: true }),
  ];
}

function issuedActions(inv: InvoiceMenuRow, perms: Perms, h: Handlers, hasCreditNote: boolean): ActionItem[] {
  const canCredit = inv.kind !== "CREDIT" && perms.canCreate && !hasCreditNote;
  return [
    ...when(canCredit, { key: "credit-note", label: "Credit note…", group: "organise", icon: FileMinus, onSelect: h.onCreditRequest }),
    ...when(perms.canVoid, { key: "void", label: "Void invoice", group: "danger", icon: Ban, onSelect: h.onVoidRequest, danger: true }),
  ];
}

function voidActions(perms: Perms, h: Handlers): ActionItem[] {
  return when(perms.canDelete, { key: "delete-void", label: "Delete permanently", group: "danger", icon: Trash2, onSelect: h.onDeleteVoidRequest, danger: true });
}

export function invoiceRowMenuActions(
  inv: InvoiceMenuRow,
  perms: Perms,
  handlers: Handlers,
  /** An un-voided credit note already exists against this invoice. */
  hasCreditNote = false,
): ActionItem[] {
  if (inv.status === "DRAFT") return draftActions(perms, handlers);
  if (inv.status === "ISSUED") return issuedActions(inv, perms, handlers, hasCreditNote);
  if (inv.status === "VOID") return voidActions(perms, handlers);
  return [];
}
