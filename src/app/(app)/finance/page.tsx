"use client";
// use-client: interactive (search/date filters) (R-8.1.1)

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  Send,
  AlertTriangle,
  FileQuestion,
  Wallet,
  CircleDollarSign,
  Check,
} from "lucide-react";
import { useActiveOrganization } from "@/lib/auth-client";
import { RequirePermission } from "@/components/auth/require-permission";
import { PageHeader } from "@/components/layout/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { FlowMascot } from "@/components/ui/flow-mascot";
import { SearchInput } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { formatCurrency, formatDate } from "@/lib/formatters";
import { quoteStatusIntent, intentToBadgeStatus } from "@/lib/status-colors";
import { cn, focusRing } from "@/lib/utils";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useQuoteWrites } from "@/hooks/use-quote-writes";
import {
  useNativeOrgFinance,
  type OrgFinanceBundle,
  type OrgFinanceQuoteRow,
  type OrgFinanceExpiringRow,
  type OrgFinanceNeverSentRow,
  type OrgFinanceProjectRow,
  type OrgFinanceInvoiceRow,
} from "@/hooks/use-native-org-finance";

const TILE = "rounded-[var(--r-lg)] border border-line bg-card p-5 shadow-[var(--sh-card)]";
const HARD_PILL = "bg-out-soft text-t-out";
const SOFT_PILL = "bg-warn-soft text-warn";

function financeTabHref(projectId: string) {
  return `/projects/${projectId}?tab=finance`;
}

function SectionHeader({
  icon: Icon,
  title,
  subtitle,
  count,
  pillClass,
}: {
  icon: typeof AlertTriangle;
  title: string;
  subtitle: string;
  count: number;
  pillClass: string;
}) {
  return (
    <div className="mb-3 flex items-center justify-between gap-2">
      <div>
        <h2 className="flex items-center gap-2 t-overline text-muted">
          <Icon className="h-4 w-4" /> {title}
        </h2>
        <p className="t-micro text-muted">{subtitle}</p>
      </div>
      {count > 0 && <span className={cn("rounded-full px-2.5 py-1 text-badge font-medium", pillClass)}>{count}</span>}
    </div>
  );
}

function RowShell({ children, href }: { children: React.ReactNode; href: string }) {
  return (
    <Link
      href={href}
      className={cn(
        "flex flex-col gap-1.5 rounded-[var(--r)] border border-line p-3 hover:bg-elev sm:flex-row sm:items-center sm:justify-between",
        focusRing,
      )}
    >
      {children}
    </Link>
  );
}

function QuotesOutSection({ rows }: { rows: OrgFinanceQuoteRow[] }) {
  return (
    <div className={TILE}>
      <SectionHeader icon={Send} title="Quotes out" subtitle="Sent, awaiting acceptance — oldest first" count={rows.length} pillClass={SOFT_PILL} />
      {rows.length === 0 ? (
        <p className="t-micro text-muted">Nothing sitting out with a client.</p>
      ) : (
        <div className="flex flex-col gap-2">
          {rows.map((r) => (
            <RowShell key={r.quoteId} href={financeTabHref(r.project.id)}>
              <div className="min-w-0">
                <p className="truncate text-[14px] font-medium text-ink">
                  {r.project.projectNumber} v{r.version} — {r.project.name}
                </p>
                <p className="t-micro text-muted">
                  {r.project.clientName ?? "No client"} · Sent {r.sentAt ? formatDate(new Date(r.sentAt)) : "—"}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <Badge status={intentToBadgeStatus(quoteStatusIntent(r.status))}>{r.status}</Badge>
                <span className="text-[14px] font-medium tabular-nums text-ink">{formatCurrency(r.total)}</span>
              </div>
            </RowShell>
          ))}
        </div>
      )}
    </div>
  );
}

