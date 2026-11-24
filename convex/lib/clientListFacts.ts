/**
 * The Clients list's derived facts (UX Phase 13, spec §9f.2). Pure and stateless:
 * nothing here is stored (a second copy of a total the jobs and invoices already
 * determine would contradict them the moment a payment is voided, R-3.1).
 *
 * - **Open jobs**: not templates, not RETURNED / COMPLETED / INVOICED / CANCELLED.
 * - **Quoted**: the stored `total` of jobs still ENQUIRY / QUOTING / QUOTED (read, never recomputed).
 * - **Outstanding**: ISSUED, not-PAID invoices, `total - amountPaid`; overdue by `dueDate`.
 * Money fields are returned only when `showMoney` (the invoice-read line, the one
 * `canSeeJobCost` rule); otherwise they are ABSENT, never zero.
 */
import { JOB_SEGMENT_STATUSES } from "./projectSegments";

export const CLIENT_SEGMENT_KEYS = ["all", "active", "quoting", "overdue", "archived"] as const;
export type ClientSegmentKey = (typeof CLIENT_SEGMENT_KEYS)[number];

const DAY_MS = 24 * 60 * 60 * 1000;
const CLOSED = new Set(["RETURNED", "COMPLETED", "INVOICED", "CANCELLED"]);
const QUOTING = new Set<string>(JOB_SEGMENT_STATUSES.quoting);

export interface ClientFactProject {
  id: string;
  clientId?: string | null;
  projectNumber: string;
  status?: string | null;
  isTemplate?: boolean | null;
  total?: number | null;
  rentalStartDate?: number | null;
}
export interface ClientFactInvoice {
  clientId: string;
  status?: string | null;
  paymentStatus?: string | null;
  total: number;
  amountPaid?: number | null;
  dueDate?: number | null;
}
export interface ClientFacts {
  openJobs: { id: string; projectNumber: string }[];
  openJobCount: number;
  quotingCount: number;
  lastJobAt: number | null;
  /** Absent without the invoice-read line. */
  quoted?: number;
  outstanding?: number;
  /** Days past the oldest overdue due date; 0 when none overdue. Absent without money. */
  overdueDays?: number;
  lifetime?: number;
  nextDue?: number | null;
  hasOverdue: boolean;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

export function clientFacts(
  projects: ClientFactProject[],
  invoices: ClientFactInvoice[],
  today: number,
  showMoney: boolean,
): ClientFacts {
  const jobs = projects.filter((p) => !p.isTemplate);
  const open = jobs.filter((p) => !CLOSED.has(p.status ?? "ENQUIRY"));
  const quoting = jobs.filter((p) => QUOTING.has(p.status ?? "ENQUIRY"));
  const unpaid = invoices.filter((i) => i.status === "ISSUED" && i.paymentStatus !== "PAID");
  const overdue = unpaid.filter((i) => i.dueDate != null && Math.floor(i.dueDate / DAY_MS) < today);
  const oldest = overdue.length ? Math.min(...overdue.map((i) => i.dueDate as number)) : null;
  const dues = unpaid.filter((i) => i.dueDate != null).map((i) => i.dueDate as number);
  const lastJobAt = jobs.reduce<number | null>((m, p) => (p.rentalStartDate != null && (m == null || p.rentalStartDate > m) ? p.rentalStartDate : m), null);
  const base: ClientFacts = {
    openJobs: open.map((p) => ({ id: p.id, projectNumber: p.projectNumber })),
    openJobCount: open.length,
    quotingCount: quoting.length,
    lastJobAt,
    hasOverdue: overdue.length > 0,
  };
  if (!showMoney) return base;
  return {
    ...base,
    quoted: round2(quoting.reduce((s, p) => s + (p.total ?? 0), 0)),
    outstanding: round2(unpaid.reduce((s, i) => s + (i.total - (i.amountPaid ?? 0)), 0)),
    overdueDays: oldest == null ? 0 : today - Math.floor(oldest / DAY_MS),
    lifetime: round2(jobs.filter((p) => p.status !== "CANCELLED").reduce((s, p) => s + (p.total ?? 0), 0)),
    nextDue: dues.length ? Math.min(...dues) : null,
  };
}

/** `overdue` needs money; without the invoice line the segment is not offered. */
export function inClientSegment(f: ClientFacts, active: boolean, segment: ClientSegmentKey): boolean {
  switch (segment) {
    case "all":
      return active;
    case "active":
      return active && f.openJobCount > 0;
    case "quoting":
      return active && f.quotingCount > 0;
    case "overdue":
      return active && f.hasOverdue;
    case "archived":
      return !active;
  }
}
