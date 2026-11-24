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

export function invoiceRowMenuActions(
  inv: InvoiceMenuRow,
  perms: { canDelete: boolean; canVoid: boolean; canIssue: boolean; canCreate: boolean },
  handlers: {
    onIssue: () => void;
    onCreditRequest: () => void;
    onDeleteDraft: () => void;
    onVoidRequest: () => void;
    onDeleteVoidRequest: () => void;
  },
  /** An un-voided credit note already exists against this invoice. */
  hasCreditNote = false,
): ActionItem[] {
  const actions: ActionItem[] = [];
  if (inv.status === "DRAFT" && perms.canIssue) {
    actions.push({ key: "issue", label: "Issue…", group: "organise", icon: Send, onSelect: handlers.onIssue });
  }
  if (inv.status === "ISSUED" && inv.kind !== "CREDIT" && perms.canCreate && !hasCreditNote) {
    actions.push({ key: "credit-note", label: "Credit note…", group: "organise", icon: FileMinus, onSelect: handlers.onCreditRequest });
  }
  if (inv.status === "DRAFT" && perms.canDelete) {
    actions.push({ key: "delete-draft", label: "Delete draft", group: "danger", icon: Trash2, onSelect: handlers.onDeleteDraft, danger: true });
  }
  if (inv.status === "ISSUED" && perms.canVoid) {
    actions.push({ key: "void", label: "Void invoice", group: "danger", icon: Ban, onSelect: handlers.onVoidRequest, danger: true });
  }
  if (inv.status === "VOID" && perms.canDelete) {
    actions.push({ key: "delete-void", label: "Delete permanently", group: "danger", icon: Trash2, onSelect: handlers.onDeleteVoidRequest, danger: true });
  }
  return actions;
}