function ExpiringSection({ rows }: { rows: OrgFinanceExpiringRow[] }) {
  const quoteWrites = useQuoteWrites();
  const acknowledge = async (e: React.MouseEvent, quoteId: string) => {
    // The row is a link into the project — acknowledging must not navigate.
    e.preventDefault();
    e.stopPropagation();
    try {
      await quoteWrites.acknowledgeExpired(quoteId);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't acknowledge that quote");
    }
  };
  return (
    <div className={TILE}>
      <SectionHeader icon={AlertTriangle} title="Expiring" subtitle="Valid until within 7 days, or expired in the last 7 days" count={rows.length} pillClass={HARD_PILL} />
      {rows.length === 0 ? (
        <p className="t-micro text-muted">Nothing expiring soon.</p>
      ) : (
        <div className="flex flex-col gap-2">
          {rows.map((r) => (
            <RowShell key={r.quoteId} href={financeTabHref(r.project.id)}>
              <div className="min-w-0">
                <p className="truncate text-[14px] font-medium text-ink">
                  {r.project.projectNumber} v{r.version} — {r.project.name}
                </p>
                <p className="t-micro text-muted">
                  {r.project.clientName ?? "No client"} · Valid until {r.validUntil ? formatDate(new Date(r.validUntil)) : "—"}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <Badge status={intentToBadgeStatus(quoteStatusIntent(r.status))}>
                  {r.status === "EXPIRED" ? "Expired" : r.daysLeft != null && r.daysLeft <= 0 ? "Expires today" : `${r.daysLeft}d left`}
                </Badge>
                <span className="text-[14px] font-medium tabular-nums text-ink">{formatCurrency(r.total)}</span>
                {r.status === "EXPIRED" && (
                  <Button type="button" variant="ghost" size="sm" onClick={(e) => acknowledge(e, r.quoteId)}>
                    <Check className="mr-1 h-3.5 w-3.5" /> Acknowledge
                  </Button>
                )}
              </div>
            </RowShell>
          ))}
        </div>
      )}
    </div>
  );
}

function NeverSentSection({ rows }: { rows: OrgFinanceNeverSentRow[] }) {
  return (
    <div className={TILE}>
      <SectionHeader icon={FileQuestion} title="Never sent" subtitle="Draft revisions sitting unfinished" count={rows.length} pillClass={SOFT_PILL} />
      {rows.length === 0 ? (
        <p className="t-micro text-muted">No unsent drafts.</p>
      ) : (
        <div className="flex flex-col gap-2">
          {rows.map((r) => (
            <RowShell key={r.quoteId} href={financeTabHref(r.project.id)}>
              <div className="min-w-0">
                <p className="truncate text-[14px] font-medium text-ink">
                  {r.project.projectNumber} v{r.version} — {r.project.name}
                </p>
                <p className="t-micro text-muted">
                  {r.project.clientName ?? "No client"} · {r.project.status ?? "—"}
                </p>
              </div>
              <span className="shrink-0 text-[14px] font-medium tabular-nums text-ink">{formatCurrency(r.total)}</span>
            </RowShell>
          ))}
        </div>
      )}
    </div>
  );
}

function DepositDueSection({ rows }: { rows: OrgFinanceProjectRow[] }) {
  return (
    <div className={TILE}>
      <SectionHeader icon={Wallet} title="Deposit due" subtitle="Deposit-balance clients with no deposit invoice issued" count={rows.length} pillClass={SOFT_PILL} />
      {rows.length === 0 ? (
        <p className="t-micro text-muted">No outstanding deposits.</p>
      ) : (
        <div className="flex flex-col gap-2">
          {rows.map((r) => (
            <RowShell key={r.project.id} href={financeTabHref(r.project.id)}>
              <div className="min-w-0">
                <p className="truncate text-[14px] font-medium text-ink">{r.project.projectNumber} — {r.project.name}</p>
                <p className="t-micro text-muted">
                  {r.project.clientName ?? "No client"} · {r.project.status ?? "—"}
                </p>
              </div>
              <span className={cn("shrink-0 rounded-full px-2 py-0.5 text-badge font-medium", SOFT_PILL)}>
                {r.depositPercent}% deposit
              </span>
            </RowShell>
          ))}
        </div>
      )}
    </div>
  );
}

