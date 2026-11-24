import { v } from "convex/values";
import { query, type QueryCtx } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
import { requireOrgReadFor } from "./lib/auth";
import type { AgentOpsAnnotations } from "./lib/agentOps";
import { canSeeCrewPay, canSeeJobCost } from "./lib/crewPayVisibility";
import { memberRowRedactor } from "./lib/crewMemberRedaction";
import { clientFacts, inClientSegment, CLIENT_SEGMENT_KEYS, type ClientFacts, type ClientSegmentKey } from "./lib/clientListFacts";
import {
  CREW_SEGMENT_KEYS,
  CREW_STATUS_RANK,
  DAY_MS,
  crewMemberFacts,
  dayNumber,
  groupCallsByMember,
  inCrewSegment,
  type CrewMemberFacts,
  type CrewSegmentKey,
} from "./lib/crewListFacts";
import { compareValues, matchesSearch, paginateItems } from "./lib/listQuery";
import { loadOrgProjects } from "./lib/orgProjects";
import { collectCapped } from "./lib/pagination";
import { resolveNow } from "./lib/projectSegments";

/**
 * The People lists (UX Phase 13, spec §9f): Crew, Clients, Suppliers, each as ONE
 * `*Page` read (rows + their derived facts) and ONE `*SegmentCounts` read, so the
 * strip and the table cannot disagree. Everything derived is a pure function in
 * `convex/lib/{crewListFacts,clientListFacts}.ts`; nothing here is stored.
 *
 * Bounds: rosters (crew, clients, suppliers) and calls/orders/invoices are read with
 * `collectCapped` and surface `truncated`; calls are read over a window
 * (`CALL_LOOKBACK_DAYS` back, `CALL_HORIZON_DAYS` ahead) by `by_organizationId_startDate`,
 * so a call that began earlier than the lookback and runs on is out of scope.
 * Money follows ONE rule (`canSeeJobCost`): absent, never zero, and never a sort key.
 */

export const agentOps: AgentOpsAnnotations = {
  crewPage: { summary: "The Crew list: a page of members with derived status, next call and days this week (rates only for callers who see crew pay).", danger: "low", mcpTier: 3 },
  crewSegmentCounts: { summary: "Counts for the Crew list's strip (all, available this week, on a job, unconfirmed, inactive).", danger: "low", mcpTier: 3 },
  clientPage: { summary: "The Clients list: a page of clients with open jobs and (with invoice access) quoted / outstanding / overdue.", danger: "low", mcpTier: 3 },
  clientSegmentCounts: { summary: "Counts for the Clients list's strip.", danger: "low", mcpTier: 3 },
  supplierPage: { summary: "The Suppliers list: a page of suppliers with open orders and (with invoice access) spend this year.", danger: "low", mcpTier: 3 },
  supplierSegmentCounts: { summary: "Counts for the Suppliers list's strip.", danger: "low", mcpTier: 3 },
};

const ROSTER_CAP = 5000;
const CALL_LOOKBACK_DAYS = 60;
const CALL_HORIZON_DAYS = 90;
const MAX_PAGE = 100;

const sortOrder = v.optional(v.union(v.literal("asc"), v.literal("desc")));
const strs = v.optional(v.array(v.string()));

function pageArgs(a: { page?: number; pageSize?: number }) {
  const page = Math.max(1, Math.floor(a.page ?? 1));
  const pageSize = Math.min(MAX_PAGE, Math.max(1, Math.floor(a.pageSize ?? 25)));
  return { page, pageSize };
}

const dir = (o: "asc" | "desc" | undefined): 1 | -1 => (o === "desc" ? -1 : 1);
const pickIn = (values: string[] | undefined, v: string | null | undefined) => !values?.length || (v != null && values.includes(v));

// ─── Crew ────────────────────────────────────────────────────────────────

