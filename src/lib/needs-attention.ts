import { DASHBOARD_LINKS, blockerLink, type DashboardLink } from "@/lib/dashboard-links";

/**
 * Home's Needs attention lines (UX Phase 11, §6c.2), derived from the counts
 * the widget already reads. Pure, so the order, the wording, the suppression
 * and the gating are testable without a Convex client.
 *
 * A source is `undefined` when its query was skipped (the role can't open that
 * list) or is still loading: its line is then ABSENT, never a zero or a
 * greyed-out row. A count of 0 is absent too: a line only exists while there
 * is something to do.
 */
export type NeedsAttentionTone = "error" | "warning" | "info";

export interface NeedsAttentionLine {
  key: string;
  /** The mono figure (`3`, `200+`). */
  count: string;
  /** The words after the figure (`overdue returns`). */
  text: string;
  tone: NeedsAttentionTone;
  link: DashboardLink;
  /** Optional trailing fact (`$16,975 outstanding`). */
  detail?: string;
}

export interface NeedsAttentionInput {
  blockers?: { projectId: string }[];
  stats?: { overdueReturnJobs?: number; overdueTruncated?: boolean };
  maintenance?: { maintenanceDue?: number; modelsDueForService?: number };
  subHireOverdue?: number;
  overbookings?: { hardCount: number; pencilledCount: number; saleStockCount: number };
  crewOffers?: number;
  finance?: {
    overdueCount?: number;
    overdueOutstanding?: number;
    overdueTruncated?: boolean;
    expiringCount: number;
    quotesOutCount: number;
  };
  /** The Overdue returns stat tile is on the board: its line is suppressed (the same fact never twice). */
  overdueTileOnBoard: boolean;
  formatMoney: (n: number) => string;
}

function line(
  key: string,
  n: number | undefined,
  noun: [string, string],
  tone: NeedsAttentionTone,
  link: DashboardLink,
  extra: { truncated?: boolean; detail?: string } = {},
): NeedsAttentionLine | null {
  if (!n || n <= 0) return null;
  return {
    key,
    count: `${n}${extra.truncated ? "+" : ""}`,
    text: n === 1 ? noun[0] : noun[1],
    tone,
    link,
    ...(extra.detail ? { detail: extra.detail } : {}),
  };
}

function jobLines(i: NeedsAttentionInput): (NeedsAttentionLine | null)[] {
  const first = i.blockers?.[0];
  return [
    first ? line("blockers", i.blockers?.length, ["blocker needs you", "blockers need you"], "error", blockerLink(first.projectId)) : null,
    i.overdueTileOnBoard
      ? null
      : line("overdueReturns", i.stats?.overdueReturnJobs, ["overdue return", "overdue returns"], "error", DASHBOARD_LINKS.overdueReturns, {
          truncated: i.stats?.overdueTruncated,
        }),
    line("subHireOverdue", i.subHireOverdue, ["sub-hire overdue", "sub-hires overdue"], "error", DASHBOARD_LINKS.subHireOverdue),
  ];
}

function invoiceLine(i: NeedsAttentionInput): NeedsAttentionLine | null {
  const f = i.finance;
  if (!f) return null;
  const owed = f.overdueOutstanding ?? 0;
  return line("invoicesOverdue", f.overdueCount, ["invoice overdue", "invoices overdue"], "error", DASHBOARD_LINKS.invoicesOverdue, {
    truncated: f.overdueTruncated,
    detail: owed > 0 ? `${i.formatMoney(owed)} outstanding` : undefined,
  });
}

function gearLines(i: NeedsAttentionInput): (NeedsAttentionLine | null)[] {
  const o = i.overbookings;
  const m = i.maintenance;
  return [
    line("hardOverbookings", o?.hardCount, ["hard overbooking", "hard overbookings"], "error", DASHBOARD_LINKS.overbookings),
    line("pencilled", o?.pencilledCount, ["pencilled collision", "pencilled collisions"], "warning", DASHBOARD_LINKS.overbookings),
    line("saleStock", o?.saleStockCount, ["sale stock to procure", "sale stock to procure"], "warning", DASHBOARD_LINKS.overbookings),
    line("maintenanceDue", m?.maintenanceDue, ["maintenance due", "maintenance due"], "warning", DASHBOARD_LINKS.maintenanceDue),
    line("modelsDue", m?.modelsDueForService, ["model due for service", "models due for service"], "warning", DASHBOARD_LINKS.modelsDueForService),
  ];
}

function peopleAndQuoteLines(i: NeedsAttentionInput): (NeedsAttentionLine | null)[] {
  return [
    line("crewOffers", i.crewOffers, ["crew offer pending", "crew offers pending"], "info", DASHBOARD_LINKS.crewOffers),
    line("quotesExpiring", i.finance?.expiringCount, ["quote expiring", "quotes expiring"], "warning", DASHBOARD_LINKS.quotes),
    line("quotesOut", i.finance?.quotesOutCount, ["quote out", "quotes out"], "info", DASHBOARD_LINKS.quotes),
  ];
}

/** The lines in their fixed order: jobs, money, gear, people and quotes. */
export function buildNeedsAttentionLines(i: NeedsAttentionInput): NeedsAttentionLine[] {
  return [...jobLines(i), invoiceLine(i), ...gearLines(i), ...peopleAndQuoteLines(i)].filter(
    (l): l is NeedsAttentionLine => l !== null,
  );
}
