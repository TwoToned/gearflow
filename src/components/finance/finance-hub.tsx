"use client";
// use-client: URL-driven list, live queries, row menus (R-8.1.1)

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
import type { ActionMenuSpec } from "@/lib/primitives/types";
import { showError } from "@/lib/show-error";
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

type HubPage = { total?: number; truncated?: boolean; moneyVisible?: boolean; kind?: string; items?: unknown[]; timezone?: string | null } | null | undefined;

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

/** Each row's menu: `Open on the job`, plus `Acknowledge expired` on a fresh expired quote (invoice:publish). */
function useRowMenus(canPublish: boolean) {
  const router = useRouter();
  const quoteWrites = useQuoteWrites();
  const open = (projectId: string | undefined): ActionMenuSpec["items"] =>
    projectId ? [{ key: "open", label: "Open on the job", group: "edit", onSelect: () => router.push(`/projects/${projectId}?tab=finance`) }] : [];
  const acknowledge = async (id: string) => {
    try {
      await quoteWrites.acknowledgeExpired(id);
    } catch (e) {
      showError(e, { fallbackTitle: "Couldn't acknowledge that quote" });
    }
  };
  const quoteMenu = (q: QuoteSource): ActionMenuSpec => {
    const items = [...open(q.project?.id)];
    if (q.status === "EXPIRED" && !q.dismissed && canPublish) items.push({ key: "ack", label: "Acknowledge expired", group: "organise", onSelect: () => acknowledge(q.id) });
    return { items };
  };
  const invoiceMenu = (i: InvoiceSource): ActionMenuSpec => ({ items: open(i.project?.id) });
  return { quoteMenu, invoiceMenu };
}

function rowsOf(tab: HubTab, page: HubPage, menus: ReturnType<typeof useRowMenus>, tz: string | null | undefined) {
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
    filters: seg === "depositdue" ? [] : hubFilters(tab),
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
  const menus = useRowMenus(useCanDo("invoice", "publish"));
  const xero = useXeroIntegration();
  const list = hubListProps(tab, state.seg, counts, page, { known: xero !== undefined, connected: xero?.isConnected === true });

  return (
    <div className="space-y-5">
      <MoneyStrip money={counts?.money as HubMoney | undefined} approx={counts?.approx.words} />
      <ListPage
        key={tab}
        spec={specFor(tab)}
        title="Finance"
        itemSortKey="number"
        rows={rowsOf(tab, page, menus, page?.timezone)}
        total={page?.total ?? 0}
        loading={page === undefined}
        {...list}
      />
    </div>
  );
}
