/**
 * The ONE merge/filter for "what the user has to look at" (UX unification D70):
 * the app-shell bell and `/notifications` read the same derived feed through
 * `selectVisibleNotifications`, and the bell additionally folds in the stored
 * mentions through `mergeShellFeed`. Pure, so the two surfaces cannot count a
 * different set (R-3.1).
 */
import type { AppNotification } from "@/server/notifications";

/** Display words for the derived feed's types (shared by the bell and `/notifications`). */
export const DERIVED_TYPE_LABELS: Record<string, string> = {
  overdue_maintenance: "Maintenance",
  overdue_return: "Overdue return",
  upcoming_project: "Upcoming",
  pending_invitation: "Invitation",
  pending_offers: "Crew",
  pending_timesheets: "Timesheets",
  flagged_asset: "Flagged",
  incident_report: "Incident",
  pending_join_requests: "Join request",
  quote_expiring: "Quote",
};

/** A derived (org-wide scan) notification the user has not dismissed. */
export function selectVisibleNotifications(
  feed: readonly AppNotification[] | undefined,
  ...dismissed: ReadonlySet<string>[]
): AppNotification[] {
  return (feed ?? []).filter((n) => !dismissed.some((set) => set.has(n.id)));
}

/** The structural slice of a stored `notifications` row the bell needs. */
export interface StoredMention {
  id: string;
  type: string;
  title: string;
  body?: string;
  href: string;
  createdAt: number;
  readAt?: number;
}

export interface ShellNotice {
  /** `derived:<key>` or `mention:<id>` — unique across both sources. */
  uid: string;
  source: "derived" | "mention";
  /** The dismissal key (derived) or the notification id (mention). */
  id: string;
  title: string;
  line: string;
  href: string;
  /** Epoch ms, for the dated row. */
  at: number;
  typeLabel: string;
  unread: boolean;
}

/** Derived rows count as unread for as long as they are visible; a mention is unread until `readAt`. */
export function mergeShellFeed(
  derived: readonly AppNotification[],
  mentions: readonly StoredMention[] | undefined,
): { items: ShellNotice[]; unreadCount: number } {
  const fromDerived: ShellNotice[] = derived.map((n) => ({
    uid: `derived:${n.id}`,
    source: "derived",
    id: n.id,
    title: n.title,
    line: n.description,
    href: n.href,
    at: new Date(n.timestamp).getTime(),
    typeLabel: DERIVED_TYPE_LABELS[n.type] ?? "Notice",
    unread: true,
  }));
  const fromMentions: ShellNotice[] = (mentions ?? []).map((m) => ({
    uid: `mention:${m.id}`,
    source: "mention",
    id: m.id,
    title: m.title,
    line: m.body ?? "",
    href: m.href,
    at: m.createdAt,
    typeLabel: "Mention",
    unread: !m.readAt,
  }));
  const items = [...fromDerived, ...fromMentions].sort((a, b) => b.at - a.at);
  return { items, unreadCount: items.filter((i) => i.unread).length };
}
