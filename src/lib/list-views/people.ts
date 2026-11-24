/**
 * The People lists as data (UX Phase 13, spec §9f): Crew, Clients, Suppliers. Pure:
 * no React, no router, no Convex. `PeopleList` supplies the queries and handlers;
 * this module says what each list IS (segments, filter words, columns, URL spec, the
 * row mapping, CSV), so a test can pin it without rendering anything.
 *
 * Money and pay columns exist only when the server sent them (`payVisible` /
 * `moneyVisible`): an ABSENT column, never a column of dashes or zeros.
 */
import type { ListFilterDef, ListSegment } from "@/components/ui/list-page-parts";
import { toCsv } from "@/lib/csv";
import { LIST_PAGE_SIZE, type ListUrlSpec, type ListUrlState } from "@/lib/list-url-state";
import { viewQuery, type UrlBuiltInView } from "@/lib/list-views/saved-view-url";
import type { ActionMenuSpec, Fact, FactColumn, LineRowData, RowFlag, StatusValue } from "@/lib/primitives/types";
import { clientTypeLabels, crewMemberTypeLabels } from "@/lib/status-labels";

const DAY_MS = 24 * 60 * 60 * 1000;

/** `26 Nov` from a day number (`floor(ms / DAY_MS)`), in UTC so server and page agree. */
export function dayLabel(day: number): string {
  return new Date(day * DAY_MS).toLocaleDateString("en-AU", { day: "numeric", month: "short", timeZone: "UTC" });
}
function msLabel(ms: number): string {
  return dayLabel(Math.floor(ms / DAY_MS));
}

const known = (values: string[] | undefined, allowed: readonly string[]) => {
  const kept = values?.filter((v) => allowed.includes(v));
  return kept && kept.length > 0 ? kept : undefined;
};

/** The shared query contract: every list sends the same page / sort / search shape. */
function baseArgs(state: ListUrlState, now: number) {
  return {
    segment: state.seg,
    search: state.q.trim() || undefined,
    page: state.page,
    pageSize: LIST_PAGE_SIZE,
    sortBy: state.sortBy,
    sortOrder: state.sortOrder,
    now,
  };
}

// ─── Crew ────────────────────────────────────────────────────────────────

const CREW_STATUS_OPTIONS = [
  { value: "UNCONFIRMED", label: "Unconfirmed" },
  { value: "ON_JOB", label: "On a job" },
  { value: "AVAILABLE", label: "Available" },
  { value: "ON_LEAVE", label: "On leave" },
  { value: "INACTIVE", label: "Inactive" },
];

const CREW_SEGMENTS = [
  { key: "all", label: "All" },
  { key: "available", label: "Available this week" },
  { key: "onjob", label: "On a job" },
  { key: "unconfirmed", label: "Unconfirmed" },
  { key: "inactive", label: "Inactive" },
] as const;

export const CREW_SPEC: ListUrlSpec = {
  segments: CREW_SEGMENTS.map((s) => s.key),
  filters: ["type", "dept", "role", "status"],
  sorts: ["name", "status", "next", "week", "rate", "type", "phone", "email", "department"],
  defaultSort: "status:asc",
};

export const crewSegments = (counts: Record<string, number> | undefined): ListSegment[] =>
  CREW_SEGMENTS.map((s) => ({ key: s.key, label: s.label, count: counts?.[s.key] }));

export function crewFilters(roles: { id: string; name: string }[], departments: string[]): ListFilterDef[] {
  return [
    { key: "type", label: "Type", options: Object.entries(crewMemberTypeLabels).map(([value, label]) => ({ value, label })) },
    { key: "dept", label: "Department", options: departments.map((d) => ({ value: d, label: d })) },
    { key: "role", label: "Role", options: roles.map((r) => ({ value: r.id, label: r.name })) },
    // A status word is its own door: On leave and Inactive stay reachable beside the strip.
    { key: "status", label: "Status", options: CREW_STATUS_OPTIONS },
  ];
}

