/**
 * The Jobs list as data (UX unification §9b): segments, filter words, columns,
 * URL spec and the row mapping. Pure: no React, no router, no Convex. The page
 * (`jobs-list.tsx`) supplies the queries and handlers; this module says what
 * the list IS, so a test can pin the mapping without rendering anything.
 */
import type { ListFilterDef, ListSegment } from "@/components/ui/list-page-parts";
import { toCsv } from "@/lib/csv";
import { defaultListState, LIST_PAGE_SIZE, type ListUrlSpec, type ListUrlState } from "@/lib/list-url-state";
import type { SavedViewConfig } from "@/lib/saved-views";
import type { ActionMenuSpec, Fact, FactColumn, LineRowData, RowFlag } from "@/lib/primitives/types";
import { projectStatusLabels } from "@/lib/status-labels";
import { getStatusIntent } from "@/lib/status-colors";
import { OUT_LABEL } from "@/lib/vocabulary";

// ─── Segments ────────────────────────────────────────────────────────────

/**
 * One entry per segment. `shipped: false` entries (D86: Active, overdue) are
 * kept as config so enabling one is a one-line change, but are NOT accepted
 * yet: the strip and the URL spec never see them.
 */
const SEGMENT_DEFS = [
  { key: "all", label: "All", shipped: true },
  { key: "quoting", label: "Quoting", shipped: true },
  { key: "booked", label: "Booked", shipped: true },
  { key: "out", label: OUT_LABEL, shipped: true },
  { key: "done", label: "Done", shipped: true },
  { key: "needs", label: "Needs you", shipped: true },
  { key: "active", label: "Active", shipped: false },
  { key: "overdue", label: "Overdue", shipped: false },
] as const;

const SHIPPED_SEGMENTS = SEGMENT_DEFS.filter((s) => s.shipped);

/** The strip: counts come from `projects.segmentCounts` (absent while loading). */
export function jobSegments(counts: Record<string, number> | undefined): ListSegment[] {
  return SHIPPED_SEGMENTS.map((s) => ({ key: s.key, label: s.label, count: counts?.[s.key] }));
}

// ─── URL spec ────────────────────────────────────────────────────────────

export const JOBS_SPEC: ListUrlSpec = {
  segments: SHIPPED_SEGMENTS.map((s) => s.key),
  // `show` carries `cancelled` (the page menu's Show cancelled); it has no filter word.
  filters: ["status", "type", "client", "pm", "date", "show"],
  sorts: ["projectNumber", "name", "status", "rentalStartDate", "type", "total", "client"],
  defaultSort: "rentalStartDate:asc",
  views: ["table", "board"],
};

// ─── Filter words ────────────────────────────────────────────────────────

const TYPE_LABELS: Record<string, string> = {
  DRY_HIRE: "Dry hire",
  WET_HIRE: "Wet hire",
  INSTALLATION: "Installation",
  TOUR: "Tour",
  CORPORATE: "Corporate",
  THEATRE: "Theatre",
  FESTIVAL: "Festival",
  CONFERENCE: "Conference",
  OTHER: "Other",
};

export const JOB_STATUS_ORDER = [
  "ENQUIRY",
  "QUOTING",
  "QUOTED",
  "AWAITING_PAYMENT",
  "CONFIRMED",
  "PREPPING",
  "CHECKED_OUT",
  "ON_SITE",
  "RETURNED",
  "COMPLETED",
  "INVOICED",
  "CANCELLED",
] as const;

/** The word for a status; CHECKED_OUT reads `Out` (vocabulary). */
export function jobStatusLabel(status: string): string {
  return status === "CHECKED_OUT" ? OUT_LABEL : (projectStatusLabels[status] ?? status);
}

const DATE_PRESETS = [
  { value: "this-week", label: "This week" },
  { value: "next-7", label: "Next 7 days" },
  { value: "this-month", label: "This month" },
  { value: "next-30", label: "Next 30 days" },
  { value: "past-30", label: "Past 30 days" },
] as const;

const DAY_MS = 24 * 60 * 60 * 1000;