async function loadCrew(ctx: QueryCtx, orgId: string, nowArg: number | undefined) {
  const now = resolveNow(nowArg);
  const today = dayNumber(now);
  const from = (today - CALL_LOOKBACK_DAYS) * DAY_MS;
  const to = (today + CALL_HORIZON_DAYS) * DAY_MS;
  const [members, calls] = await Promise.all([
    collectCapped(ctx.db.query("crewMembers").withIndex("by_organizationId", (q) => q.eq("organizationId", orgId)), ROSTER_CAP),
    collectCapped(
      ctx.db.query("crewAssignments").withIndex("by_organizationId_startDate", (q) => q.eq("organizationId", orgId).gte("startDate", from).lte("startDate", to)),
      ROSTER_CAP,
    ),
  ]);
  const byMember = groupCallsByMember(calls.rows.map((c) => ({ id: c.id, crewMemberId: c.crewMemberId, projectId: c.projectId, status: c.status, startDate: c.startDate, endDate: c.endDate })));
  const facts = new Map<string, CrewMemberFacts>();
  for (const m of members.rows) facts.set(m.id, crewMemberFacts(m, byMember.get(m.id) ?? [], today));
  return { members: members.rows, facts, today, truncated: members.truncated || calls.truncated };
}

const CREW_SORTS = new Set(["name", "status", "next", "week", "rate", "type", "phone", "email", "department"]);

function crewSortValue(m: Doc<"crewMembers">, f: CrewMemberFacts, key: string, pay: boolean): unknown {
  switch (key) {
    case "status":
      return CREW_STATUS_RANK[f.status];
    case "next":
      return f.next?.startDay ?? Number.POSITIVE_INFINITY;
    case "week":
      return f.daysThisWeek;
    case "rate":
      return pay ? m.defaultDayRate ?? null : null; // a hidden field is not a sort key
    case "type":
      return m.type ?? "";
    case "phone":
      return m.phone ?? "";
    case "email":
      return m.email ?? "";
    case "department":
      return m.department ?? "";
    default:
      return `${m.lastName} ${m.firstName}`.toLowerCase();
  }
}

export const crewPage = query({
  args: {
    orgId: v.string(),
    now: v.optional(v.number()),
    segment: v.optional(v.string()),
    search: v.optional(v.string()),
    typeIn: strs,
    departmentIn: strs,
    roleIn: strs,
    page: v.optional(v.number()),
    pageSize: v.optional(v.number()),
    sortBy: v.optional(v.string()),
    sortOrder,
  },
  handler: async (ctx, a) => {
    await requireOrgReadFor(ctx, a.orgId, "crew");
    const { page, pageSize } = pageArgs(a);
    const seg = (CREW_SEGMENT_KEYS as readonly string[]).includes(a.segment ?? "") ? (a.segment as CrewSegmentKey) : "all";
    const [{ members, facts, today, truncated }, roles, redact, pay] = await Promise.all([
      loadCrew(ctx, a.orgId, a.now),
      collectCapped(ctx.db.query("crewRoles").withIndex("by_organizationId", (q) => q.eq("organizationId", a.orgId)), 500),
      memberRowRedactor(ctx, a.orgId),
      canSeeCrewPay(ctx, a.orgId),
    ]);
    const roleMap = new Map(roles.rows.map((r) => [r.id, r]));
    const sortBy = CREW_SORTS.has(a.sortBy ?? "") ? (a.sortBy as string) : "status";
    const filtered = members.filter((m) => {
      const f = facts.get(m.id)!;
      if (!inCrewSegment(f, seg)) return false;
      if (!pickIn(a.typeIn, m.type) || !pickIn(a.departmentIn, m.department) || !pickIn(a.roleIn, m.crewRoleId)) return false;
      return !a.search || matchesSearch([m.firstName, m.lastName, m.email, m.phone, m.department, roleMap.get(m.crewRoleId ?? "")?.name, ...(m.tags ?? [])], a.search);
    });
    const sorted = [...filtered].sort(
      (x, y) =>
        compareValues(crewSortValue(x, facts.get(x.id)!, sortBy, pay), crewSortValue(y, facts.get(y.id)!, sortBy, pay), dir(a.sortOrder)) ||
        compareValues(crewSortValue(x, facts.get(x.id)!, "name", pay), crewSortValue(y, facts.get(y.id)!, "name", pay), 1),
    );
    const { items: pageRows, total, totalPages } = paginateItems(sorted, page, pageSize);
    const projectIds = [...new Set(pageRows.map((m) => facts.get(m.id)!.next?.projectId).filter((id): id is string => !!id))];
    const projects = new Map<string, { id: string; projectNumber: string; name: string }>();
    for (const id of projectIds) {
      const p = await ctx.db.query("projects").withIndex("by_cuid", (q) => q.eq("id", id)).first();
      if (p && p.organizationId === a.orgId) projects.set(p.id, { id: p.id, projectNumber: p.projectNumber, name: p.name });
    }
    const items = pageRows.map((m) => {
      const f = facts.get(m.id)!;
      const role = m.crewRoleId ? roleMap.get(m.crewRoleId) : undefined;
      return {
        ...redact(m),
        crewRole: role ? { id: role.id, name: role.name, color: role.color ?? null } : null,
        listStatus: f.status,
        next: f.next ? { startDay: f.next.startDay, status: f.next.status, callId: f.next.callId, project: projects.get(f.next.projectId) ?? null } : null,
        daysThisWeek: f.daysThisWeek,
        clashDay: f.clashDay,
      };
    });
    return { items, total, totalPages, page, pageSize, truncated, today, payVisible: pay };
  },
});

