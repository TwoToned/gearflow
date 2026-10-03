"use client";
// use-client: interactive — reactive Convex queries + a dialog trigger (R-8.1.1)

import { Check, CircleDashed, Loader2 } from "lucide-react";

import { useAuthedQuery } from "@/hooks/use-authed-query";
import { formatCurrency, formatDate } from "@/lib/formatters";
import { computePaymentProgress, type PaymentStep } from "@/lib/project-payment-progress";
import { cn } from "@/lib/utils";
import { api } from "../../../convex/_generated/api";

/**
 * The money phase, rendered (#1236).
 *
 * `AWAITING_PAYMENT` is ONE lifecycle stage, so the stepper shows one node. The
 * three things a human actually wants to know inside that stage — accepted?
 * invoiced? paid? — are derived here from the quote and invoice rows
 * (`computePaymentProgress`), never stored on the project.
 *
 * Mounted directly under the lifecycle stepper and **only while the project is
 * at `AWAITING_PAYMENT`**: on any other status it is either premature or
 * history, and the Finance tab already owns the full ledger. This strip answers
 * exactly one question — "what are we waiting for?" — and disappears the moment
 * it has been answered.
 */
export function PaymentProgressStrip({
  projectId,
  orgId,
  status,
  now,
}: {
  projectId: string;
  orgId: string | undefined;
  status: string | null | undefined;
  /** Bucketed clock for `effectiveQuoteStatus` — passed in so the caller's
   *  existing bucket is reused rather than minting a second ticking value. */
  now: number;
}) {
  const active = status === "AWAITING_PAYMENT" && !!orgId;
  const quotes = useAuthedQuery(api.quotes.listForProject, active ? { orgId: orgId!, projectId, now } : "skip");
  const invoices = useAuthedQuery(api.invoices.listForProject, active ? { orgId: orgId!, projectId } : "skip");

  if (!active) return null;

  // Both queries in flight — render nothing rather than a skeleton. The stepper
  // above already says "Awaiting payment"; a flash of placeholder under it adds
  // noise, not information.
  if (quotes === undefined || invoices === undefined) return null;

  const progress = computePaymentProgress({
    quotes,
    invoices,
    formatDate: (ms) => formatDate(new Date(ms)),
    formatMoney: (amount) => formatCurrency(amount),
  });

  return (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-2 rounded-[var(--radius)] border border-line bg-paper-2/60 px-3 py-2">
      {progress.steps.map((step) => (
        <PaymentProgressItem key={step.key} step={step} />
      ))}
    </div>
  );
}

function PaymentProgressItem({ step }: { step: PaymentStep }) {
  return (
    <div className="flex min-w-0 items-center gap-2">
      <StepGlyph state={step.state} />
      <span
        className={cn(
          "t-small",
          step.state === "pending" ? "text-faint" : step.state === "current" ? "text-ink" : "text-ink-2",
          step.state === "current" && "font-medium",
        )}
      >
        {step.label}
      </span>
      {step.detail && <span className="t-micro truncate text-muted">{step.detail}</span>}
    </div>
  );
}

/** `done` reads as settled, `current` as in-motion, `pending` as not-yet — the
 *  same three-state vocabulary the lifecycle stepper uses for its own nodes. */
function StepGlyph({ state }: { state: PaymentStep["state"] }) {
  if (state === "done") return <Check className="h-3.5 w-3.5 shrink-0 text-ok" aria-label="Done" />;
  if (state === "current") {
    return <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-warn motion-reduce:animate-none" aria-label="Waiting" />;
  }
  return <CircleDashed className="h-3.5 w-3.5 shrink-0 text-faint" aria-label="Not yet" />;
}
