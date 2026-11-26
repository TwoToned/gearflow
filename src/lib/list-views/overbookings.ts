/**
 * The Overbookings & Gaps board as a LIST (UX unification §9g, Phase 14a-4). Pure. The server still answers with
 * ONE reactive bundle (`overbookingBoard.bundle`, six sections over one window), so this module flattens it into
 * rows, filters by Kind, orders, and pages in memory: nothing here re-derives what is short (the board's own
 * computations stand), it only names and prints it.
 *
 * The window is the strip (`This week · Next 30 days · All`), carried in the URL like every list (D11); the old
 * `?days=` link is kept as an alias (`segFromDays`) and the localStorage range key is gone.
 */
import { formatDate } from "@/lib/formatters";
import { shortDaysText } from "@/lib/crew-short-days";
import { LIST_PAGE_SIZE, type ListUrlSpec, type ListUrlState } from "@/lib/list-url-state";
import type { ListFilterDef, ListSegment } from "@/components/ui/list-page-parts";
import type { ActionMenuSpec, Fact, FactColumn, LineRowData, StatusValue } from "@/lib/primitives/types";
import type { OverbookingBoardData } from "@/hooks/use-native-overbooking-board";

const SEGMENT_DEFS = [
  { key: "week", label: "This week", days: 7 },
  { key: "month", label: "Next 30 days", days: 30 },
  { key: "all", label: "All", days: 90 },
] as const;

export type OverbookingSegment = (typeof SEGMENT_DEFS)[number]["key"];

export const OVERBOOKINGS_SPEC: ListUrlSpec = {
  segments: SEGMENT_DEFS.map((s) => s.key),
  filters: ["kind"],
  sorts: ["severity", "what", "when"],
  defaultSort: "severity:asc",
};

/** The board window, in days, for a strip word. */
export function daysForSegment(seg: string): number {
  return SEGMENT_DEFS.find((s) => s.key === seg)?.days ?? 7;
}

/** The old `?days=` link: 7 is the week, 30 the month, anything longer or odd is All. Null = not a number. */
export function segFromDays(raw: string | null): OverbookingSegment | null {
  const n = raw ? Number.parseInt(raw, 10) : Number.NaN;
  if (!Number.isFinite(n) || n <= 0) return null;
  if (n <= 7) return "week";
  return n <= 30 ? "month" : "all";
}

export function overbookingSegments(activeSeg: string, total: number | undefined): ListSegment[] {
  // Only the open window is loaded (one bundle per window), so only it can carry a count.
  return SEGMENT_DEFS.map((s) => ({ key: s.key, label: s.label, count: s.key === activeSeg ? total : undefined }));
}

const KIND_OPTIONS = [
  { value: "overbooked", label: "Overbooked" },
  { value: "pencilled", label: "Pencilled" },
  { value: "sale", label: "Sale stock" },
  { value: "crew", label: "Crew" },
] as const;
type KindGroup = (typeof KIND_OPTIONS)[number]["value"];

export function overbookingFilters(): ListFilterDef[] {
  return [{ key: "kind", label: "Kind", options: KIND_OPTIONS.map((k) => ({ value: k.value, label: k.label })) }];
}

export const OVERBOOKING_ITEM_HEADER = "Issue";
export const OVERBOOKING_ITEM_SORT_KEY = "what";

export const OVERBOOKING_COLUMNS: FactColumn[] = [
  { id: "kind", header: "Kind", sortKey: "severity" },
  { id: "short", header: "Short", align: "end" },
  { id: "when", header: "When", sortKey: "when" },
  { id: "jobs", header: "Jobs" },
];

