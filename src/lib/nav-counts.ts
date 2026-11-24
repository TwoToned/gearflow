/**
 * The phone More sheet's row counts (UX Phase 11, §6d.6): which source a NAV row
 * counts from (`count` on the row in `src/lib/nav.ts`), and how the figure reads.
 * Pure. Eight sources are `navCounts.get` (one capped, org- and role-checked count
 * each); Finance and Overbookings reuse their own existing counts queries.
 */
import type { NavCount, NavCountServerSource } from "../../convex/navCounts";

export type NavCountSource = NavCountServerSource | "invoicesOverdue" | "overbookings";

/**
 * The resource each count READS — the client skips the read unless the role
 * holds `read` on it (`canReadResource`), even where the row itself is visible
 * for another action. The same resources the server role-checks.
 */
export const NAV_COUNT_RESOURCE = {
  assets: "asset",
  testTagOverdue: "testTag",
  maintenance: "maintenance",
  returnsOverdue: "warehouse",
  clients: "client",
  suppliers: "supplier",
  locations: "location",
  crew: "crew",
  invoicesOverdue: "invoice",
  overbookings: "project",
} as const satisfies Record<NavCountSource, string>;

export type NavCountTone = "muted" | "warning" | "error";

export interface NavCountText {
  text: string;
  tone: NavCountTone;
}

const n = (c: NavCount) => `${c.value}${c.truncated ? "+" : ""}`;

/** A total (`605`, `200+`) — shown even at zero: it's a fact about the list, not an alert. */
const total = (c: NavCount): NavCountText => ({ text: n(c), tone: "muted" });

/** An exception (`2 overdue`) — absent at zero: nothing to chase means no word. */
const exception = (word: string, tone: NavCountTone) => (c: NavCount): NavCountText | null =>
  c.value > 0 ? { text: `${n(c)} ${word}`, tone } : null;

/** `20 open · 5 overdue` (warning while any are late), `20 open`, or nothing. */
function maintenanceText(c: NavCount): NavCountText | null {
  if (c.value <= 0) return null;
  const late = c.secondary ?? 0;
  return late > 0 ? { text: `${n(c)} open · ${late} overdue`, tone: "warning" } : { text: `${n(c)} open`, tone: "muted" };
}

const FORMAT: Record<NavCountSource, (c: NavCount) => NavCountText | null> = {
  assets: total,
  clients: total,
  suppliers: total,
  locations: total,
  crew: total,
  returnsOverdue: exception("overdue", "warning"),
  testTagOverdue: exception("overdue", "warning"),
  invoicesOverdue: exception("overdue", "error"),
  overbookings: exception("overbooked", "error"),
  maintenance: maintenanceText,
};

/** The row's trailing words, or null (loading, not readable by the role, or nothing to say). */
export function formatNavCount(source: NavCountSource, count: NavCount | null | undefined): NavCountText | null {
  return count ? FORMAT[source](count) : null;
}
