/**
 * The Timesheets list as data (UX Phase 15, spec §9h.4): URL spec, strip,
 * filter words, columns, query args and the row mapping. Pure: no React, no
 * router, no Convex. `timesheets-list.tsx` supplies the queries and handlers.
 *
 * Pay (D49): `Rate (pay)` and `Total` are columns ONLY when the server said
 * so (`payVisible` on `crewTimeEntries.allEntries`); the client never infers
 * it from the role. Blank pay stays blank, a day rate already carried by an
 * earlier entry prints `incl.`, never $0.
 */
import type { ListFilterDef, ListSegment } from "@/components/ui/list-page-parts";
import { LIST_PAGE_SIZE, type ListUrlSpec, type ListUrlState } from "@/lib/list-url-state";
import type { LegacyKeyAliases } from "@/lib/list-views/saved-view-url";
import { factText } from "@/lib/primitives/facts";
import type { ActionMenuSpec, Fact, FactColumn, LineRowData } from "@/lib/primitives/types";
import { getStatusIntent } from "@/lib/status-colors";
import { timeEntryStatusLabels } from "@/lib/status-labels";

// ─── Strip ───────────────────────────────────────────────────────────────

/** `Submitted · Approved · Queried · All`; Draft and Exported live under `Status ▾` and All. */
const SEGMENT_DEFS = [
  { key: "submitted", label: "Submitted", status: "SUBMITTED" },
  { key: "approved", label: "Approved", status: "APPROVED" },
  { key: "queried", label: timeEntryStatusLabels.DISPUTED, status: "DISPUTED" },
  { key: "all", label: "All", status: null },
] as const;

/** The per-status counts `allEntries` returns (search + person applied, status not). */
export type TimesheetCounts = Partial<Record<"DRAFT" | "SUBMITTED" | "APPROVED" | "DISPUTED" | "EXPORTED" | "all", number>>;

export function timesheetSegments(counts: TimesheetCounts | undefined): ListSegment[] {
  return SEGMENT_DEFS.map((s) => ({ key: s.key, label: s.label, count: counts?.[s.status ?? "all"] }));
}

// ─── URL spec ────────────────────────────────────────────────────────────

/** Submitted first: the entries waiting for a decision (the prototype's default). */
export const TIMESHEETS_SPEC: ListUrlSpec = {
  segments: SEGMENT_DEFS.map((s) => s.key),
  filters: ["status", "person"],
  sorts: ["crewMember", "date", "totalHours", "status"],
  defaultSort: "date:desc",
};

/** Old `/crew/timesheets` saved views stored the person filter as `crewMemberId`. */
export const TIMESHEETS_VIEW_ALIASES: LegacyKeyAliases = { crewMemberId: "person" };

// ─── Filter words ────────────────────────────────────────────────────────

const TIME_ENTRY_STATUS_ORDER = ["DRAFT", "SUBMITTED", "APPROVED", "DISPUTED", "EXPORTED"] as const;

export interface PersonOption {
  id: string;
  name: string;
}

export function timesheetFilters(
  people: PersonOption[],
  personSearch: { value: string; onChange: (v: string) => void },
): ListFilterDef[] {
  const needle = personSearch.value.trim().toLowerCase();
  const shown = needle ? people.filter((p) => p.name.toLowerCase().includes(needle)) : people;
  return [
    {
      key: "person",
      label: "Person",
      options: shown.slice(0, 100).map((p) => ({ value: p.id, label: p.name })),
      search: { ...personSearch, placeholder: "Search people" },
    },
    { key: "status", label: "Status", options: TIME_ENTRY_STATUS_ORDER.map((s) => ({ value: s, label: timeEntryStatusLabels[s] })) },
  ];
}

// ─── Columns ─────────────────────────────────────────────────────────────

const PAY_COLUMN_IDS = new Set(["rate", "total"]);

const ALL_COLUMNS: FactColumn[] = [
  { id: "job", header: "Job" },
  { id: "date", header: "Date", sortKey: "date" },
  { id: "hours", header: "Hours", align: "end", sortKey: "totalHours" },
  { id: "rate", header: "Rate (pay)", align: "end" },
  { id: "total", header: "Total", align: "end" },
  { id: "status", header: "Status", sortKey: "status" },
  // Opt-in from ⋯ › Columns.
  { id: "approvedBy", header: "Approved by", optional: true },
  { id: "notes", header: "Notes", optional: true },
];

/** The columns for this caller: pay only when the server returned it. */
export function timesheetColumns(payVisible: boolean): FactColumn[] {
  return payVisible ? ALL_COLUMNS : ALL_COLUMNS.filter((c) => !PAY_COLUMN_IDS.has(c.id));
}

export const TIMESHEET_ITEM_HEADER = "Person";
export const TIMESHEET_ITEM_SORT_KEY = "crewMember";

// ─── Query ───────────────────────────────────────────────────────────────

/** Matches nothing: a strip word and a Status choice that share no status. */
const NO_STATUS = "__none__";

function segmentStatus(seg: string): string | null {
  return SEGMENT_DEFS.find((s) => s.key === seg)?.status ?? null;
}

/** The strip and `Status ▾` both narrow by status: the list shows their intersection. */
export function statusFilterOf(state: ListUrlState): string[] | undefined {
  const fromSeg = segmentStatus(state.seg);
  const chosen = state.filters.status?.filter((s) => (TIME_ENTRY_STATUS_ORDER as readonly string[]).includes(s));
  if (!fromSeg) return chosen?.length ? chosen : undefined;
  if (!chosen?.length) return [fromSeg];
  return chosen.includes(fromSeg) ? [fromSeg] : [NO_STATUS];
}

