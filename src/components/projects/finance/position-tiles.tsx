"use client";

import { useAuthedQuery } from "@/hooks/use-authed-query";
import { useStableNow } from "@/hooks/use-stable-now";
import { api } from "../../../../convex/_generated/api";
import { formatCurrency } from "@/lib/formatters";
import { financePositionTiles } from "@/lib/finance-position";
import { deriveInvoicingState, type InvoiceLike } from "@/lib/project-invoicing-state";
import { cn } from "@/lib/utils";

/**
 * The position in four tiles at the top of the Finance tab (UX Phase 10, spec
 * §8b): Quote · Invoiced · Paid · Margin ex GST. A READ-ONLY summary: every
 * figure is derived by `financePositionTiles` from the same subscriptions the
 * strips below hold (Convex dedupes identical queries), so a tile can never
 * disagree with its strip. The verbs (Send, Invoice ▾, Record payment) stay in
 * the strips and the row menus.
 *
 * The Margin tile exists only when the server sent a margin: `null` is absent
 * (owner ruling 2026-11-24), never a `$0`.
 */
export function PositionTiles({
  projectId,
  orgId,
  total,
  taxAmount,
  margin,
}: {
  projectId: string;
  orgId: string | undefined;
  total: number | null;
  taxAmount: number | null;
  /** The ONE margin, ex GST; `null`/`undefined` = the caller does not see job cost. */
  margin: number | null | undefined;
}) {
  const now = useStableNow();
  const invoices = useAuthedQuery(api.invoices.listForProject, orgId ? { orgId, projectId } : "skip");
  const revision = useAuthedQuery(api.quotes.revisionStateForProject, orgId ? { orgId, projectId, now } : "skip");
  if (invoices === undefined || revision === undefined) return <div className="h-16" aria-hidden="true" />;

  const invoicing = deriveInvoicingState(invoices as InvoiceLike[], 25, total, now);
  const tiles = financePositionTiles({
    liveQuote: revision.liveQuote
      ? { version: revision.liveQuote.version, status: revision.liveQuote.status, validUntil: revision.liveQuote.validUntil }
      : revision.draftQuoteId
        ? { version: revision.liveRevision, status: "DRAFT", validUntil: null }
        : null,
    invoicing,
    total,
    margin,
    revenueExGst: total != null && taxAmount != null ? total - taxAmount : null,
    now,
    money: formatCurrency,
  });

  return (
    <dl className="grid grid-cols-2 gap-x-6 gap-y-3 md:grid-cols-4" aria-label="Finance position">
      {tiles.map((t) => (
        <div key={t.key} className="min-w-0">
          <dt className="t-overline text-fg-4">{t.label}</dt>
          <dd className="mt-0.5 truncate text-ui-text font-semibold tabular-nums text-ink">{t.headline}</dd>
          {t.detail ? <dd className={cn("truncate text-caption", t.tone === "error" ? "text-error" : "text-muted")}>{t.detail}</dd> : null}
        </div>
      ))}
    </dl>
  );
}
