"use client";
// use-client: URL-driven list, live queries, row menus (R-8.1.1)

import * as React from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";

import { api } from "../../../convex/_generated/api";

import { ListPage } from "@/components/ui/list-page";
import { useAuthedQuery } from "@/hooks/use-authed-query";
import { useListUrlState } from "@/hooks/use-list-url-state";
import { useQuoteWrites } from "@/hooks/use-quote-writes";
import { useStableNow } from "@/hooks/use-stable-now";
import { useXeroIntegration } from "@/hooks/use-xero-linked";
import { useActiveOrganization } from "@/lib/auth-client";
import {
  HUB_TABS,
  hubFilters,
  hubQueryArgs,
  hubSegments,
  hubSubline,
  invoiceColumns,
  invoiceRow,
  moneyWords,
  parseHubTab,
  quoteColumns,
  quoteRow,
  specFor,
  toRaiseRow,
  type HubMoney,
  type HubTab,
  type InvoiceSource,
  type QuoteSource,
  type ToRaiseSource,
} from "@/lib/list-views/finance";
import type { ActionMenuSpec } from "@/lib/primitives/types";
import { showError } from "@/lib/show-error";
import { useCanDo } from "@/lib/use-permissions";
import { cn } from "@/lib/utils";

/** The four money words, each a link to the list it counts; absent for a caller below the job-cost line. */
function MoneyStrip({ money }: { money: HubMoney | undefined }) {
  const words = moneyWords(money);
  if (words.length === 0) return null;
  return (
    <dl className="grid grid-cols-2 gap-x-6 gap-y-3 md:flex md:flex-wrap md:gap-x-10" aria-label="Money">
      {words.map((w) => (
        <Link key={w.key} href={w.href} className="min-w-0 rounded-[var(--r)] py-1 hover:bg-elev focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red">
          <dt className="t-micro text-muted">{w.label}</dt>
          <dd className={cn("font-mono text-ui-text font-medium tabular-nums", w.tone === "error" ? "text-t-out" : "text-ink")}>{w.amount}</dd>
        </Link>
      ))}
    </dl>
  );
}

/**
 * The org Finance hub (UX Phase 17, spec §9j): Quotes and Invoices as head words with their own
 * strips, four money words that deep-link, ONE list at a time on `ListPage`. Statuses are the
 * server's DERIVED ones (the quote's effective status, the invoice's one pill: Overdue outranks Part
 * paid); money columns and words exist only when the server sent them. Stored finance documents are
 * never rendered here: a row opens the job's Finance tab, where the stored PDF lives.
 */
export function FinanceHub() {
  const { data: activeOrg } = useActiveOrganization();
  return <FinanceHubInner key={activeOrg?.id ?? "none"} orgId={activeOrg?.id} />;
}

function FinanceHubInner({ orgId }: { orgId: string | undefined }) {
  const router = useRouter();
  const tab: HubTab = parseHubTab(useSearchParams().get("tab"));
  const spec = specFor(tab);
  const now = useStableNow();
  const { state } = useListUrlState(spec);
  const quoteWrites = useQuoteWrites();
  const canPublish = useCanDo("invoice", "publish");
  const xero = useXeroIntegration();
  const xeroConnected = xero?.isConnected === true;

  const counts = useAuthedQuery(api.financeHub.hubCounts, orgId ? { orgId, now } : "skip");
  const args = orgId ? { orgId, ...hubQueryArgs(tab, state, now) } : "skip";
  const quotes = useAuthedQuery(api.financeHub.quotesPage, tab === "quotes" ? args : "skip");
  const invoices = useAuthedQuery(api.financeHub.invoicesPage, tab === "invoices" ? args : "skip");
  const page = tab === "quotes" ? quotes : invoices;
  const moneyVisible = page?.moneyVisible === true;

  const open = (projectId: string | undefined): ActionMenuSpec["items"] =>
    projectId ? [{ key: "open", label: "Open on the job", group: "edit", onSelect: () => router.push(`/projects/${projectId}?tab=finance`) }] : [];

  const rows = React.useMemo(() => {
    if (!page) return [];
    if (tab === "quotes") {
      return (quotes?.items as unknown as QuoteSource[] | undefined)?.map((q) => {
        const items = [...open(q.project?.id)];
        if (q.status === "EXPIRED" && !q.dismissed && canPublish) {
          items.push({
            key: "ack",
            label: "Acknowledge expired",
            group: "organise",
            onSelect: async () => {
              try {
                await quoteWrites.acknowledgeExpired(q.id);
              } catch (e) {
                showError(e, { fallbackTitle: "Couldn't acknowledge that quote" });
              }
            },
          });
        }
        return quoteRow(q, { items });
      }) ?? [];
    }
    const inv = invoices as unknown as { kind?: string; items: unknown[] } | undefined;
    if (inv?.kind === "toRaise") return (inv.items as ToRaiseSource[]).map((r) => toRaiseRow(r));
    return (inv?.items as InvoiceSource[] | undefined)?.map((i) => invoiceRow(i, { items: open(i.project?.id) })) ?? [];
    // `open` only reads `router`; the rows depend on the page and the viewer's rights.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, quotes, invoices, tab, canPublish]);

  const wordCounts = counts ? { quotes: counts.quotes, invoices: counts.invoices, truncated: counts.truncated } : undefined;
  const headWords = {
    value: tab,
    words: HUB_TABS.map((k) => ({
      key: k,
      label: `${k === "quotes" ? "Quotes" : "Invoices"}${counts ? ` ${counts[k].all}` : ""}`,
      href: `/finance?tab=${k}`,
    })),
  };
  const notice = [
    page?.truncated ? "Showing the newest documents: older ones are left out of this view." : null,
    tab === "invoices" && xero !== undefined && !xeroConnected ? "Xero isn't connected. Open Settings › Xero to connect it." : null,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className="space-y-5">
      <MoneyStrip money={counts?.money as HubMoney | undefined} />
      <ListPage
        key={tab}
        spec={spec}
        title="Finance"
        noun={tab === "quotes" ? "quotes" : "invoices"}
        bulkNoun={tab === "quotes" ? "quote" : "invoice"}
        searchPlaceholder={tab === "quotes" ? "Search job, client or quote number" : "Search invoice number, job or client"}
        segments={hubSegments(tab, counts?.[tab] as Record<string, number> | undefined)}
        filters={state.seg === "depositdue" ? [] : hubFilters(tab)}
        columns={tab === "quotes" ? quoteColumns(moneyVisible) : state.seg === "depositdue" ? [{ id: "job", header: "Client" }, ...(moneyVisible ? [{ id: "total", header: "Deposit", align: "end" as const }] : [])] : invoiceColumns(moneyVisible, xeroConnected)}
        rows={rows}
        total={page?.total ?? 0}
        loading={page === undefined}
        itemHeader={tab === "quotes" ? "Quote" : "Invoice"}
        itemSortKey="number"
        subline={hubSubline(wordCounts)}
        headWords={headWords}
        notice={notice || undefined}
        empty={{ title: tab === "quotes" ? "No quotes here" : "No invoices here", description: "Quotes and invoices raised from a job appear here." }}
      />
    </div>
  );
}