/** What `crewTimeEntries.allEntries` is called with for a URL state (no clock read). */
export function timesheetsQueryArgs(state: ListUrlState) {
  const status = statusFilterOf(state);
  const person = state.filters.person;
  return {
    search: state.q.trim() || undefined,
    filters: { ...(status ? { status } : {}), ...(person?.length ? { crewMemberId: person } : {}) },
    page: state.page,
    pageSize: LIST_PAGE_SIZE,
    sortBy: state.sortBy,
    sortOrder: state.sortOrder,
  };
}

// ─── Rows ────────────────────────────────────────────────────────────────

/** The fields of an `allEntries` row the list reads. Pay keys exist only when the server sent them. */
export interface TimeEntrySource {
  id: string;
  crewMemberId: string;
  assignmentId: string | null;
  description: string | null;
  date: string;
  startTime: string;
  endTime: string;
  breakMinutes: number;
  totalHours: number | null;
  status: string;
  notes: string | null;
  queryReason: string | null;
  updatedAtMs: number | null;
  rate?: number | null;
  rateType?: string | null;
  total?: number | null;
  rateIncluded?: boolean;
  crewMember: { id: string; firstName: string; lastName: string } | null;
  assignment: {
    id: string;
    project: { id: string; name: string; projectNumber: string } | null;
    crewRole: { name: string } | null;
  } | null;
  approvedBy: { name: string | null } | null;
}

export function personName(e: TimeEntrySource): string {
  const m = e.crewMember;
  return m ? `${m.firstName} ${m.lastName}`.trim() : "Crew member";
}

/** `Fri 7 Nov` — entries are stored at UTC midnight, so the day is read in UTC. */
export function entryDay(iso: string): string {
  return new Date(iso).toLocaleDateString("en-AU", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" }).replace(",", "");
}

function hoursText(h: number | null | undefined): string {
  if (h == null) return "—";
  return `${Math.round(h * 100) / 100}h`;
}

const RATE_UNIT: Record<string, string> = { HOURLY: "/h", DAILY: "/day", FLAT: " flat" };

/** `$450/day`; blank when nothing in the cascade resolved (never $0). */
function rateText(e: TimeEntrySource): string {
  if (e.rate == null) return "—";
  return `${factText({ kind: "money", amount: e.rate })}${RATE_UNIT[e.rateType ?? ""] ?? ""}`;
}

/** A day rate already carried by an earlier entry prints `incl.`; blank stays blank. */
function totalFact(e: TimeEntrySource): Fact {
  if (e.rateIncluded) return { kind: "text", label: "incl." };
  return { kind: "money", amount: e.total ?? null };
}

/** `#2336 Hilton gala` or `General`. */
export function jobText(e: TimeEntrySource): string {
  const p = e.assignment?.project;
  return p ? `${p.projectNumber} ${p.name}` : "General";
}

/** `08:00–16:30 · 30m break`. */
export function timesText(e: TimeEntrySource): string {
  return `${e.startTime}–${e.endTime}${e.breakMinutes > 0 ? ` · ${e.breakMinutes}m break` : ""}`;
}

function statusFact(status: string): { status: LineRowData["status"]; fact: Fact } {
  const label = timeEntryStatusLabels[status] ?? status;
  return { status: { label, intent: getStatusIntent("timeEntry", status) }, fact: { kind: "text", label } };
}

/** Desktop facts: every column, the pay ones only when present. */
function desktopFacts(e: TimeEntrySource, statusText: Fact): Record<string, Fact> {
  const facts: Record<string, Fact> = {
    job: { kind: "text", label: jobText(e) },
    date: { kind: "text", label: entryDay(e.date) },
    hours: { kind: "text", label: hoursText(e.totalHours) },
    status: statusText,
  };
  if ("rate" in e) facts.rate = { kind: "text", label: rateText(e) };
  if ("total" in e) facts.total = totalFact(e);
  if (e.approvedBy?.name) facts.approvedBy = { kind: "text", label: e.approvedBy.name };
  if (e.notes) facts.notes = { kind: "text", label: e.notes };
  return facts;
}

/**
 * Phone card (§9h.6): name, `#2336 · Fri 7 · 9h · Submitted`, the total on the
 * right. Only the facts the card prints, so the subtitle stays one line.
 */
function phoneFacts(e: TimeEntrySource, statusText: Fact): Record<string, Fact> {
  const facts: Record<string, Fact> = {
    job: { kind: "text", label: e.assignment?.project?.projectNumber ?? "General" },
    date: { kind: "text", label: entryDay(e.date) },
    hours: { kind: "text", label: hoursText(e.totalHours) },
    status: statusText,
  };
  if ("total" in e) facts.total = totalFact(e);
  return facts;
}

export function timeEntryRowOf(e: TimeEntrySource, opts: { phone: boolean; menu?: ActionMenuSpec; onOpen?: () => void }): LineRowData {
  const { status, fact } = statusFact(e.status);
  return {
    id: e.id,
    kind: "crew",
    title: personName(e),
    subtitle: opts.phone ? undefined : e.assignment?.crewRole?.name ?? undefined,
    facts: opts.phone ? phoneFacts(e, fact) : desktopFacts(e, fact),
    status,
    menu: opts.menu,
    onOpen: opts.onOpen,
  };
}

/** Totals line (§9h.4): `Totals · 361h · $16,962`; the money only for a pay-visible caller. */
export function totalsText(totals: { hours: number; pay?: number } | undefined, payVisible: boolean): string | null {
  if (!totals) return null;
  const parts = ["Totals", hoursText(totals.hours)];
  if (payVisible && totals.pay != null) parts.push(factText({ kind: "money", amount: totals.pay }));
  return parts.join(" · ");
}
