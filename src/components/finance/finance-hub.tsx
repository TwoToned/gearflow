"use client";
// use-client: URL-driven list, live queries, row menus (R-8.1.1)

import * as React from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";

import { api } from "../../../convex/_generated/api";

import { JobPickerDialog } from "@/components/finance/job-picker-dialog";
import { useHubActions } from "@/components/finance/use-hub-actions";
import { ListPage } from "@/components/ui/list-page";
import { useAuthedQuery } from "@/hooks/use-authed-query";
import { useListUrlState } from "@/hooks/use-list-url-state";
import { useStableNow } from "@/hooks/use-stable-now";
import { useXeroIntegration } from "@/hooks/use-xero-linked";
import { useActiveOrganization } from "@/lib/auth-client";
import {
  hubFilters,
  hubHeadWords,
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
import { useCanDo } from "@/lib/use-permissions";
import { cn } from "@/lib/utils";

/** The four money words, each a link to the list it counts; absent for a caller below the job-cost line. */
function MoneyStrip({ money, approx }: { money: HubMoney | undefined; approx?: Partial<Record<keyof HubMoney, boolean>> }) {
  const words = moneyWords(money, approx);
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

type HubPage = { total?: number; truncated?: boolean; moneyVisible?: boolean; kind?: string; items?: unknown[]; timezone?: string | null; clients?: { id: string; name: string }[] } | null | undefined;

/** The page, strip counts and tab for the URL's current state: one place that knows which query feeds which tab. */
function useHubData(orgId: string | undefined, tab: HubTab) {
  const now = useStableNow();
  const { state } = useListUrlState(specFor(tab));
  const counts = useAuthedQuery(api.financeHub.hubCounts, orgId ? { orgId, now } : "skip");
  const args = orgId ? { orgId, ...hubQueryArgs(tab, state, now) } : "skip";
  const quotes = useAuthedQuery(api.financeHub.quotesPage, tab === "quotes" ? args : "skip");
  const invoices = useAuthedQuery(api.financeHub.invoicesPage, tab === "invoices" ? args : "skip");
  return { state, counts, page: (tab === "quotes" ? quotes : invoices) as HubPage };
}

function rowsOf(tab: HubTab, page: HubPage, menus: Pick<ReturnType<typeof useHubActions>, "quoteMenu" | "invoiceMenu">, tz: string | null | undefined) {
  const items = (page?.items ?? []) as unknown[];
  if (tab === "quotes") return (items as QuoteSource[]).map((q) => quoteRow(q, menus.quoteMenu(q), tz));
  if (page?.kind === "toRaise") return (items as ToRaiseSource[]).map((r) => toRaiseRow(r));
  return (items as InvoiceSource[]).map((i) => invoiceRow(i, menus.invoiceMenu(i), tz));
}

function hubNotice(page: HubPage, tab: HubTab, xeroKnown: boolean, xeroConnected: boolean): string | undefined {
  const parts = [
    page?.truncated ? "Showing the newest documents: older ones are left out of this view." : null,
    tab === "invoices" && xeroKnown && !xeroConnected ? "Xero isn't connected. Open Settings › Xero to connect it." : null,
  ].filter(Boolean);
  return parts.length ? parts.join(" ") : undefined;
}

function columnsOf(tab: HubTab, seg: string, moneyVisible: boolean, xeroConnected: boolean) {
  if (tab === "quotes") return quoteColumns(moneyVisible);
  if (seg === "depositdue") return [{ id: "job", header: "Client" }, ...(moneyVisible ? [{ id: "total", header: "Deposit", align: "end" as const }] : [])];
  return invoiceColumns(moneyVisible, xeroConnected);
}

const TAB_COPY: Record<HubTab, { word: string; noun: string; bulkNoun: string; search: string; itemHeader: string; empty: string }> = {
  quotes: { word: "Quotes", noun: "quotes", bulkNoun: "quote", search: "Search job, client or quote number", itemHeader: "Quote", empty: "No quotes here" },
  invoices: { word: "Invoices", noun: "invoices", bulkNoun: "invoice", search: "Search invoice number, job or client", itemHeader: "Invoice", empty: "No invoices here" },
};

/** Everything the list needs that depends on the tab and the server's counts, in one place. */
function hubListProps(tab: HubTab, seg: string, counts: ReturnType<typeof useHubData>["counts"], page: HubPage, xero: { known: boolean; connected: boolean }) {
  const copy = TAB_COPY[tab];
  const moneyVisible = page?.moneyVisible === true;
  return {
    noun: copy.noun,
    bulkNoun: copy.bulkNoun,
    searchPlaceholder: copy.search,
    itemHeader: copy.itemHeader,
    segments: hubSegments(tab, counts?.[tab] as Record<string, number> | undefined, { tab: counts?.approx[tab], depositdue: counts?.approx.depositdue }),
    filters: seg === "depositdue" ? [] : hubFilters(tab, { clients: page?.clients, xeroConnected: xero.connected }),
    columns: columnsOf(tab, seg, moneyVisible, xero.connected),
    subline: hubSubline(counts ? { quotes: counts.quotes, invoices: counts.invoices, approx: counts.approx } : undefined),
    headWords: hubHeadWords(tab, counts),
    notice: hubNotice(page, tab, xero.known, xero.connected),
    empty: { title: copy.empty, description: "Quotes and invoices raised from a job appear here." },
  };
}

function FinanceHubInner({ orgId }: { orgId: string | undefined }) {
  const tab: HubTab = parseHubTab(useSearchParams().get("tab"));
  const { state, counts, page } = useHubData(orgId, tab);
  const xero = useXeroIntegration();
  const [pickerOpen, setPickerOpen] = React.useState(false);
  const canNewInvoice = useCanDo("invoice", "create");
  const canNewQuote = useCanDo("invoice", "publish");
  const now = useStableNow();
  const actions = useHubActions({
    quotes: (tab === "quotes" ? (page?.items ?? []) : []) as unknown as QuoteSource[],
    invoices: (tab === "invoices" && page?.kind === "invoices" ? (page?.items ?? []) : []) as unknown as InvoiceSource[],
    xeroConnected: xero?.isConnected === true,
    now,
    timeZone: page?.timezone,
  });
  const list = hubListProps(tab, state.seg, counts, page, { known: xero !== undefined, connected: xero?.isConnected === true });
  const kinds = ([canNewInvoice ? "invoice" : null, canNewQuote ? "quote" : null].filter(Boolean) as ("invoice" | "quote")[]);
  const toRaise = page?.kind === "toRaise";

  return (
    <div className="space-y-5">
      <MoneyStrip money={counts?.money as HubMoney | undefined} approx={counts?.approx.words} />
      <ListPage
        key={tab}
        spec={specFor(tab)}
        title="Finance"
        itemSortKey="number"
        rows={rowsOf(tab, page, actions, page?.timezone)}
        total={page?.total ?? 0}
        loading={page === undefined}
        primary={kinds.length > 0 ? { label: "New\u2026", onSelect: () => setPickerOpen(true) } : undefined}
        bulk={toRaise ? undefined : tab === "quotes" ? actions.quoteBulk : actions.invoiceBulk}
        {...list}
      />
      {actions.dialogs}
      {kinds.length > 0 ? <JobPickerDialog open={pickerOpen} onOpenChange={setPickerOpen} orgId={orgId} kinds={kinds} /> : null}
    </div>
  );
}
