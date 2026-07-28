"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Send, Ban, Trash2, UploadCloud, AlertCircle } from "lucide-react";

import { useAuthedQuery } from "@/hooks/use-authed-query";
import { useActiveOrganization } from "@/lib/auth-client";
import { api } from "../../../convex/_generated/api";
import { ProjectQuoteRail } from "@/components/projects/project-quote-rail";
import { useInvoiceWrites } from "@/hooks/use-invoice-writes";
import { useNativeProjectStatus } from "@/hooks/use-native-project-writes";
import { useXeroLinked } from "@/hooks/use-xero-linked";
import { pushInvoiceToXero } from "@/server/xero";
import { useServerMutation } from "@/hooks/use-server-mutation";
import { formatCurrency, formatDate } from "@/lib/formatters";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { CanDo } from "@/components/auth/permission-gate";

interface ProjectFinancePanelProps {
  projectId: string;
  clientId?: string | null;
  projectStatus?: string | null;
}

const INVOICE_STATUS_BADGE: Record<string, "ok" | "warn" | "neutral" | "overbooked"> = {
  DRAFT: "neutral",
  ISSUED: "ok",
  VOID: "overbooked",
};

/**
 * WS1 (#940), reworked by #986 — the project's Quotes & Invoices workflow.
 *
 * The quote half is now a REVISION RAIL over `projects.revision`
 * (`<ProjectQuoteRail>`): send the current revision (freezing its pricing and
 * capturing a snapshot), recall it, cut the next version, or record the client's
 * accept/decline. Sending does NOT email anyone — it records the send and
 * freezes the numbers.
 *
 * Invoices are unchanged: create/issue/void per the client's payment profile,
 * and (Xero-linked orgs) push an issued invoice as a Xero draft. "Deposit not
 * yet invoiced" nudge chips are DERIVED (kind/status of existing invoices), not
 * a stored flag — there is no READY_TO_INVOICE project status.
 *
 * The full Finance tab — send dialog, version history + diffs, invoice issue
 * dialog with due dates, drift indicator — is Phase D (#989).
 */