export const crewSegmentCounts = query({
  args: { orgId: v.string(), now: v.optional(v.number()) },
  handler: async (ctx, { orgId, now }) => {
    await requireOrgReadFor(ctx, orgId, "crew");
    const { members, facts, truncated } = await loadCrew(ctx, orgId, now);
    const counts: Record<CrewSegmentKey | "truncated", number> = { all: 0, available: 0, onjob: 0, unconfirmed: 0, inactive: 0, truncated: truncated ? 1 : 0 };
    for (const m of members) for (const k of CREW_SEGMENT_KEYS) if (inCrewSegment(facts.get(m.id)!, k)) counts[k]++;
    return counts;
  },
});

// ─── Clients ─────────────────────────────────────────────────────────────

async function loadClients(ctx: QueryCtx, orgId: string, nowArg: number | undefined) {
  const today = dayNumber(resolveNow(nowArg));
  const showMoney = await canSeeJobCost(ctx, orgId);
  const [clients, projects, invoices] = await Promise.all([
    collectCapped(ctx.db.query("clients").withIndex("by_organizationId", (q) => q.eq("organizationId", orgId)), ROSTER_CAP),
    loadOrgProjects(ctx, orgId),
    collectCapped(ctx.db.query("invoices").withIndex("by_organizationId_status", (q) => q.eq("organizationId", orgId).eq("status", "ISSUED")), ROSTER_CAP),
  ]);
  const projectsBy = new Map<string, typeof projects>();
  for (const p of projects) if (p.clientId) (projectsBy.get(p.clientId) ?? projectsBy.set(p.clientId, []).get(p.clientId)!).push(p);
  const invoicesBy = new Map<string, typeof invoices.rows>();
  for (const i of invoices.rows) (invoicesBy.get(i.clientId) ?? invoicesBy.set(i.clientId, []).get(i.clientId)!).push(i);
  const facts = new Map<string, ClientFacts>();
  for (const c of clients.rows) facts.set(c.id, clientFacts(projectsBy.get(c.id) ?? [], invoicesBy.get(c.id) ?? [], today, showMoney));
  return { clients: clients.rows, facts, today, showMoney, truncated: clients.truncated || invoices.truncated };
}

const CLIENT_SORTS = new Set(["name", "openJobs", "outstanding", "lastJob", "type", "lifetime", "quoted"]);

function clientSortValue(c: Doc<"clients">, f: ClientFacts, key: string, money: boolean): unknown {
  switch (key) {
    case "openJobs":
      return f.openJobCount;
    case "lastJob":
      return f.lastJobAt;
    case "type":
      return c.type ?? "";
    case "outstanding":
      return money ? f.outstanding ?? 0 : null;
    case "lifetime":
      return money ? f.lifetime ?? 0 : null;
    case "quoted":
      return money ? f.quoted ?? 0 : null;
    default:
      return c.name.toLowerCase();
  }
}

