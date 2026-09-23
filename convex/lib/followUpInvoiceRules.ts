import { addBusinessDaysInTimezone, startOfDayInTimezone } from "./quoteDates";
import {
  RUNG_CONSUMING,
  TERMINAL,
  closeAll,
  formatShortDate,
  type DesiredFollowUp,
  type FollowUpConfig,
  type FollowUpResolution,
  type FollowUpRow,
  type QuoteLoopPlan,
} from "./followUpRules";

/**
 * Follow-up automation — the invoice rules (phase 2, FEATUREDOCS/82, design
 * §8.3). Pure, like the quote rule. Two loops:
 *
 *  - **Invoice chase** — a Flow invoice (issued after the cut-over, not a
 *    credit) that is past its due date and not settled. Rung 1 one business
 *    day after the due date; each "no reply" moves the next rung five business
 *    days on; rung 3 says "call"; rung 4 is the decision (payment plan,
 *    write-off, keep chasing). A DEPOSIT whose event is under a week away is
 *    urgent — the gear is held against money that hasn't landed. Closes when
 *    the invoice is PAID (Flow or Xero), voided (Flow or Xero) or fully
 *    credited (settled via `xeroAmountCredited`, so it reads PAID).
 *  - **Invoice not raised** — the job came back (RETURNED/COMPLETED) after the
 *    cut-over and no non-credit invoice was ever issued. One item, two
 *    business days after the job ended. Closes when an invoice is issued.
 *
 * "Settled" is read off `paymentStatus`, which the Xero sync keeps true —
 * that sync is why these rules could exist at all (design D1).
 */

export interface InvoiceLoopFacts {
  now: number;
  config: FollowUpConfig;
  eventStart: number | undefined;
  invoice: {
    id: string;
    number: string | undefined;
    kind: string;
    status: string;
    paymentStatus: string | undefined;
    xeroStatus: string | undefined;
    issuedAt: number | undefined;
    dueDate: number | undefined;
    total: number;
    amountPaid: number;
    amountCredited: number;
  };
  rows: FollowUpRow[];
}

export const INVOICE_DECISION_RUNG = 4;
const DAY_MS = 86_400_000;
const URGENT_DEPOSIT_WINDOW_MS = 7 * DAY_MS;
const NEXT_RUNG_BUSINESS_DAYS = 5;
const CLOSED_IN_XERO = new Set(["VOIDED", "DELETED"]);

