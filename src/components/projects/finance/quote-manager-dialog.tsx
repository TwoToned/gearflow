"use client";

import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ProjectQuoteRail, ASSIGN_CLIENT_FOR_QUOTES_MESSAGE } from "@/components/projects/project-quote-rail";

interface QuoteManagerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  orgId: string | undefined;
  projectNumber: string;
  clientId?: string | null;
  projectStatus?: string | null;
  subtotal: number | null;
  taxAmount: number | null;
  total: number | null;
}

/**
 * The Overview tab's "Manage quotes" entry point (invoices manager modal
 * work) — a `Dialog` shell around the SAME `<ProjectQuoteRail>` the Finance
 * tab embeds, so every verb (send, accept, decline, new version, promote,
 * recall, correct, protect, delete) is available here with zero logic
 * duplication (POLICY.md R-3.1). The Finance tab keeps its own copy of the
 * rail by product decision — this is a faster path to the same workflow, not
 * a replacement.
 *
 * Mounted only while `open` (matches `unified-add-dialog.tsx`'s convention)
 * so the rail's own dialog state doesn't linger stale between opens.
 */
export function QuoteManagerDialog({
  open,
  onOpenChange,
  projectId,
  orgId,
  projectNumber,
  clientId,
  projectStatus,
  subtotal,
  taxAmount,
  total,
}: QuoteManagerDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-3xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Quotes — {projectNumber}</DialogTitle>
        </DialogHeader>
        {open && clientId && (
          <ProjectQuoteRail
            projectId={projectId}
            orgId={orgId}
            projectNumber={projectNumber}
            clientId={clientId}
            projectStatus={projectStatus}
            subtotal={subtotal}
            taxAmount={taxAmount}
            total={total}
          />
        )}
        {open && !clientId && (
          <p className="t-micro text-fg-4">{ASSIGN_CLIENT_FOR_QUOTES_MESSAGE}</p>
        )}
      </DialogContent>
    </Dialog>
  );
}