export function crewColumns(payVisible: boolean): FactColumn[] {
  return [
    { id: "status", header: "Status", sortKey: "status" },
    { id: "next", header: "Next call", sortKey: "next" },
    { id: "week", header: "This week", sortKey: "week", align: "end" },
    ...(payVisible ? [{ id: "rate", header: "Rate /day", sortKey: "rate", align: "end" as const }] : []),
    { id: "phone", header: "Phone", sortKey: "phone" },
    { id: "email", header: "Email", sortKey: "email", optional: true },
    { id: "type", header: "Type", sortKey: "type", optional: true },
    { id: "department", header: "Department", sortKey: "department", optional: true },
    { id: "tags", header: "Tags", optional: true },
  ];
}
export const CREW_ITEM_HEADER = "Name";
export const CREW_ITEM_SORT_KEY = "name";

export function crewQueryArgs(state: ListUrlState, now: number) {
  const f = state.filters;
  return {
    ...baseArgs(state, now),
    typeIn: known(f.type, Object.keys(crewMemberTypeLabels)),
    departmentIn: f.dept,
    roleIn: f.role,
    statusIn: known(f.status, CREW_STATUS_OPTIONS.map((o) => o.value)),
  };
}

/** The fields of a `peopleLists.crewPage` item the list reads. */
export interface CrewSource {
  id: string;
  firstName: string;
  lastName: string;
  email?: string | null;
  phone?: string | null;
  type?: string | null;
  department?: string | null;
  /** The STORED member status (ACTIVE / INACTIVE / ON_LEAVE / ARCHIVED); `listStatus` is the derived word. */
  status?: string | null;
  tags?: string[] | null;
  defaultDayRate?: number | null;
  crewRole?: { id: string; name: string } | null;
  listStatus: "UNCONFIRMED" | "ON_JOB" | "AVAILABLE" | "ON_LEAVE" | "INACTIVE";
  next: { startDay: number | null; status: string; callId: string; project: { id: string; projectNumber: string; name: string } | null } | null;
  daysThisWeek: number;
  clashDay: number | null;
  user?: { name?: string | null; image?: string | null } | null;
}

export const crewName = (m: Pick<CrewSource, "firstName" | "lastName" | "user">): string => m.user?.name || `${m.firstName} ${m.lastName}`.trim();

const CREW_STATUS: Record<CrewSource["listStatus"], StatusValue> = {
  UNCONFIRMED: { label: "Unconfirmed", intent: "warning" },
  ON_JOB: { label: "On a job", intent: "info" },
  AVAILABLE: { label: "Available", intent: "success" },
  ON_LEAVE: { label: "On leave", intent: "neutral" },
  INACTIVE: { label: "Inactive", intent: "neutral", outline: true },
};

// ─── Fact helpers: a blank fact is ABSENT (never "" or $0); each is one small branch ─

const textFact = (label: string | null | undefined): Fact | undefined => (label ? { kind: "text", label } : undefined);
const moneyFact = (amount: number | null | undefined): Fact | undefined => (amount == null ? undefined : { kind: "money", amount: amount > 0 ? amount : null });
const tagsLabel = (tags: string[] | null | undefined): string | undefined => (tags?.length ? tags.join(", ") : undefined);
const tagsOrUndefined = (tags: string[] | null | undefined): string[] | undefined => (tags?.length ? tags : undefined);
const joinDot = (parts: (string | null | undefined)[]): string | undefined => parts.filter(Boolean).join(" · ") || undefined;

function defined(facts: Record<string, Fact | undefined>): Record<string, Fact> {
  return Object.fromEntries(Object.entries(facts).filter((e): e is [string, Fact] => e[1] != null));
}

const crewNextLabel = (m: CrewSource): string | undefined => (m.next ? joinDot([m.next.project?.projectNumber, m.next.startDay == null ? "no dates" : dayLabel(m.next.startDay)]) : undefined);
const crewWeekLabel = (days: number): string | undefined => (days > 0 ? `${days} d` : undefined);
const crewTypeLabel = (t: string | null | undefined): string | undefined => (t ? (crewMemberTypeLabels[t] ?? t) : undefined);
const crewFlags = (m: CrewSource): RowFlag[] => (m.clashDay != null ? [{ label: `clash ${dayLabel(m.clashDay)}`, tone: "error" }] : []);