export interface OverbookingRowSource {
  id: string;
  /** The Kind filter word this row belongs to. */
  group: KindGroup;
  /** The inline kind word: `Overbooked`, `Pencilled`, `Sale stock`, `Crew missing`, `Crew unconfirmed`, `Crew clash`. */
  kindLabel: string;
  severity: "hard" | "soft";
  title: string;
  /** `2 short`, `3 to procure`, `0/2`, a status. */
  shortText: string;
  /** Sort value for When: the start of the span (null sorts last). */
  whenAt: number | null;
  whenText: string;
  jobs: { id: string; projectNumber: string; name: string }[];
  /** Where a click goes: the first job, or the model for sale stock. */
  href: string;
  modelId?: string;
  /** Present only for a hard gear row: the existing prefilled sub-hire dialog's input. */
  subHire?: { modelName: string; qty: number; projects: { id: string; name: string; projectNumber: string }[] };
}

const span = (a: number | null, b: number | null): string => {
  if (a == null) return "—";
  return b != null && b !== a ? `${formatDate(new Date(a))} – ${formatDate(new Date(b))}` : formatDate(new Date(a));
};

type Gear = OverbookingBoardData["gearHard"][number];

function gearRow(r: Gear, hard: boolean): OverbookingRowSource {
  return {
    id: `gear:${hard ? "hard" : "soft"}:${r.modelId}`,
    group: hard ? "overbooked" : "pencilled",
    kindLabel: hard ? "Overbooked" : "Pencilled",
    severity: hard ? "hard" : "soft",
    title: r.modelName,
    shortText: `${r.qty} short`,
    whenAt: r.spanStart,
    whenText: span(r.spanStart, r.spanEnd),
    jobs: r.projects,
    href: r.projects[0] ? `/projects/${r.projects[0].id}` : `/assets/models/${r.modelId}`,
    modelId: r.modelId,
    ...(hard ? { subHire: { modelName: r.modelName, qty: r.qty, projects: r.projects } } : {}),
  };
}

function saleRows(data: OverbookingBoardData): OverbookingRowSource[] {
  return data.saleStockToProcure.map((r) => ({
    id: `sale:${r.modelId}`,
    group: "sale" as const,
    kindLabel: "Sale stock",
    severity: "soft" as const,
    title: r.modelName,
    shortText: `${r.shortfallQty} to procure`,
    whenAt: null,
    whenText: "—",
    jobs: r.contributingSaleLines.map((l) => ({ id: l.projectId, projectNumber: l.projectNumber, name: l.projectName })),
    href: `/assets/models/${r.modelId}`,
    modelId: r.modelId,
  }));
}

function crewRows(data: OverbookingBoardData): OverbookingRowSource[] {
  const missing = data.servicesMissingCrew.map((r) => ({
    id: `svc:${r.serviceId}`,
    group: "crew" as const,
    kindLabel: "Crew missing",
    severity: "hard" as const,
    title: `${r.title}: ${r.projectNumber} ${r.projectName}`,
    shortText: `${r.assignedCount}/${r.crewCountRequired}`,
    whenAt: r.date,
    whenText: [r.date != null ? formatDate(new Date(r.date)) : "No date", shortDaysText(r)].filter(Boolean).join(" · "),
    jobs: [{ id: r.projectId, projectNumber: r.projectNumber, name: r.projectName }],
    href: `/projects/${r.projectId}`,
  }));
  const unconfirmed = data.unconfirmedCrew.map((r) => ({
    id: `asg:${r.assignmentId}`,
    group: "crew" as const,
    kindLabel: "Crew unconfirmed",
    severity: "soft" as const,
    title: `${r.projectNumber} ${r.projectName}`,
    shortText: r.status,
    whenAt: r.startDate,
    whenText: r.startDate != null ? `Starts ${formatDate(new Date(r.startDate))}` : "—",
    jobs: [{ id: r.projectId, projectNumber: r.projectNumber, name: r.projectName }],
    href: `/projects/${r.projectId}`,
  }));
  const clashes = data.crewDoubleBookings.map((r, i) => ({
    id: `dbl:${r.crewMemberId}:${i}`,
    group: "crew" as const,
    kindLabel: "Crew clash",
    severity: r.severity,
    title: r.label,
    shortText: r.severity,
    whenAt: r.a.startDate,
    whenText: span(r.a.startDate, r.a.endDate),
    jobs: [r.a, ...(r.b ? [r.b] : [])].map((p) => ({ id: p.projectId, projectNumber: p.projectNumber, name: p.projectName })),
    href: `/projects/${r.a.projectId}`,
  }));
  return [...missing, ...unconfirmed, ...clashes];
}