export const clientPage = query({
  args: {
    orgId: v.string(),
    now: v.optional(v.number()),
    segment: v.optional(v.string()),
    search: v.optional(v.string()),
    typeIn: strs,
    page: v.optional(v.number()),
    pageSize: v.optional(v.number()),
    sortBy: v.optional(v.string()),
    sortOrder,
  },
  handler: async (ctx, a) => {
    await requireOrgReadFor(ctx, a.orgId, "client");
    const { page, pageSize } = pageArgs(a);
    const { clients, facts, showMoney, truncated, today } = await loadClients(ctx, a.orgId, a.now);
    // `overdue` needs invoice figures: without them the segment is not offered, so it reads as `all`.
    const asked = (CLIENT_SEGMENT_KEYS as readonly string[]).includes(a.segment ?? "") ? (a.segment as ClientSegmentKey) : "all";
    const seg: ClientSegmentKey = asked === "overdue" && !showMoney ? "all" : asked;
    const sortBy = CLIENT_SORTS.has(a.sortBy ?? "") ? (a.sortBy as string) : "openJobs";
    const filtered = clients.filter((c) => {
      const f = facts.get(c.id)!;
      if (!inClientSegment(f, (c.isActive ?? true) === true, seg)) return false;
      if (!pickIn(a.typeIn, c.type)) return false;
      return !a.search || matchesSearch([c.name, c.contactName, c.contactEmail, ...(c.tags ?? [])], a.search);
    });
    const d = a.sortBy ? dir(a.sortOrder) : -1;
    const sorted = [...filtered].sort(
      (x, y) => compareValues(clientSortValue(x, facts.get(x.id)!, sortBy, showMoney), clientSortValue(y, facts.get(y.id)!, sortBy, showMoney), d) || compareValues(x.name.toLowerCase(), y.name.toLowerCase(), 1),
    );
    const { items: pageRows, total, totalPages } = paginateItems(sorted, page, pageSize);
    const items = pageRows.map((c) => {
      const { hasOverdue, ...f } = facts.get(c.id)!;
      void hasOverdue;
      return {
        id: c.id, name: c.name, type: c.type ?? null, contactName: c.contactName ?? null, contactEmail: c.contactEmail ?? null,
        tags: c.tags ?? [], isActive: (c.isActive ?? true) === true, xeroContactId: c.xeroContactId ?? null, xeroLinked: !!c.xeroContactId,
        ...f,
      };
    });
    return { items, total, totalPages, page, pageSize, truncated, today, moneyVisible: showMoney };
  },
});

export const clientSegmentCounts = query({
  args: { orgId: v.string(), now: v.optional(v.number()) },
  handler: async (ctx, { orgId, now }) => {
    await requireOrgReadFor(ctx, orgId, "client");
    const { clients, facts, showMoney, truncated } = await loadClients(ctx, orgId, now);
    const counts: Record<ClientSegmentKey | "truncated", number> = { all: 0, active: 0, quoting: 0, overdue: 0, archived: 0, truncated: truncated ? 1 : 0 };
    let withOpen = 0;
    let quoted = 0;
    let outstanding = 0;
    for (const c of clients) {
      const f = facts.get(c.id)!;
      const active = (c.isActive ?? true) === true;
      for (const k of CLIENT_SEGMENT_KEYS) if (inClientSegment(f, active, k)) counts[k]++;
      if (active && f.openJobCount > 0) withOpen++;
      quoted += f.quoted ?? 0;
      outstanding += f.outstanding ?? 0;
    }
    // The money lines of the head sub line: absent (not zero) without the invoice line.
    return { ...counts, overdue: showMoney ? counts.overdue : null, withOpenJobs: withOpen, ...(showMoney ? { quoted, outstanding } : {}) };
  },
});

// ─── Suppliers ───────────────────────────────────────────────────────────

const OPEN_ORDER = new Set(["DRAFT", "ORDERED", "PARTIAL"]);
const COMMITTED = new Set(["ORDERED", "PARTIAL", "RECEIVED"]);
const SUPPLIER_SEGMENTS = ["all", "open", "archived"] as const;
type SupplierSegment = (typeof SUPPLIER_SEGMENTS)[number];

async function loadSuppliers(ctx: QueryCtx, orgId: string, nowArg: number | undefined) {
  const now = resolveNow(nowArg);
  const yearStart = Date.UTC(new Date(now).getUTCFullYear(), 0, 1);
  const showMoney = await canSeeJobCost(ctx, orgId);
  const [suppliers, orders] = await Promise.all([
    collectCapped(ctx.db.query("suppliers").withIndex("by_organizationId", (q) => q.eq("organizationId", orgId)), ROSTER_CAP),
    collectCapped(ctx.db.query("supplierOrders").withIndex("by_organizationId", (q) => q.eq("organizationId", orgId)), ROSTER_CAP),
  ]);
  const facts = new Map<string, { openOrders: number; spendYtd?: number }>();
  for (const s of suppliers.rows) facts.set(s.id, { openOrders: 0, ...(showMoney ? { spendYtd: 0 } : {}) });
  for (const o of orders.rows) {
    const f = facts.get(o.supplierId);
    if (!f) continue;
    if (OPEN_ORDER.has(o.status ?? "DRAFT")) f.openOrders++;
    if (showMoney && COMMITTED.has(o.status ?? "DRAFT") && (o.orderDate ?? o.createdAt ?? 0) >= yearStart) f.spendYtd = (f.spendYtd ?? 0) + Number(o.total ?? 0);
  }
  return { suppliers: suppliers.rows, facts, showMoney, truncated: suppliers.truncated || orders.truncated };
}

