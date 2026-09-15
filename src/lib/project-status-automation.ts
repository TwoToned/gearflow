/**
 * Project status automation — the per-org opt-out switches (#1160).
 *
 * The RULES themselves (which status a trigger moves a job to, and from which
 * statuses it is allowed to) live server-side in `convex/lib/projectAutoStatus.ts`
 * — status is never decided by the browser. This module owns ONLY the shared
 * vocabulary both sides need: the switch keys, their default, and the human
 * labels the settings screen renders. `convex/projectAutoStatus.test.ts` asserts
 * the two key lists stay in lockstep, so the convex-side mirror can't silently
 * drift (POLICY.md R-3.1).
 *
 * Absent = ON. Every switch defaults to enabled so a brand-new org (and every
 * pre-#1160 row, which has no `projectStatusAutomation` key at all) gets the
 * automation without a backfill — the setting only ever records an opt-OUT.
 */

export const AUTO_STATUS_KEYS = [
  "quoteSent",
  "quoteAccepted",
  "invoiceIssued",
  "paymentSettled",
  "prepStarted",
  "allCheckedOut",
  "allReturned",
] as const;

export type AutoStatusKey = (typeof AUTO_STATUS_KEYS)[number];

/** Per-key opt-out switches. A missing key (or a missing object) means enabled. */
export type ProjectStatusAutomationSettings = Partial<Record<AutoStatusKey, boolean>>;

/** Settings-screen copy. `moves` is the sentence fragment after "Moves the job to". */
export const AUTO_STATUS_LABELS: Record<AutoStatusKey, { title: string; moves: string; detail: string }> = {
  quoteSent: {
    title: "Quote sent",
    moves: "Quoted",
    detail: "When a quote revision goes out to the client.",
  },
  quoteAccepted: {
    title: "Quote accepted",
    moves: "Awaiting payment",
    detail: "When the client approves a quote and the job is waiting on money.",
  },
  invoiceIssued: {
    title: "Invoice issued",
    moves: "Awaiting payment",
    detail: "When a deposit or full invoice goes out on a job that hasn't been approved yet.",
  },
  paymentSettled: {
    title: "Invoice paid",
    moves: "Confirmed",
    detail: "When an invoice is paid in full. Needs an accepted quote — without one the job waits for a human.",
  },
  prepStarted: {
    title: "Prep started",
    moves: "Prepping",
    detail: "When the warehouse packs the first item on a confirmed job.",
  },
  allCheckedOut: {
    title: "Everything deployed",
    moves: "Deployed",
    detail: "When the last packed item leaves the building — nothing is left waiting on the dock.",
  },
  allReturned: {
    title: "Everything returned",
    moves: "Returned",
    detail: "When the last outstanding item is checked back in.",
  },
};

/** Absent = enabled. The ONLY place that decision is made (R-3.1). */
export function isAutoStatusEnabled(
  settings: ProjectStatusAutomationSettings | undefined,
  key: AutoStatusKey,
): boolean {
  return settings?.[key] !== false;
}

/**
 * Toast copy for a status the automation just applied, keyed by the STATUS (what
 * the server reports back) rather than the trigger — the caller is a warehouse
 * screen that knows what it just did, not which rule fired.
 *
 * Deliberately informational, not celebratory: the operator didn't ask for a
 * status change, the app is telling them one happened so it never moves under
 * them silently. Returns null for a status with no copy, so an unknown value
 * shows nothing rather than a half-written toast.
 */
export function autoStatusToast(status: string | null | undefined): { title: string; description: string } | null {
  switch (status) {
    case "QUOTED":
      return { title: "Job moved to Quoted", description: "The quote is out with the client." };
    case "AWAITING_PAYMENT":
      return { title: "Job moved to Awaiting payment", description: "Agreed — now waiting on the money." };
    case "CONFIRMED":
      return { title: "Job confirmed", description: "Paid in full — the job is on." };
    case "PREPPING":
      return { title: "Job moved to Prepping", description: "First item packed — the job is now in prep." };
    case "CHECKED_OUT":
      return { title: "Job moved to Deployed", description: "Nothing left on the dock — everything packed has gone out." };
    case "RETURNED":
      return { title: "Job moved to Returned", description: "Last outstanding item is back in." };
    default:
      return null;
  }
}
