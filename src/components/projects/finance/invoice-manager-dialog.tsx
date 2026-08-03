"use client";

import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ProjectInvoiceLedger } from "@/components/projects/finance/project-invoice-ledger";

interface InvoiceManagerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  orgId: string | undefined;
  projectNumber: string;
  clientId?: string | null;
  projectStatus?: string | null;
  total: number | null;
}

/**
 * The Overview tab's "Manage invoices" entry point (invoices manager modal
 * work) — a `Dialog` shell around the SAME `<ProjectInvoiceLedger>` the
 * Finance tab embeds: draft creation (partial/remaining balance), issuing
 * (gated server-side on the linked quote revision being ACCEPTED —
 * `invoicesWrites.ts` `issueNative`), recording payments, and voiding — with
 * zero logic duplication (POLICY.md R-3.1). The Finance tab keeps its own
 * copy by product decision — this is a faster path to the same workflow, not
 * a replacement.
 *
 * Mounted only while `open`, matching `QuoteManagerDialog`/
 * `unified-add-dialog.tsx`'s convention.
 */
export function InvoiceManagerDialog({
  open,
  onOpenChange,
  projectId,
  orgId,
  projectNumber,
  clientId,
  projectStatus,
  total,
}: InvoiceManagerDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-3xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Invoices — {projectNumber}</DialogTitle>
        </DialogHeader>
        {open && (
          <ProjectInvoiceLedger
            projectId={projectId}
            orgId={orgId}
            clientId={clientId}
            projectStatus={projectStatus}
            total={total}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