const inSupplierSegment = (active: boolean, openOrders: number, seg: SupplierSegment) =>
  seg === "archived" ? !active : seg === "open" ? active && openOrders > 0 : active;

const SUPPLIER_SORTS = new Set(["name", "openOrders", "spend", "phone", "accountNumber", "email"]);

export const supplierPage = query({
  args: {
    orgId: v.string(),
    now: v.optional(v.number()),
    segment: v.optional(v.string()),
    search: v.optional(v.string()),
    page: v.optional(v.number()),
    pageSize: v.optional(v.number()),
    sortBy: v.optional(v.string()),
    sortOrder,
  },
  handler: async (ctx, a) => {
    await requireOrgReadFor(ctx, a.orgId, "supplier");
    const { page, pageSize } = pageArgs(a);
    const { suppliers, facts, showMoney, truncated } = await loadSuppliers(ctx, a.orgId, a.now);
    const seg = (SUPPLIER_SEGMENTS as readonly string[]).includes(a.segment ?? "") ? (a.segment as SupplierSegment) : "all";
    const sortBy = SUPPLIER_SORTS.has(a.sortBy ?? "") ? (a.sortBy as string) : "name";
    const val = (s: Doc<"suppliers">): unknown => {
      const f = facts.get(s.id)!;
      if (sortBy === "openOrders") return f.openOrders;
      if (sortBy === "spend") return showMoney ? f.spendYtd ?? 0 : null;
      if (sortBy === "phone") return s.phone ?? "";
      if (sortBy === "email") return s.email ?? "";
      if (sortBy === "accountNumber") return s.accountNumber ?? "";
      return s.name.toLowerCase();
    };
    const filtered = suppliers.filter(
      (s) => inSupplierSegment((s.isActive ?? true) === true, facts.get(s.id)!.openOrders, seg) && (!a.search || matchesSearch([s.name, s.contactName, s.email, s.accountNumber, ...(s.tags ?? [])], a.search)),
    );
    const sorted = [...filtered].sort((x, y) => compareValues(val(x), val(y), dir(a.sortOrder)) || compareValues(x.name.toLowerCase(), y.name.toLowerCase(), 1));
    const { items: pageRows, total, totalPages } = paginateItems(sorted, page, pageSize);
    const items = pageRows.map((s) => ({
      id: s.id, name: s.name, contactName: s.contactName ?? null, email: s.email ?? null, phone: s.phone ?? null,
      accountNumber: s.accountNumber ?? null, tags: s.tags ?? [], isActive: (s.isActive ?? true) === true, ...facts.get(s.id)!,
    }));
    return { items, total, totalPages, page, pageSize, truncated, moneyVisible: showMoney };
  },
});

export const supplierSegmentCounts = query({
  args: { orgId: v.string(), now: v.optional(v.number()) },
  handler: async (ctx, { orgId, now }) => {
    await requireOrgReadFor(ctx, orgId, "supplier");
    const { suppliers, facts, showMoney, truncated } = await loadSuppliers(ctx, orgId, now);
    const counts = { all: 0, open: 0, archived: 0, truncated: truncated ? 1 : 0, openOrders: 0 };
    let spend = 0;
    for (const s of suppliers) {
      const active = (s.isActive ?? true) === true;
      const f = facts.get(s.id)!;
      for (const k of SUPPLIER_SEGMENTS) if (inSupplierSegment(active, f.openOrders, k)) counts[k]++;
      counts.openOrders += active ? f.openOrders : 0;
      spend += f.spendYtd ?? 0;
    }
    return { ...counts, ...(showMoney ? { spendYtd: spend } : {}) };
  },
});
