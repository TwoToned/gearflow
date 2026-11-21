import { resolveRate } from "./crewRate";

/**
 * Timesheet money (UX Phase 15, D49): the PAY rate and the total an approval
 * commits to. DERIVED on read, never stored (R-3.1: a stored total would
 * contradict the entry the moment its hours or the rate changed).
 *
 * - **Rate** is the cost cascade every crew booking already uses
 *   (`resolveRate`, convex/lib/crewRate.ts): the assignment's override → the
 *   member's day rate → the member's hourly rate → the role default. A general
 *   (job-less) entry uses the member and the member's own role. Nothing
 *   resolved ⇒ `null` (blank), never `$0`.
 * - **Total**: `HOURLY` = rate × the entry's hours. `DAILY` = the day rate ONCE
 *   per person per calendar day, however many entries that day has (owner,
 *   2026-11-21): the earliest entry carries it and the rest are `included`.
 *   `FLAT` = the flat rate ONCE per person per assignment, the same way
 *   `calculateEstimatedCost` books a flat call.
 *
 * Plain module: Convex reads and the Node CSV export share it, so the two can
 * never print different totals.
 */

export interface MoneyEntry {
  id: string;
  crewMemberId: string;
  assignmentId?: string | null;
  date: number;
  startTime: string;
  totalHours?: number | null;
}

export interface MoneyAssignment {
  crewRoleId?: string | null;
  rateOverride?: number | null;
  rateType?: string | null;
}

export interface MoneyMember {
  crewRoleId?: string | null;
  defaultDayRate?: number | null;
  defaultHourlyRate?: number | null;
}

export interface MoneyRole {
  defaultRate?: number | null;
  rateType?: string | null;
}

export interface MoneyLookups {
  assignment: (id: string) => MoneyAssignment | null | undefined;
  member: (id: string) => MoneyMember | null | undefined;
  role: (id: string) => MoneyRole | null | undefined;
}

export interface EntryMoney {
  /** The pay rate, or null when nothing in the cascade resolves. */
  rate: number | null;
  rateType: string | null;
  /** This entry's share of the pay, or null (no rate, no hours, or `included`). */
  total: number | null;
  /** A DAILY/FLAT rate already carried by another entry of the same person. */
  included: boolean;
}

const cents = (n: number): number => Math.round(n * 100) / 100;

function roleFor(entry: MoneyEntry, asg: MoneyAssignment | null, member: MoneyMember | null, l: MoneyLookups): MoneyRole | null {
  const roleId = asg?.crewRoleId ?? member?.crewRoleId ?? null;
  return roleId ? l.role(roleId) ?? null : null;
}

/** The entry's pay rate through the shared cascade; null when it resolves to nothing. */
export function entryRate(entry: MoneyEntry, l: MoneyLookups): { rate: number; rateType: string } | null {
  const asg = entry.assignmentId ? l.assignment(entry.assignmentId) ?? null : null;
  const member = l.member(entry.crewMemberId) ?? null;
  const resolved = resolveRate(asg?.rateOverride ?? null, asg?.rateType ?? null, member ?? {}, roleFor(entry, asg, member, l));
  return resolved.rate > 0 ? resolved : null;
}

/** `YYYY-MM-DD` of an entry's date (entries are stored at UTC midnight). */
export function entryDayKey(date: number): string {
  return new Date(date).toISOString().slice(0, 10);
}

/** Which entries share one DAILY/FLAT charge: one person per day, or one person per assignment. */
function chargeKey(entry: MoneyEntry, rateType: string): string | null {
  if (rateType === "DAILY") return `${entry.crewMemberId}|day|${entryDayKey(entry.date)}`;
  if (rateType === "FLAT") return `${entry.crewMemberId}|asg|${entry.assignmentId ?? "general"}`;
  return null;
}

/** Earliest first: date, then start time, then id — so the carrier never depends on paging or filters. */
function byEarliest(a: MoneyEntry, b: MoneyEntry): number {
  return a.date - b.date || a.startTime.localeCompare(b.startTime) || a.id.localeCompare(b.id);
}

function hourlyTotal(rate: number, hours: number | null | undefined): number | null {
  return hours == null ? null : cents(rate * hours);
}

/**
 * Money for every entry in `entries`. Pass the WHOLE set the carrier rule must
 * see (every entry of the people shown), not one page, so which entry carries a
 * day rate is stable under paging and filters.
 */
export function deriveEntryMoney(entries: readonly MoneyEntry[], l: MoneyLookups): Map<string, EntryMoney> {
  const out = new Map<string, EntryMoney>();
  const carried = new Set<string>();
  for (const entry of [...entries].sort(byEarliest)) {
    const r = entryRate(entry, l);
    if (!r) {
      out.set(entry.id, { rate: null, rateType: null, total: null, included: false });
      continue;
    }
    const key = chargeKey(entry, r.rateType);
    if (key == null) {
      out.set(entry.id, { rate: r.rate, rateType: r.rateType, total: hourlyTotal(r.rate, entry.totalHours), included: false });
      continue;
    }
    const included = carried.has(key);
    carried.add(key);
    out.set(entry.id, { rate: r.rate, rateType: r.rateType, total: included ? null : cents(r.rate), included });
  }
  return out;
}

/** Sum of the non-null totals, to the cent. */
export function sumTotals(values: Iterable<EntryMoney | undefined>): number {
  let sum = 0;
  for (const v of values) if (v?.total != null) sum += v.total;
  return cents(sum);
}