function startOfDay(ms: number): number {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** A date preset as a window, from a stable `now` (never a fresh clock read). */
export function resolveDatePreset(preset: string | undefined, now: number): { dateFrom?: number; dateTo?: number } {
  const today = startOfDay(now);
  switch (preset) {
    case "this-week": {
      const monday = today - ((new Date(now).getDay() + 6) % 7) * DAY_MS;
      return { dateFrom: monday, dateTo: monday + 7 * DAY_MS - 1 };
    }
    case "next-7":
      return { dateFrom: today, dateTo: today + 7 * DAY_MS - 1 };
    case "this-month": {
      const d = new Date(now);
      return { dateFrom: new Date(d.getFullYear(), d.getMonth(), 1).getTime(), dateTo: new Date(d.getFullYear(), d.getMonth() + 1, 1).getTime() - 1 };
    }
    case "next-30":
      return { dateFrom: today, dateTo: today + 30 * DAY_MS - 1 };
    case "past-30":
      return { dateFrom: today - 30 * DAY_MS, dateTo: today - 1 };
    default:
      return {};
  }
}

export interface ClientOption {
  id: string;
  name: string;
}

/** The filter words. Client takes its own name search (value/onChange from the page). */
export function jobFilters(
  clients: ClientOption[],
  clientSearch: { value: string; onChange: (v: string) => void },
  /** Org members (user id + name): the PM filter's options. */
  pms: ClientOption[] = [],
): ListFilterDef[] {
  const needle = clientSearch.value.trim().toLowerCase();
  const shown = needle ? clients.filter((c) => c.name.toLowerCase().includes(needle)) : clients;
  return [
    { key: "status", label: "Status", options: JOB_STATUS_ORDER.map((s) => ({ value: s, label: jobStatusLabel(s) })) },
    { key: "type", label: "Type", options: Object.entries(TYPE_LABELS).map(([value, label]) => ({ value, label })) },
    {
      key: "client",
      label: "Client",
      options: shown.slice(0, 100).map((c) => ({ value: c.id, label: c.name })),
      search: { ...clientSearch, placeholder: "Search clients" },
    },
    { key: "pm", label: "PM", options: pms.map((m) => ({ value: m.id, label: m.name })) },
    { key: "date", label: "Dates", single: true, options: DATE_PRESETS.map((p) => ({ ...p })) },
  ];
}

// ─── Columns ─────────────────────────────────────────────────────────────

export const JOB_COLUMNS: FactColumn[] = [
  { id: "number", header: "#", sortKey: "projectNumber" },
  { id: "status", header: "Status", sortKey: "status" },
  { id: "dates", header: "Dates", sortKey: "rentalStartDate" },
  { id: "type", header: "Type", sortKey: "type" },
  { id: "total", header: "Total", align: "end", sortKey: "total" },
  // Opt-in from the page ⋯ › Columns.
  { id: "pm", header: "PM", optional: true },
  { id: "tags", header: "Tags", optional: true },
];

/** The first column's header and the sort key behind it. */
export const JOB_ITEM_HEADER = "Job";
export const JOB_ITEM_SORT_KEY = "name";

// ─── Query ───────────────────────────────────────────────────────────────

/** The URL contract drops unknown values: keep only the ones in `allowed` (none left = no filter). */
function known(values: string[] | undefined, allowed: readonly string[]): string[] | undefined {
  const kept = values?.filter((v) => allowed.includes(v));
  return kept && kept.length > 0 ? kept : undefined;
}

/** What `projects.listPage` is called with for a URL state. `now` is a mount-time snapshot. */
export function jobsQueryArgs(state: ListUrlState, now: number) {
  const f = state.filters;
  const preset = DATE_PRESETS.find((p) => p.value === f.date?.[0])?.value;
  return {
    search: state.q.trim() || undefined,
    segment: state.seg,
    statusIn: known(f.status, JOB_STATUS_ORDER),
    typeIn: known(f.type, Object.keys(TYPE_LABELS)),
    clientIn: f.client,
    pmIn: f.pm,
    includeCancelled: f.show?.includes("cancelled") ? true : undefined,
    ...resolveDatePreset(preset, now),
    page: state.page,
    pageSize: LIST_PAGE_SIZE,
    sortBy: state.sortBy,
    sortOrder: state.sortOrder,
    now,
  };
}

// ─── Rows ────────────────────────────────────────────────────────────────

/** The fields of a `projects.listPage` item the list reads. */
export interface JobSource {
  id: string;
  projectNumber: string;
  name: string;
  status?: string | null;
  type?: string | null;
  rentalStartDate?: number | null;
  rentalEndDate?: number | null;
  total?: number | null;
  tags?: string[] | null;
  projectManagerId?: string | null;
  client?: { name: string | null } | null;
}

/** Page-scoped derived flags: the same two queries the old table used. */
export interface JobExtras {
  issues?: { hasOverbooked: boolean; hasReducedStock: boolean } | null;
  blocking?: number;
  /** The project manager's name, resolved from `projectManagerId` through the org roster. */
  pmName?: string;
}

const dayMonth = (ms: number) => new Date(ms).toLocaleDateString("en-AU", { day: "numeric", month: "short" });

function dateFact(p: JobSource): Fact | undefined {
  const { rentalStartDate: s, rentalEndDate: e } = p;
  if (s && e) return { kind: "dateRange", start: dayMonth(s), end: dayMonth(e) };
  if (s) return { kind: "text", label: `From ${dayMonth(s)}` };
  if (e) return { kind: "text", label: `Until ${dayMonth(e)}` };
  return undefined;
}

/** Issue and blocking badges become red dot-word flags (no filled chips). */
export function jobFlags(extras: JobExtras): RowFlag[] {
  const flags: RowFlag[] = [];
  if (extras.issues?.hasOverbooked) flags.push({ label: "Overbooked", tone: "error" });
  else if (extras.issues?.hasReducedStock) flags.push({ label: "Reduced stock", tone: "warning" });
  if (extras.blocking && extras.blocking > 0) flags.push({ label: `Blocked ${extras.blocking}`, tone: "error" });
  return flags;
}

export function jobRowOf(p: JobSource, extras: JobExtras, menu?: ActionMenuSpec): LineRowData {
  const status = p.status ?? "ENQUIRY";
  const facts: Record<string, Fact> = { number: { kind: "text", label: p.projectNumber }, total: { kind: "money", amount: p.total ?? null } };
  const dates = dateFact(p);
  if (dates) facts.dates = dates;
  if (p.type) facts.type = { kind: "text", label: TYPE_LABELS[p.type] ?? p.type };
  if (extras.pmName) facts.pm = { kind: "text", label: extras.pmName };
  if (p.tags?.length) facts.tags = { kind: "text", label: p.tags.join(", ") };
  return {
    id: p.id,
    kind: "job",
    title: p.name,
    subtitle: p.client?.name ?? undefined,
    tags: p.tags?.length ? p.tags : undefined,
    flags: jobFlags(extras),
    facts,
    status: { label: jobStatusLabel(status), intent: getStatusIntent("project", status) },
    menu,
    href: `/projects/${p.id}`,
  };
}

// ─── Saved views (legacy shape, until the URL-mode menu lands) ───────────

/** The old `{filters, sortBy, sortOrder}` config for the current URL state. */
export function jobsViewConfig(state: ListUrlState): SavedViewConfig {
  const filters: Record<string, string[]> = {};
  if (state.filters.status) filters.status = state.filters.status;
  if (state.filters.type) filters.type = state.filters.type;
  return { filters, sortBy: state.sortBy, sortOrder: state.sortOrder };
}

/** A saved (or default) view applied to the URL state; unknown sort keys fall back to the default. */
export function jobsStateFromView(config: SavedViewConfig): ListUrlState {
  const base = defaultListState(JOBS_SPEC);
  const list = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
  const filters: Record<string, string[]> = {};
  const allowed: Record<string, readonly string[]> = { status: JOB_STATUS_ORDER, type: Object.keys(TYPE_LABELS) };
  for (const key of ["status", "type"]) {
    const values = known(list(config.filters?.[key]), allowed[key]);
    if (values) filters[key] = values;
  }
  const sortOk = !!config.sortBy && JOBS_SPEC.sorts.includes(config.sortBy);
  return {
    ...base,
    filters,
    sortBy: sortOk ? config.sortBy! : base.sortBy,
    sortOrder: sortOk && config.sortOrder ? config.sortOrder : base.sortOrder,
  };
}

// ─── Export ──────────────────────────────────────────────────────────────

/** CSV of the selected jobs (read-only download; money is whole dollars as stored, blank stays blank). */
export function jobsCsv(rows: JobSource[]): string {
  const head = ["Job #", "Name", "Client", "Status", "Type", "Start", "End", "Total", "Tags"];
  const iso = (ms?: number | null) => (ms ? new Date(ms).toISOString().slice(0, 10) : "");
  return toCsv(
    head,
    rows.map((p) => [
      p.projectNumber,
      p.name,
      p.client?.name ?? "",
      jobStatusLabel(p.status ?? "ENQUIRY"),
      p.type ? (TYPE_LABELS[p.type] ?? p.type) : "",
      iso(p.rentalStartDate),
      iso(p.rentalEndDate),
      p.total == null ? "" : String(p.total),
      (p.tags ?? []).join("; "),
    ]),
  );
}
