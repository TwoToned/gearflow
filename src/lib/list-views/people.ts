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

const CREW_SEGMENTS = [
  { key: "all", label: "All" },
  { key: "available", label: "Available this week" },
  { key: "onjob", label: "On a job" },
  { key: "unconfirmed", label: "Unconfirmed" },
  { key: "inactive", label: "Inactive" },
] as const;

export const CREW_SPEC: ListUrlSpec = {
  segments: CREW_SEGMENTS.map((s) => s.key),
  filters: ["type", "dept", "role"],
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
  next: { startDay: number; status: string; callId: string; project: { id: string; projectNumber: string; name: string } | null } | null;
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

export function crewRowOf(m: CrewSource, menu?: ActionMenuSpec): LineRowData {
  const facts: Record<string, Fact> = { status: { kind: "text", label: CREW_STATUS[m.listStatus].label } };
  if (m.next) facts.next = { kind: "text", label: `${m.next.project?.projectNumber ? `${m.next.project.projectNumber} · ` : ""}${dayLabel(m.next.startDay)}` };
  if (m.daysThisWeek > 0) facts.week = { kind: "text", label: `${m.daysThisWeek} d` };
  if (m.defaultDayRate != null) facts.rate = { kind: "money", amount: m.defaultDayRate };
  if (m.phone) facts.phone = { kind: "text", label: m.phone };
  if (m.email) facts.email = { kind: "text", label: m.email };
  if (m.type) facts.type = { kind: "text", label: crewMemberTypeLabels[m.type] ?? m.type };
  if (m.department) facts.department = { kind: "text", label: m.department };
  if (m.tags?.length) facts.tags = { kind: "text", label: m.tags.join(", ") };
  const flags: RowFlag[] = m.clashDay != null ? [{ label: `clash ${dayLabel(m.clashDay)}`, tone: "error" }] : [];
  return {
    id: m.id,
    kind: "crew",
    title: crewName(m),
    subtitle: [m.crewRole?.name, m.department].filter(Boolean).join(" · ") || undefined,
    tags: m.tags?.length ? m.tags : undefined,
    flags,
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

export function clientRowOf(c: ClientSource, menu?: ActionMenuSpec): LineRowData {
  const facts: Record<string, Fact> = { xero: { kind: "text", label: c.xeroLinked ? "Linked" : "" } };
  if (c.openJobCount > 0) {
    const first = c.openJobs.slice(0, 2).map((j) => j.projectNumber).join(", ");
    facts.openJobs = { kind: "text", label: c.openJobCount > 2 ? `${first} +${c.openJobCount - 2}` : first };
  }
  if (c.lastJobAt != null) facts.lastJob = { kind: "text", label: msLabel(c.lastJobAt) };
  if (c.quoted != null) facts.quoted = { kind: "money", amount: c.quoted > 0 ? c.quoted : null };
  if (c.outstanding != null) facts.outstanding = { kind: "money", amount: c.outstanding > 0 ? c.outstanding : null };
  if (c.lifetime != null) facts.lifetime = { kind: "money", amount: c.lifetime > 0 ? c.lifetime : null };
  if (c.type) facts.type = { kind: "text", label: CLIENT_TYPE_LABELS[c.type] ?? c.type };
  if (c.contactEmail) facts.email = { kind: "text", label: c.contactEmail };
  if (c.tags.length) facts.tags = { kind: "text", label: c.tags.join(", ") };
  const flags: RowFlag[] = c.overdueDays ? [{ label: `${c.overdueDays}d overdue`, tone: "error" }] : [];
  return {
    id: c.id,
    kind: "client",
    title: c.name,
    subtitle: [c.contactName, c.type ? CLIENT_TYPE_LABELS[c.type] : null].filter(Boolean).join(" · ") || undefined,
    tags: c.tags.length ? c.tags : undefined,
    flags,
    facts,
    status: c.isActive ? undefined : { label: "Archived", intent: "neutral", outline: true },
    menu,
    href: `/clients/${c.id}`,
  };
}

/** The head sub line: `10 with open jobs · $234,400 quoted · $76,170 outstanding` (money only when sent). */
export function clientSubline(c: { withOpenJobs?: number; quoted?: number; outstanding?: number; truncated?: number } | undefined): string | undefined {
  if (!c) return undefined;
  const money = (n: number) => `$${Math.round(n).toLocaleString("en-AU")}`;
  const parts = [
    c.withOpenJobs != null ? `${c.withOpenJobs} with open jobs` : null,
    c.quoted != null ? `${money(c.quoted)} quoted` : null,
    c.outstanding != null ? `${money(c.outstanding)} outstanding` : null,
    c.truncated ? "counts may be incomplete" : null,
  ].filter(Boolean);
  return parts.length ? parts.join(" · ") : undefined;
}

export function clientsBuiltInViews(moneyVisible: boolean): UrlBuiltInView[] {
  const views = moneyVisible ? [{ id: "builtin:overdue", name: "Overdue invoices", query: "seg=overdue" }] : [];
  return views.map((b) => ({ ...b, query: viewQuery({ query: b.query }, CLIENTS_SPEC) }));
}

export function clientsCsv(rows: ClientSource[]): string {
  const money = rows.some((r) => r.outstanding != null);
  const head = ["Client", "Type", "Contact", "Email", "Open jobs", "Last job", "Status", ...(money ? ["Quoted", "Outstanding", "Lifetime"] : []), "Tags"];
  return toCsv(
    head,
    rows.map((c) => [
      c.name, c.type ? (CLIENT_TYPE_LABELS[c.type] ?? c.type) : "", c.contactName ?? "", c.contactEmail ?? "", String(c.openJobCount),
      c.lastJobAt != null ? new Date(c.lastJobAt).toISOString().slice(0, 10) : "", c.isActive ? "Active" : "Archived",
      ...(money ? [c.quoted == null ? "" : String(c.quoted), c.outstanding == null ? "" : String(c.outstanding), c.lifetime == null ? "" : String(c.lifetime)] : []),
      c.tags.join("; "),
    ]),
  );
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

export function supplierRowOf(s: SupplierSource, menu?: ActionMenuSpec): LineRowData {
  const facts: Record<string, Fact> = { openOrders: { kind: "text", label: s.openOrders > 0 ? String(s.openOrders) : "" } };
  if (s.spendYtd != null) facts.spend = { kind: "money", amount: s.spendYtd > 0 ? s.spendYtd : null };
  if (s.phone) facts.phone = { kind: "text", label: s.phone };
  if (s.accountNumber) facts.accountNumber = { kind: "text", label: s.accountNumber };
  if (s.email) facts.email = { kind: "text", label: s.email };
  if (s.tags.length) facts.tags = { kind: "text", label: s.tags.join(", ") };
  return {
    id: s.id,
    kind: "supplier",
    title: s.name,
    subtitle: s.contactName ?? undefined,
    tags: s.tags.length ? s.tags : undefined,
    facts,
    status: s.isActive ? undefined : { label: "Archived", intent: "neutral", outline: true },
    menu,
    href: `/suppliers/${s.id}`,
  };
}

export function suppliersCsv(rows: SupplierSource[]): string {
  const money = rows.some((r) => r.spendYtd != null);
  return toCsv(
    ["Supplier", "Contact", "Email", "Phone", "Account #", "Open orders", "Status", ...(money ? ["Spend YTD"] : []), "Tags"],
    rows.map((s) => [
      s.name, s.contactName ?? "", s.email ?? "", s.phone ?? "", s.accountNumber ?? "", String(s.openOrders), s.isActive ? "Active" : "Archived",
      ...(money ? [s.spendYtd == null ? "" : String(s.spendYtd)] : []), s.tags.join("; "),
    ]),
  );
}

/** Mapping from list key to what the page shell needs (one renderer, three configs). */
export const PEOPLE_LISTS = [
  { key: "crew", label: "Crew", href: "/crew" },
  { key: "clients", label: "Clients", href: "/clients" },
  { key: "suppliers", label: "Suppliers", href: "/suppliers" },
] as const;
export type PeopleListKey = (typeof PEOPLE_LISTS)[number]["key"];