export function crewRowOf(m: CrewSource, menu?: ActionMenuSpec): LineRowData {
  const facts = defined({
    status: textFact(CREW_STATUS[m.listStatus].label),
    next: textFact(crewNextLabel(m)),
    week: textFact(crewWeekLabel(m.daysThisWeek)),
    // A rate the server did not send stays absent: never a zero, never a dash.
    rate: m.defaultDayRate == null ? undefined : { kind: "money", amount: m.defaultDayRate },
    phone: textFact(m.phone),
    email: textFact(m.email),
    type: textFact(crewTypeLabel(m.type)),
    department: textFact(m.department),
    tags: textFact(tagsLabel(m.tags)),
  });
  return {
    id: m.id,
    kind: "crew",
    title: crewName(m),
    subtitle: joinDot([m.crewRole?.name, m.department]),
    tags: tagsOrUndefined(m.tags),
    flags: crewFlags(m),
    facts,
    status: CREW_STATUS[m.listStatus],
    menu,
    href: `/crew/${m.id}`,
  };
}

export function crewBuiltInViews(): UrlBuiltInView[] {
  return [{ id: "builtin:unconfirmed", name: "Unconfirmed", query: "seg=unconfirmed" }].map((b) => ({ ...b, query: viewQuery({ query: b.query }, CREW_SPEC) }));
}

// ─── Clients ─────────────────────────────────────────────────────────────

const CLIENT_TYPE_LABELS = clientTypeLabels;

const CLIENT_SEGMENTS = [
  { key: "all", label: "All" },
  { key: "active", label: "Active jobs" },
  { key: "quoting", label: "Quoting" },
  { key: "overdue", label: "Overdue invoices" },
  { key: "archived", label: "Archived" },
] as const;

export const CLIENTS_SPEC: ListUrlSpec = {
  segments: CLIENT_SEGMENTS.map((s) => s.key),
  filters: ["type"],
  sorts: ["name", "openJobs", "outstanding", "lastJob", "type", "lifetime", "quoted"],
  defaultSort: "openJobs:desc",
};

/** `Overdue invoices` is dropped without the invoice line (the server reads it as `all`). */
export function clientSegments(counts: Record<string, number | null> | undefined, moneyVisible: boolean): ListSegment[] {
  return CLIENT_SEGMENTS.filter((s) => s.key !== "overdue" || moneyVisible).map((s) => ({ key: s.key, label: s.label, count: counts?.[s.key] ?? undefined }));
}

export const clientFilters = (): ListFilterDef[] => [{ key: "type", label: "Type", options: Object.entries(CLIENT_TYPE_LABELS).map(([value, label]) => ({ value, label })) }];

export function clientColumns(moneyVisible: boolean): FactColumn[] {
  return [
    { id: "openJobs", header: "Open jobs", sortKey: "openJobs" },
    ...(moneyVisible ? [{ id: "quoted", header: "Quoted", sortKey: "quoted", align: "end" as const }, { id: "outstanding", header: "Outstanding", sortKey: "outstanding", align: "end" as const }] : []),
    { id: "lastJob", header: "Last job", sortKey: "lastJob" },
    { id: "xero", header: "Xero" },
    { id: "type", header: "Type", sortKey: "type", optional: true },
    { id: "email", header: "Email", optional: true },
    ...(moneyVisible ? [{ id: "lifetime", header: "Lifetime", sortKey: "lifetime", align: "end" as const, optional: true }] : []),
    { id: "tags", header: "Tags", optional: true },
  ];
}
export const CLIENT_ITEM_HEADER = "Client";
export const CLIENT_ITEM_SORT_KEY = "name";

export function clientQueryArgs(state: ListUrlState, now: number) {
  return { ...baseArgs(state, now), typeIn: known(state.filters.type, Object.keys(CLIENT_TYPE_LABELS)) };
}

export interface ClientSource {
  id: string;
  name: string;
  type: string | null;
  contactName: string | null;
  contactEmail: string | null;
  tags: string[];
  isActive: boolean;
  xeroLinked: boolean;
  xeroContactId?: string | null;
  openJobs: { id: string; projectNumber: string }[];
  openJobCount: number;
  lastJobAt: number | null;
  quoted?: number;
  outstanding?: number;
  overdueDays?: number;
  lifetime?: number;
}