function OutstandingSection({ rows }: { rows: OrgFinanceInvoiceRow[] }) {
  return (
    <div className={TILE}>
      <SectionHeader icon={CircleDollarSign} title="Outstanding" subtitle="Issued, unreconciled — not confirmed payment (see note below)" count={rows.length} pillClass={HARD_PILL} />
      {rows.length === 0 ? (
        <p className="t-micro text-muted">Nothing outstanding.</p>
      ) : (
        <div className="flex flex-col gap-2">
          {rows.map((r) => (
            <RowShell key={r.invoiceId} href={financeTabHref(r.project.id)}>
              <div className="min-w-0">
                <p className="truncate text-[14px] font-medium text-ink">
                  {r.invoiceNumber ?? `${r.kind} invoice`} — {r.project.projectNumber} {r.project.name}
                </p>
                <p className="t-micro text-muted">
                  {r.project.clientName ?? "No client"} · {r.dueDate ? `Due ${formatDate(new Date(r.dueDate))}` : r.issuedAt ? `Issued ${formatDate(new Date(r.issuedAt))}` : "—"}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <Badge status={r.paymentStatus === "PARTIALLY_PAID" ? "warn" : "overbooked"}>{r.paymentStatus.replace("_", " ")}</Badge>
                <span className="text-[14px] font-medium tabular-nums text-ink">{formatCurrency(r.total)}</span>
              </div>
            </RowShell>
          ))}
        </div>
      )}
    </div>
  );
}

function LoadingSkeleton() {
  return (
    <div className="space-y-4">
      <Skeleton className="h-40 w-full rounded-[var(--r-lg)]" />
      <Skeleton className="h-40 w-full rounded-[var(--r-lg)]" />
      <Skeleton className="h-40 w-full rounded-[var(--r-lg)]" />
    </div>
  );
}

function AllClearState() {
  return (
    <div className={cn(TILE, "flex flex-col items-center gap-3 py-16 text-center")}>
      <FlowMascot className="h-12 w-12" eyeColor="var(--ok)" />
      <div>
        <p className="text-[15px] font-medium text-ink">Nothing to chase.</p>
        <p className="t-micro text-muted">No quotes out, nothing expiring, and nothing unsent.</p>
      </div>
    </div>
  );
}

function totalRowCount(data: OrgFinanceBundle): number {
  return (
    data.quotesOut.length +
    data.expiring.length +
    data.neverSent.length +
    data.depositDue.length +
    data.outstanding.length
  );
}

/** Case-insensitive substring match against a row's client name. No matcher
 *  (`clientQuery` empty) passes everything through unchanged. */
function matchesClient(clientName: string | null, query: string): boolean {
  if (!query.trim()) return true;
  return (clientName ?? "").toLowerCase().includes(query.trim().toLowerCase());
}

export default function FinancePage() {
  const { data: activeOrg } = useActiveOrganization();
  const orgId = activeOrg?.id;
  const { data, isLoading } = useNativeOrgFinance(orgId);
  const [clientQuery, setClientQuery] = useState("");

  // Client-side filter over the already-bounded, org-scoped aggregation — the
  // dataset here is capped server-side (financeOrg.ts's SECTION_CAP), so this
  // is a filter over a small result set, not a second unbounded scan. PM
  // filtering is intentionally out of scope: there is no project-manager
  // display-name resolution anywhere in the app yet (projectManagerId is a
  // bare Better-Auth user id with no name lookup wired up) — better to leave
  // it out than fake a broken filter.
  const filtered = useMemo(() => {
    if (!data) return undefined;
    return {
      quotesOut: data.quotesOut.filter((r) => matchesClient(r.project.clientName, clientQuery)),
      expiring: data.expiring.filter((r) => matchesClient(r.project.clientName, clientQuery)),
      neverSent: data.neverSent.filter((r) => matchesClient(r.project.clientName, clientQuery)),
      depositDue: data.depositDue.filter((r) => matchesClient(r.project.clientName, clientQuery)),
      outstanding: data.outstanding.filter((r) => matchesClient(r.project.clientName, clientQuery)),
    };
  }, [data, clientQuery]);

  return (
    <RequirePermission resource="invoice" action="read">
      <div className="space-y-6">
        <PageHeader
          title="Finance"
          description="Every quote and invoice that needs a decision, org-wide — deep-link into a project's Finance tab to act."
          actions={<SearchInput placeholder="Filter by client…" value={clientQuery} onChange={(e) => setClientQuery(e.target.value)} className="w-64" />}
        />

        {isLoading || !filtered ? (
          <LoadingSkeleton />
        ) : totalRowCount(data!) === 0 ? (
          <AllClearState />
        ) : (
          <div className="space-y-4">
            <QuotesOutSection rows={filtered.quotesOut} />
            <ExpiringSection rows={filtered.expiring} />
            <NeverSentSection rows={filtered.neverSent} />
            <DepositDueSection rows={filtered.depositDue} />
            <OutstandingSection rows={filtered.outstanding} />
          </div>
        )}
      </div>
    </RequirePermission>
  );
}
