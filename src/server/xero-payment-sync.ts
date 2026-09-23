"use server";

/**
 * Xero payment sync — the fetch half (follow-up automation phase 2,
 * FEATUREDOCS/82, design §8.5). For every org with a live Xero connection, read
 * back the invoice-level state (Status / AmountPaid / AmountCredited / AmountDue)
 * of the Flow invoices it pushed that Flow doesn't yet know are settled, and
 * hand it to the service-only `xeroPaymentSync.applyXeroInvoiceStates`, which
 * recomputes `paymentStatus`, fires PAYMENT_SETTLED on a full settlement and
 * reconciles follow-ups.
 *
 * Rides the notification cron (`/api/cron/notifications`), throttled per org to
 * once an hour via `xeroIntegrations.paymentsSyncedAt`. `syncXeroPaymentsNow`
 * is the on-demand "Refresh from Xero" for a signed-in user.
 */
import { prisma } from "@/lib/prisma";
import { getConvexClient } from "@/lib/convex-client";
import { api } from "../../convex/_generated/api";
import { requirePermission } from "@/lib/org-context";
import { serialize } from "@/lib/serialize";
import { getFreshAccessToken } from "@/lib/xero-token";
import { fetchXeroInvoiceStates } from "@/lib/xero-client";
import { toXeroInvoiceStateUpdates } from "@/lib/xero-payment-state";

const SYNC_EVERY_MS = 55 * 60 * 1000;

export interface XeroPaymentSyncResult {
  orgs: number;
  checked: number;
  settled: number;
  errors: string[];
}

async function syncOrg(orgId: string, now: number): Promise<{ checked: number; settled: number }> {
  const convex = await getConvexClient();
  const pending = await convex.query(api.xeroPaymentSync.pushedUnsettledInvoices, { orgId });
  if (!pending.length) return { checked: 0, settled: 0 };
  const { accessToken, tenantId } = await getFreshAccessToken(convex, orgId);
  const states = await fetchXeroInvoiceStates(pending.map((p) => p.xeroInvoiceId), { accessToken, tenantId });
  const updates = toXeroInvoiceStateUpdates(pending, states);
  const res = await convex.mutation(api.xeroPaymentSync.applyXeroInvoiceStates, { orgId, states: updates, now });
  return { checked: res.applied, settled: res.settled };
}

/** Cron-only (no session): every connected org, at most once an hour each. */
export async function syncXeroPayments(): Promise<XeroPaymentSyncResult> {
  const result: XeroPaymentSyncResult = { orgs: 0, checked: 0, settled: 0, errors: [] };
  const now = Date.now();
  const convex = await getConvexClient();
  const orgs = await prisma.organization.findMany({ where: { archivedAt: null }, select: { id: true } });
  for (const org of orgs) {
    const integration = await convex.query(api.xeroIntegrations.getByOrgId, { orgId: org.id });
    if (!integration?.isConnected) continue;
    if (integration.paymentsSyncedAt && now - integration.paymentsSyncedAt < SYNC_EVERY_MS) continue;
    try {
      const r = await syncOrg(org.id, now);
      result.orgs++;
      result.checked += r.checked;
      result.settled += r.settled;
    } catch (e) {
      result.errors.push(`${org.id}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  return result;
}

/** "Refresh from Xero" — the signed-in user's own org, now, ignoring the
 *  hourly throttle. Gated like pushing an invoice. */
export async function syncXeroPaymentsNow() {
  const { organizationId } = await requirePermission("invoice", "xero_push");
  const r = await syncOrg(organizationId, Date.now());
  return serialize(r);
}