const clientTypeName = (t: string | null | undefined): string | undefined => (t ? (CLIENT_TYPE_LABELS[t] ?? t) : undefined);
const clientOpenJobsLabel = (c: ClientSource): string | undefined => {
  if (c.openJobCount === 0) return undefined;
  const first = c.openJobs.slice(0, 2).map((j) => j.projectNumber).join(", ");
  return c.openJobCount > 2 ? `${first} +${c.openJobCount - 2}` : first;
};
const clientFlags = (c: ClientSource): RowFlag[] => (c.overdueDays ? [{ label: `${c.overdueDays}d overdue`, tone: "error" }] : []);
const ARCHIVED: StatusValue = { label: "Archived", intent: "neutral", outline: true };

export function clientRowOf(c: ClientSource, menu?: ActionMenuSpec): LineRowData {
  const facts = defined({
    xero: textFact(c.xeroLinked ? "Linked" : undefined),
    openJobs: textFact(clientOpenJobsLabel(c)),
    lastJob: textFact(c.lastJobAt == null ? undefined : msLabel(c.lastJobAt)),
    // Money the server did not send stays absent: no column, no zero.
    quoted: moneyFact(c.quoted),
    outstanding: moneyFact(c.outstanding),
    lifetime: moneyFact(c.lifetime),
    type: textFact(clientTypeName(c.type)),
    email: textFact(c.contactEmail),
    tags: textFact(tagsLabel(c.tags)),
  });
  return {
    id: c.id,
    kind: "client",
    title: c.name,
    subtitle: joinDot([c.contactName, clientTypeName(c.type)]),
    tags: tagsOrUndefined(c.tags),
    flags: clientFlags(c),
    facts,
    status: c.isActive ? undefined : ARCHIVED,
    menu,
    href: `/clients/${c.id}`,
  };
}

const wholeDollars = (n: number) => `$${Math.round(n).toLocaleString("en-AU")}`;

/** The head sub line: `10 with open jobs · $234,400 quoted · $76,170 outstanding` (money only when sent). */
export function clientSubline(c: { withOpenJobs?: number; quoted?: number; outstanding?: number; truncated?: number } | undefined): string | undefined {
  if (!c) return undefined;
  return joinDot([
    c.withOpenJobs == null ? undefined : `${c.withOpenJobs} with open jobs`,
    c.quoted == null ? undefined : `${wholeDollars(c.quoted)} quoted`,
    c.outstanding == null ? undefined : `${wholeDollars(c.outstanding)} outstanding`,
    c.truncated ? "counts may be incomplete" : undefined,
  ]);
}

export function clientsBuiltInViews(moneyVisible: boolean): UrlBuiltInView[] {
  const views = moneyVisible ? [{ id: "builtin:overdue", name: "Overdue invoices", query: "seg=overdue" }] : [];
  return views.map((b) => ({ ...b, query: viewQuery({ query: b.query }, CLIENTS_SPEC) }));
}

const csvNum = (n: number | null | undefined): string => (n == null ? "" : String(n));
const csvDay = (ms: number | null | undefined): string => (ms == null ? "" : new Date(ms).toISOString().slice(0, 10));

function clientCsvRow(c: ClientSource, money: boolean): string[] {
  return [
    c.name, clientTypeName(c.type) ?? "", c.contactName ?? "", c.contactEmail ?? "", String(c.openJobCount), csvDay(c.lastJobAt),
    c.isActive ? "Active" : "Archived", ...(money ? [csvNum(c.quoted), csvNum(c.outstanding), csvNum(c.lifetime)] : []), c.tags.join("; "),
  ];
}

export function clientsCsv(rows: ClientSource[]): string {
  const money = rows.some((r) => r.outstanding != null);
  const head = ["Client", "Type", "Contact", "Email", "Open jobs", "Last job", "Status", ...(money ? ["Quoted", "Outstanding", "Lifetime"] : []), "Tags"];
  return toCsv(head, rows.map((c) => clientCsvRow(c, money)));
}

// ─── Suppliers ───────────────────────────────────────────────────────────

const SUPPLIER_SEGMENTS = [
  { key: "all", label: "All" },
  { key: "open", label: "Open orders" },
  { key: "archived", label: "Archived" },
] as const;