function money(n: number): string {
  return `$${n.toLocaleString("en-AU", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

type Close = [FollowUpResolution, "DONE" | "CANCELLED"];

/** The invoice itself says the chase is over: voided, paid, fully credited,
 *  or not a chaseable (issued, non-credit) invoice at all. */
function settledClose(inv: InvoiceLoopFacts["invoice"]): Close | null {
  if (inv.status === "VOID" || CLOSED_IN_XERO.has(inv.xeroStatus ?? "")) return ["voided", "CANCELLED"];
  if (inv.paymentStatus === "PAID") return ["paid", "DONE"];
  // Fully credited (in Flow or Xero): nothing left to chase.
  if (inv.total - inv.amountPaid - inv.amountCredited <= 0.005) return ["voided", "CANCELLED"];
  if (inv.status !== "ISSUED" || inv.kind === "CREDIT") return ["superseded", "CANCELLED"];
  return null;
}

/** Not overdue yet: nothing to chase internally (Xero's own reminders cover
 *  the client side before the due date, design D2). */
function notYetOverdue(f: InvoiceLoopFacts): boolean {
  const tz = f.config.timezone;
  if (f.invoice.dueDate === undefined) return true;
  return f.now < addBusinessDaysInTimezone(startOfDayInTimezone(f.invoice.dueDate, tz), 1, tz);
}

/** Why the chase ends (or never starts); null = it runs. */
function endedInvoicePlan(f: InvoiceLoopFacts, openRows: FollowUpRow[]): QuoteLoopPlan | null {
  const settled = settledClose(f.invoice);
  if (settled) return { close: closeAll(openRows, settled[0], settled[1]), desired: null };
  if (f.invoice.issuedAt === undefined || f.invoice.issuedAt < f.config.cutoverAt) return { close: [], desired: null };
  if (!f.config.invoicesEnabled) return { close: closeAll(openRows, "disabled", "CANCELLED"), desired: null };
  if (notYetOverdue(f)) return { close: closeAll(openRows, "superseded", "CANCELLED"), desired: null };
  return null;
}

function invoiceTitle(label: string, owed: string, rung: number): string {
  if (rung >= INVOICE_DECISION_RUNG) return `Decide on ${label}: payment plan, write-off or keep chasing?`;
  if (rung === 3) return `Call the client about ${label} (${owed} overdue)`;
  return rung === 2 ? `Second chase: ${label} (${owed} overdue)` : `Chase payment: ${label} (${owed} overdue)`;
}

/** Rung N+1 is due on the parked date, else five business days after the
 *  last no-reply, else one business day after the invoice's due date. */
function nextChaseDue(last: FollowUpRow | undefined, dueStart: number, tz: string): number {
  if (last?.nextDate !== undefined) return startOfDayInTimezone(last.nextDate, tz);
  if (last?.completedAt !== undefined) return addBusinessDaysInTimezone(last.completedAt, NEXT_RUNG_BUSINESS_DAYS, tz);
  return addBusinessDaysInTimezone(dueStart, 1, tz);
}

function chaseWhy(f: InvoiceLoopFacts, label: string, owed: string, dueStart: number, urgent: boolean): string {
  const tz = f.config.timezone;
  const daysOver = Math.max(0, Math.floor((f.now - dueStart) / DAY_MS));
  const held = urgent ? ` · deposit unpaid, event ${formatShortDate(f.eventStart!, tz)} — gear is held` : "";
  return `${label} was due ${formatShortDate(dueStart, tz)} · ${daysOver} day${daysOver === 1 ? "" : "s"} overdue · ${owed} owed${held}.`;
}

/** The rung the loop is on (1-based), or null once a terminal close ended it
 *  or every rung including the decision has been used. */
function currentRung(rows: FollowUpRow[]): { rung: number; last: FollowUpRow | undefined } | null {
  if (rows.some((r) => !r.open && r.resolution !== undefined && TERMINAL.has(r.resolution))) return null;
  const closed = rows.filter((r) => !r.open).sort((a, b) => (a.completedAt ?? 0) - (b.completedAt ?? 0));
  const rung = closed.filter((r) => r.resolution !== undefined && RUNG_CONSUMING.has(r.resolution)).length + 1;
  return rung > INVOICE_DECISION_RUNG ? null : { rung, last: closed[closed.length - 1] };
}

export function planInvoiceLoop(f: InvoiceLoopFacts): QuoteLoopPlan {
  const openRows = f.rows.filter((r) => r.open);
  const ended = endedInvoicePlan(f, openRows);
  if (ended) return ended;
  const at = currentRung(f.rows);
  if (!at) return { close: closeAll(openRows, "superseded", "CANCELLED"), desired: null };
  const { rung, last } = at;
  const tz = f.config.timezone;
  const inv = f.invoice;
  const dueStart = startOfDayInTimezone(inv.dueDate!, tz);
  const urgent = inv.kind === "DEPOSIT" && f.eventStart !== undefined && f.eventStart - f.now < URGENT_DEPOSIT_WINDOW_MS;
  const owed = money(Math.max(0, inv.total - inv.amountPaid - inv.amountCredited));
  const label = inv.number ?? "invoice";
  const desired: DesiredFollowUp & { existingId?: string } = {
    existingId: openRows[0]?.id,
    rung,
    loopStartAt: dueStart,
    subjectId: inv.id,
    dueDate: nextChaseDue(last, dueStart, tz),
    priority: urgent || rung >= 3 ? "HIGH" : "NORMAL",
    urgent,
    title: invoiceTitle(label, owed, rung),
    why: chaseWhy(f, label, owed, dueStart, urgent),
  };
  return { close: closeAll(openRows.slice(1), "superseded", "CANCELLED"), desired };
}

// ─── Invoice not raised ───────────────────────────────────────────────────

export interface UnraisedFacts {
  now: number;
  config: FollowUpConfig;
  project: { id: string; status: string | undefined; projectNumber: string; endedAt: number | undefined; total: number };
  hasIssuedInvoice: boolean;
  rows: FollowUpRow[];
}

const CAME_BACK = new Set(["RETURNED", "COMPLETED"]);

/** A job that came back after the cut-over, with money on it, in an org that
 *  has invoice follow-ups on. */
function unraisedInScope(f: UnraisedFacts): boolean {
  const { project, config } = f;
  if (!config.invoicesEnabled || !CAME_BACK.has(project.status ?? "")) return false;
  return project.total > 0 && project.endedAt !== undefined && project.endedAt >= config.cutoverAt;
}

export function planUnraisedLoop(f: UnraisedFacts): QuoteLoopPlan {
  const openRows = f.rows.filter((r) => r.open);
  if (f.hasIssuedInvoice) return { close: closeAll(openRows, "invoiced", "DONE"), desired: null };
  if (f.project.status === "CANCELLED") return { close: closeAll(openRows, "cancelled", "CANCELLED"), desired: null };
  if (!unraisedInScope(f)) return { close: closeAll(openRows, "superseded", "CANCELLED"), desired: null };
  if (f.rows.some((r) => !r.open)) return { close: [], desired: null }; // one item, ever, per job
  const tz = f.config.timezone;
  return {
    close: [],
    desired: {
      existingId: openRows[0]?.id,
      rung: 1,
      loopStartAt: f.project.endedAt!,
      subjectId: f.project.id,
      dueDate: addBusinessDaysInTimezone(f.project.endedAt!, 2, tz),
      priority: "NORMAL",
      urgent: false,
      title: `Raise the invoice for ${f.project.projectNumber}`,
      why: `${f.project.projectNumber} came back ${formatShortDate(f.project.endedAt!, tz)} and has no invoice issued in Flow.`,
    },
  };
}
