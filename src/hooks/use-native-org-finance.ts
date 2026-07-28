"use client";

import { useAuthedQuery } from "@/hooks/use-authed-query";
import { api } from "../../convex/_generated/api";

/** #992 (Phase F) — the org-level Finance section's one aggregation query. */

const MINUTE = 60_000;

export interface OrgFinanceProjectRef {
  id: string;
  projectNumber: string;
  name: string;
  status: string | null;
  clientId: string | null;
  clientName: string | null;
}

export interface OrgFinanceQuoteRow {
  quoteId: string;
  version: number;
  status: string;
  sentAt: number | null;
  validUntil: number | null;
  total: number | null;
  project: OrgFinanceProjectRef;
}

export interface OrgFinanceExpiringRow extends Omit<OrgFinanceQuoteRow, "sentAt"> {
  daysLeft: number | null;
}

export interface OrgFinanceNeverSentRow {
  quoteId: string;
  version: number;
  createdAt: number | null;
  total: number;
  project: OrgFinanceProjectRef;
}

export interface OrgFinanceProjectRow {
  project: OrgFinanceProjectRef;
  rentalEndDate?: number | null;
  depositPercent?: number;
  total: number;
}

export interface OrgFinanceInvoiceRow {
  invoiceId: string;
  invoiceNumber: string | null;
  kind: string;
  total: number;
  paymentStatus: string;
  issuedAt: number | null;
  dueDate: number | null;
  project: OrgFinanceProjectRef;
}

export interface OrgFinanceBundle {
  quotesOut: OrgFinanceQuoteRow[];
  expiring: OrgFinanceExpiringRow[];
  neverSent: OrgFinanceNeverSentRow[];
  confirmedUninvoiced: OrgFinanceProjectRow[];
  depositDue: OrgFinanceProjectRow[];
  outstanding: OrgFinanceInvoiceRow[];
  capped: boolean;
}

export function useNativeOrgFinance(orgId: string | undefined): { data: OrgFinanceBundle | undefined; isLoading: boolean } {
  const enabled = !!orgId;
  const nowBucket = enabled ? Math.floor(Date.now() / MINUTE) * MINUTE : 0;
  const data = useAuthedQuery(api.financeOrg.bundle, enabled ? { orgId: orgId!, now: nowBucket } : "skip") as
    | OrgFinanceBundle
    | undefined;
  return { data, isLoading: enabled && data === undefined };
}