export const SUPPLIERS_SPEC: ListUrlSpec = {
  segments: SUPPLIER_SEGMENTS.map((s) => s.key),
  filters: [],
  sorts: ["name", "openOrders", "spend", "phone", "accountNumber", "email"],
  defaultSort: "name:asc",
};

export const supplierSegments = (counts: Record<string, number> | undefined): ListSegment[] =>
  SUPPLIER_SEGMENTS.map((s) => ({ key: s.key, label: s.label, count: counts?.[s.key] }));

export function supplierColumns(moneyVisible: boolean): FactColumn[] {
  return [
    { id: "openOrders", header: "Open orders", sortKey: "openOrders", align: "end" },
    ...(moneyVisible ? [{ id: "spend", header: "Spend YTD", sortKey: "spend", align: "end" as const }] : []),
    { id: "phone", header: "Phone", sortKey: "phone", optional: true },
    { id: "accountNumber", header: "Account #", sortKey: "accountNumber", optional: true },
    { id: "email", header: "Email", sortKey: "email", optional: true },
    { id: "tags", header: "Tags", optional: true },
  ];
}
export const SUPPLIER_ITEM_HEADER = "Supplier";
export const SUPPLIER_ITEM_SORT_KEY = "name";

export const supplierQueryArgs = (state: ListUrlState, now: number) => baseArgs(state, now);

export interface SupplierSource {
  id: string;
  name: string;
  contactName: string | null;
  email: string | null;
  phone: string | null;
  accountNumber: string | null;
  tags: string[];
  isActive: boolean;
  openOrders: number;
  spendYtd?: number;
}

/** The head sub line: `3 with open orders · 5 open orders · $12,000 this year` (spend only when sent). */
export function supplierSubline(c: { open?: number; openOrders?: number; spendYtd?: number; truncated?: number } | undefined): string | undefined {
  if (!c) return undefined;
  return joinDot([
    `${c.open ?? 0} with open orders`,
    c.openOrders == null ? undefined : `${c.openOrders} open orders`,
    c.spendYtd == null ? undefined : `${wholeDollars(c.spendYtd)} this year`,
    c.truncated ? "counts may be incomplete" : undefined,
  ]);
}

export function supplierRowOf(s: SupplierSource, menu?: ActionMenuSpec): LineRowData {
  const facts = defined({
    openOrders: textFact(s.openOrders > 0 ? String(s.openOrders) : undefined),
    spend: moneyFact(s.spendYtd), // absent without the job-cost line
    phone: textFact(s.phone),
    accountNumber: textFact(s.accountNumber),
    email: textFact(s.email),
    tags: textFact(tagsLabel(s.tags)),
  });
  return {
    id: s.id,
    kind: "supplier",
    title: s.name,
    subtitle: s.contactName ?? undefined,
    tags: tagsOrUndefined(s.tags),
    facts,
    status: s.isActive ? undefined : ARCHIVED,
    menu,
    href: `/suppliers/${s.id}`,
  };
}

function supplierCsvRow(s: SupplierSource, money: boolean): string[] {
  return [
    s.name, s.contactName ?? "", s.email ?? "", s.phone ?? "", s.accountNumber ?? "", String(s.openOrders), s.isActive ? "Active" : "Archived",
    ...(money ? [csvNum(s.spendYtd)] : []), s.tags.join("; "),
  ];
}

export function suppliersCsv(rows: SupplierSource[]): string {
  const money = rows.some((r) => r.spendYtd != null);
  const head = ["Supplier", "Contact", "Email", "Phone", "Account #", "Open orders", "Status", ...(money ? ["Spend YTD"] : []), "Tags"];
  return toCsv(head, rows.map((s) => supplierCsvRow(s, money)));
}

/** Mapping from list key to what the page shell needs (one renderer, three configs). */
export const PEOPLE_LISTS = [
  { key: "crew", label: "Crew", href: "/crew" },
  { key: "clients", label: "Clients", href: "/clients" },
  { key: "suppliers", label: "Suppliers", href: "/suppliers" },
] as const;
export type PeopleListKey = (typeof PEOPLE_LISTS)[number]["key"];
