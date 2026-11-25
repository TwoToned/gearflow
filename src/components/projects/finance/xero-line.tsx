"use client";

import Link from "next/link";
import { toast } from "sonner";

import { useAuthedQuery } from "@/hooks/use-authed-query";
import { useXeroIntegration } from "@/hooks/use-xero-linked";
import { useServerMutation } from "@/hooks/use-server-mutation";
import { syncXeroPaymentsNow } from "@/server/xero-payment-sync";
import { xeroSyncCounts } from "@/lib/xero-sync-counts";
import { api } from "../../../../convex/_generated/api";
import { CanDo } from "@/components/auth/permission-gate";
import { Button } from "@/components/ui/button";

/**
 * Xero as ONE line on the Invoices strip (UX Phase 10, spec §8b): the connected
 * organisation, this job's synced / to push / failed counts (derived from the
 * invoices already loaded; per-row `Push to Xero` stays on the row), `Check
 * payments now` (the same server action as Settings › Xero) and a Settings link.
 * Hidden entirely when Xero is not connected. Payments reconciled in Xero show on
 * the invoice row.
 */
export function XeroLine({ projectId, orgId }: { projectId: string; orgId: string | undefined }) {
  const integration = useXeroIntegration();
  const invoices = useAuthedQuery(api.invoices.listForProject, orgId ? { orgId, projectId } : "skip");
  const check = useServerMutation({
    mutationFn: () => syncXeroPaymentsNow(),
    onSuccess: (r) => toast.success(r.settled ? `Checked ${r.checked} invoices — ${r.settled} now paid` : `Checked ${r.checked} invoices`),
    onError: (e) => toast.error(e.message),
  });
  if (integration?.isConnected !== true || invoices === undefined) return null;
  const { synced, toPush, failed } = xeroSyncCounts(invoices);
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-caption text-muted">
      <span className="font-medium text-ink-2">Xero · {integration.tenantName ?? "connected"}</span>
      <span>{synced} synced</span>
      <span>{toPush} to push</span>
      <span className={failed > 0 ? "text-error" : undefined}>{failed} failed</span>
      <CanDo resource="invoice" action="xero_push">
        <Button type="button" variant="line" size="sm" loading={check.isPending} onClick={() => check.mutate(undefined)}>
          Check payments now
        </Button>
      </CanDo>
      <Link href="/settings/xero" className="underline-offset-2 hover:underline">
        Settings
      </Link>
    </div>
  );
}