/** Pure: every issue on the board as one flat list (the board's own computations, unchanged). */
export function flattenBoard(data: OverbookingBoardData): OverbookingRowSource[] {
  return [...data.gearHard.map((r) => gearRow(r, true)), ...data.gearPencilled.map((r) => gearRow(r, false)), ...saleRows(data), ...crewRows(data)];
}

/** Pure: keep the rows whose Kind group is chosen (no choice = all). */
export function filterByKind(rows: OverbookingRowSource[], kinds: string[] | undefined): OverbookingRowSource[] {
  return kinds?.length ? rows.filter((r) => kinds.includes(r.group)) : rows;
}

/** Pure: order the rows. Severity puts hard before soft (then by Kind, then date); What is A to Z; When is soonest first, undated last. */
export function sortRows(rows: OverbookingRowSource[], sortBy: string, order: "asc" | "desc"): OverbookingRowSource[] {
  const dir = order === "desc" ? -1 : 1;
  const byWhen = (a: OverbookingRowSource, b: OverbookingRowSource) => (a.whenAt ?? Number.POSITIVE_INFINITY) - (b.whenAt ?? Number.POSITIVE_INFINITY);
  const bySeverity = (a: OverbookingRowSource, b: OverbookingRowSource) =>
    (a.severity === b.severity ? 0 : a.severity === "hard" ? -1 : 1) || a.kindLabel.localeCompare(b.kindLabel) || byWhen(a, b);
  const cmp = sortBy === "what" ? (a: OverbookingRowSource, b: OverbookingRowSource) => a.title.localeCompare(b.title) : sortBy === "when" ? byWhen : bySeverity;
  return [...rows].sort((a, b) => cmp(a, b) * dir || a.id.localeCompare(b.id));
}

/** Pure: the rows of one page (1-based). */
export function pageRows<T>(rows: T[], page: number): T[] {
  return rows.slice((page - 1) * LIST_PAGE_SIZE, page * LIST_PAGE_SIZE);
}

/** Pure: the rows for a list state (kind filter, sort, search by title/jobs). Page is applied by the caller. */
export function rowsForState(all: OverbookingRowSource[], state: ListUrlState): OverbookingRowSource[] {
  const q = state.q.trim().toLowerCase();
  const searched = q ? all.filter((r) => [r.title, r.kindLabel, ...r.jobs.map((j) => `${j.projectNumber} ${j.name}`)].some((t) => t.toLowerCase().includes(q))) : all;
  return sortRows(filterByKind(searched, state.filters.kind), state.sortBy, state.sortOrder);
}

const STATUS: Record<OverbookingRowSource["severity"], StatusValue["intent"]> = { hard: "error", soft: "warning" };

export function overbookingRowOf(r: OverbookingRowSource, menu?: ActionMenuSpec): LineRowData {
  const facts: Record<string, Fact> = {
    kind: { kind: "text", label: r.kindLabel },
    short: { kind: "text", label: r.shortText },
    when: { kind: "text", label: r.whenText },
    jobs: r.jobs.length ? { kind: "text", label: r.jobs.map((j) => j.projectNumber).join(", ") } : { kind: "text", label: "—" },
  };
  return {
    id: r.id,
    kind: "job",
    title: r.title,
    subtitle: r.kindLabel,
    facts,
    status: { label: r.severity === "hard" ? "Hard" : "Soft", intent: STATUS[r.severity] },
    menu,
    href: r.href,
  };
}