export function ProjectFinancePanel({ projectId, clientId, projectStatus }: ProjectFinancePanelProps) {
  const { data: activeOrg } = useActiveOrganization();
  const orgId = activeOrg?.id;
  const xeroLinked = useXeroLinked();

  const invoices = useAuthedQuery(api.invoices.listForProject, orgId ? { orgId, projectId } : "skip");
  const client = useAuthedQuery(api.clients.getById, clientId ? { id: clientId } : "skip");

  const invoiceWrites = useInvoiceWrites();
  const { updateStatus } = useNativeProjectStatus(orgId);

  const [voidTarget, setVoidTarget] = useState<{ id: string; number: string } | null>(null);
  const [voidReason, setVoidReason] = useState("");

  if (!clientId) {
    return <p className="t-micro text-fg-4">Assign a client to this project to generate quotes and invoices.</p>;
  }
  if (invoices === undefined || client === undefined) {
    return <p className="t-micro text-fg-4">Loading…</p>;
  }

  const paymentProfile = (client?.paymentProfile as string | undefined) ?? "FULL_UPFRONT";
  const depositPercent = (client?.profileDepositPercent as number | undefined) ?? 25;

  const nonVoidInvoices = invoices.filter((inv) => inv.status !== "VOID");
  const hasDeposit = nonVoidInvoices.some((inv) => inv.kind === "DEPOSIT");
  const hasBalance = nonVoidInvoices.some((inv) => inv.kind === "BALANCE");
  const hasFull = nonVoidInvoices.some((inv) => inv.kind === "FULL");
  const depositIssued = nonVoidInvoices.some((inv) => inv.kind === "DEPOSIT" && inv.status === "ISSUED");

  async function createInvoice(kind: "FULL" | "DEPOSIT" | "BALANCE") {
    try {
      await invoiceWrites.create(projectId, clientId!, {
        kind,
        depositPercent: kind === "DEPOSIT" ? depositPercent : undefined,
      });
      toast.success(`${kind} invoice draft created`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to create invoice");
    }
  }

  async function issueInvoice(id: string) {
    try {
      const result = await invoiceWrites.issue(id);
      toast.success(`Issued ${result.invoiceNumber}`);
      // UI chain (not a nested mutation) — offer to advance the project once a
      // BALANCE/FULL invoice is issued (spec: "issuing offers to advance status").
      const invoice = invoices?.find((i) => i.id === id);
      if (
        (invoice?.kind === "BALANCE" || invoice?.kind === "FULL") &&
        projectStatus &&
        projectStatus !== "INVOICED" &&
        projectStatus !== "COMPLETED"
      ) {
        if (window.confirm("Advance this project's status to INVOICED?")) {
          await updateStatus(projectId, "INVOICED");
        }
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to issue invoice");
    }
  }

  async function confirmVoid() {
    if (!voidTarget) return;
    try {
      await invoiceWrites.void(voidTarget.id, voidReason);
      toast.success(`Voided ${voidTarget.number}`);
      setVoidTarget(null);
      setVoidReason("");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to void invoice");
    }
  }

  return (
    <div className="space-y-6">
      {/* Quote revisions (#986) */}
      <ProjectQuoteRail projectId={projectId} orgId={orgId} />

      {/* Nudge chips */}
      {paymentProfile === "DEPOSIT_BALANCE" ? (
        <div className="flex flex-wrap gap-2">
          {!hasDeposit && (
            <NudgeChip label={`Deposit not yet invoiced (${depositPercent}%)`} action="Create deposit invoice" onAction={() => void createInvoice("DEPOSIT")} />
          )}
          {depositIssued && !hasBalance && (
            <NudgeChip label="Balance not yet invoiced" action="Create balance invoice" onAction={() => void createInvoice("BALANCE")} />
          )}
        </div>
      ) : (
        !hasFull && (
          <div className="flex flex-wrap gap-2">
            <NudgeChip label="Not yet invoiced" action="Create invoice" onAction={() => void createInvoice("FULL")} />
          </div>
        )
      )}

      {/* Invoices list */}
      <div className="space-y-2">
        <h3 className="t-overline text-fg-3">Invoices</h3>
        {invoices.length === 0 ? (
          <p className="t-micro text-fg-4">No invoices yet.</p>
        ) : (
          <ul className="space-y-1.5">
            {invoices.map((inv) => (
              <InvoiceRow
                key={inv.id}
                invoice={inv}
                xeroLinked={xeroLinked}
                onIssue={() => void issueInvoice(inv.id)}
                onDeleteDraft={() =>
                  void invoiceWrites.deleteDraft(inv.id).then(() => toast.success("Draft deleted")).catch((e) => toast.error(e instanceof Error ? e.message : "Failed"))
                }
                onVoidRequest={() => setVoidTarget({ id: inv.id, number: inv.invoiceNumber ?? inv.id })}
              />
            ))}
          </ul>
        )}
      </div>

      <Dialog open={!!voidTarget} onOpenChange={(open) => !open && setVoidTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Void {voidTarget?.number}</DialogTitle>
          </DialogHeader>
          <Textarea
            value={voidReason}
            onChange={(e) => setVoidReason(e.target.value)}
            placeholder="Why is this invoice being voided?"
            rows={3}
          />
          <DialogFooter>
            <Button type="button" variant="line" onClick={() => setVoidTarget(null)}>Cancel</Button>
            <Button type="button" disabled={voidReason.trim().length === 0} onClick={() => void confirmVoid()}>Void invoice</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

interface InvoiceRowDoc {
  id: string;
  status: string;
  kind: string;
  invoiceNumber?: string;
  total: number;
  xeroSyncStatus?: string;
  lastSyncError?: string;
}

function InvoiceRow({
  invoice: inv,
  xeroLinked,
  onIssue,
  onDeleteDraft,
  onVoidRequest,
}: {
  invoice: InvoiceRowDoc;
  xeroLinked: boolean;
  onIssue: () => void;
  onDeleteDraft: () => void;
  onVoidRequest: () => void;
}) {
  return (
    <li className="flex flex-wrap items-center justify-between gap-2 rounded-[var(--r)] border border-line px-3 py-2 text-table-cell">
      <div className="flex min-w-0 items-center gap-2">
        <Badge status={INVOICE_STATUS_BADGE[inv.status] ?? "neutral"}>{inv.status}</Badge>
        <span className="font-medium text-fg">{inv.invoiceNumber ?? `${inv.kind} (draft)`}</span>
        <span className="text-fg-4">{formatCurrency(inv.total)}</span>
        {inv.xeroSyncStatus === "SYNCED" && <Badge status="ok">Synced to Xero</Badge>}
        {inv.xeroSyncStatus === "ERROR" && (
          <span className="flex items-center gap-1 text-destructive" title={inv.lastSyncError}>
            <AlertCircle className="h-3.5 w-3.5" /> Xero push failed
          </span>
        )}
      </div>
      <div className="flex items-center gap-1.5">
        {inv.status === "DRAFT" && (
          <CanDo resource="invoice" action="issue">
            <Button type="button" variant="line" size="sm" onClick={onIssue}>
              <Send className="h-3.5 w-3.5" /> Issue
            </Button>
          </CanDo>
        )}
        {inv.status === "DRAFT" && (
          <CanDo resource="invoice" action="delete">
            <Button type="button" variant="line" size="sm" onClick={onDeleteDraft}>
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </CanDo>
        )}
        {inv.status === "ISSUED" && (
          <CanDo resource="invoice" action="void">
            <Button type="button" variant="line" size="sm" onClick={onVoidRequest}>
              <Ban className="h-3.5 w-3.5" /> Void
            </Button>
          </CanDo>
        )}
        {xeroLinked && inv.status === "ISSUED" && inv.xeroSyncStatus !== "SYNCED" && (
          <CanDo resource="invoice" action="xero_push">
            <PushToXeroButton invoiceId={inv.id} />
          </CanDo>
        )}
      </div>
    </li>
  );
}

function NudgeChip({ label, action, onAction }: { label: string; action: string; onAction: () => void }) {
  return (
    <div className="flex items-center gap-2 rounded-full border border-warn/40 bg-warn-soft px-3 py-1.5 text-caption text-warn">
      <span>{label}</span>
      <CanDo resource="invoice" action="create">
        <button type="button" onClick={onAction} className="font-semibold underline underline-offset-2">
          {action}
        </button>
      </CanDo>
    </div>
  );
}

function PushToXeroButton({ invoiceId }: { invoiceId: string }) {
  const pushMutation = useServerMutation({
    mutationFn: () => pushInvoiceToXero(invoiceId),
    onSuccess: (r) => {
      toast.success(r.autoCreatedContact ? "Pushed to Xero (new contact created)" : "Pushed to Xero");
      if (r.varianceNote) toast.warning(r.varianceNote);
    },
    onError: (e) => toast.error(e.message),
  });
  return (
    <Button type="button" size="sm" loading={pushMutation.isPending} onClick={() => pushMutation.mutate(undefined)}>
      <UploadCloud className="h-3.5 w-3.5" /> Push to Xero
    </Button>
  );
}
