import { describe, expect, it } from "vitest";

import { defaultListState, parseListState, serializeListState } from "@/lib/list-url-state";
import {
  CLIENTS_SPEC,
  CREW_SPEC,
  SUPPLIERS_SPEC,
  clientColumns,
  clientQueryArgs,
  clientRowOf,
  clientSegments,
  clientSubline,
  clientsCsv,
  crewColumns,
  crewQueryArgs,
  crewRowOf,
  dayLabel,
  supplierColumns,
  supplierRowOf,
  supplierSubline,
  suppliersCsv,
  type ClientSource,
  type CrewSource,
  type SupplierSource,
} from "./people";

const NOW = Date.UTC(2026, 10, 24, 12);
const params = (qs: string) => new URLSearchParams(qs);

describe("People URL specs", () => {
  it("drops junk and omits defaults", () => {
    const s = parseListState(params("seg=nope&sort=bogus:desc&page=0"), CREW_SPEC);
    expect(s).toEqual(defaultListState(CREW_SPEC));
    expect(serializeListState(s, CREW_SPEC).toString()).toBe("");
    expect(parseListState(params("seg=unconfirmed&type=FREELANCER,EMPLOYEE&sort=next:desc&page=2"), CREW_SPEC)).toMatchObject({ seg: "unconfirmed", sortBy: "next", sortOrder: "desc", page: 2, filters: { type: ["FREELANCER", "EMPLOYEE"] } });
  });
  it("defaults: crew by status, clients by open jobs descending, suppliers by name", () => {
    expect(defaultListState(CREW_SPEC)).toMatchObject({ sortBy: "status", sortOrder: "asc" });
    expect(defaultListState(CLIENTS_SPEC)).toMatchObject({ sortBy: "openJobs", sortOrder: "desc" });
    expect(defaultListState(SUPPLIERS_SPEC)).toMatchObject({ sortBy: "name", sortOrder: "asc" });
  });
  it("query args drop unknown filter values and carry the stable clock", () => {
    const state = parseListState(params("type=FREELANCER,ALIEN&dept=Audio&q=%20sam%20"), CREW_SPEC);
    expect(crewQueryArgs(state, NOW)).toMatchObject({ typeIn: ["FREELANCER"], departmentIn: ["Audio"], search: "sam", now: NOW, pageSize: 25 });
    expect(clientQueryArgs(parseListState(params("type=VENUE"), CLIENTS_SPEC), NOW).typeIn).toEqual(["VENUE"]);
  });
});

describe("pay and money columns are absent, not empty", () => {
  it("crew Rate /day only with pay", () => {
    expect(crewColumns(true).map((c) => c.id)).toContain("rate");
    expect(crewColumns(false).map((c) => c.id)).not.toContain("rate");
  });
  it("client Quoted / Outstanding / Lifetime and the Overdue segment only with the invoice line", () => {
    expect(clientColumns(false).map((c) => c.id)).not.toEqual(expect.arrayContaining(["quoted"]));
    expect(clientColumns(false).map((c) => c.id)).not.toContain("outstanding");
    expect(clientColumns(false).map((c) => c.id)).not.toContain("lifetime");
    expect(clientColumns(true).map((c) => c.id)).toEqual(expect.arrayContaining(["quoted", "outstanding", "lifetime"]));
    expect(clientSegments(undefined, false).map((s) => s.key)).not.toContain("overdue");
    expect(clientSegments(undefined, true).map((s) => s.key)).toContain("overdue");
  });
  it("supplier Spend YTD only with the job-cost line", () => {
    expect(supplierColumns(false).map((c) => c.id)).not.toContain("spend");
    expect(supplierColumns(true).map((c) => c.id)).toContain("spend");
  });
});

const crew = (over: Partial<CrewSource> = {}): CrewSource => ({
  id: "m1", firstName: "Sam", lastName: "Okafor", listStatus: "AVAILABLE", next: null, daysThisWeek: 0, clashDay: null, ...over,
});

describe("crewRowOf", () => {
  it("maps status, next call, this week and the clash flag", () => {
    const day = Math.floor(Date.UTC(2026, 10, 26) / 86_400_000);
    const row = crewRowOf(
      crew({ listStatus: "UNCONFIRMED", crewRole: { id: "r", name: "Audio A1" }, department: "Audio", phone: "0400", defaultDayRate: 450, daysThisWeek: 3, clashDay: day, next: { startDay: day, status: "OFFERED", callId: "c", project: { id: "p", projectNumber: "#2341", name: "Gala" } } }),
    );
    expect(row.status).toEqual({ label: "Unconfirmed", intent: "warning" });
    expect(row.subtitle).toBe("Audio A1 · Audio");
    expect(row.facts.next).toEqual({ kind: "text", label: "#2341 · 26 Nov" });
    expect(row.facts.week).toEqual({ kind: "text", label: "3 d" });
    expect(row.facts.rate).toEqual({ kind: "money", amount: 450 });
    expect(row.flags).toEqual([{ label: "clash 26 Nov", tone: "error" }]);
    expect(row.href).toBe("/crew/m1");
  });
  it("a member with no rate field gets no rate fact (absent, not zero)", () => {
    expect("rate" in crewRowOf(crew()).facts).toBe(false);
    expect("week" in crewRowOf(crew()).facts).toBe(false);
  });
  it("prefers the linked user's name", () => {
    expect(crewRowOf(crew({ user: { name: "Samuel O." } })).title).toBe("Samuel O.");
  });
});

const client = (over: Partial<ClientSource> = {}): ClientSource => ({
  id: "k1", name: "Hilton", type: "VENUE", contactName: "Priya", contactEmail: "p@h.co", tags: [], isActive: true, xeroLinked: true,
  openJobs: [{ id: "j1", projectNumber: "#1" }, { id: "j2", projectNumber: "#2" }, { id: "j3", projectNumber: "#3" }], openJobCount: 3, lastJobAt: NOW, ...over,
});

describe("clientRowOf", () => {
  it("lists job numbers, prints overdue as a red flag and keeps money blank when zero", () => {
    const row = clientRowOf(client({ quoted: 0, outstanding: 1200, overdueDays: 18 }));
    expect(row.facts.openJobs).toEqual({ kind: "text", label: "#1, #2 +1" });
    expect(row.facts.quoted).toEqual({ kind: "money", amount: null });
    expect(row.facts.outstanding).toEqual({ kind: "money", amount: 1200 });
    expect(row.flags).toEqual([{ label: "18d overdue", tone: "error" }]);
    expect(row.subtitle).toBe("Priya · Venue");
  });
  it("no money facts at all when the server sent none", () => {
    const row = clientRowOf(client());
    for (const k of ["quoted", "outstanding", "lifetime"]) expect(k in row.facts).toBe(false);
  });
  it("archived clients carry a status word", () => {
    expect(clientRowOf(client({ isActive: false })).status?.label).toBe("Archived");
    expect(clientRowOf(client()).status).toBeUndefined();
  });
  it("sub line", () => {
    expect(clientSubline({ withOpenJobs: 10, quoted: 234400, outstanding: 76170 })).toBe("10 with open jobs · $234,400 quoted · $76,170 outstanding");
    expect(clientSubline({ withOpenJobs: 10 })).toBe("10 with open jobs");
    expect(clientSubline(undefined)).toBeUndefined();
  });
});

describe("exports go through the CSV formula guard", () => {
  it("a client named =cmd is quoted as text", () => {
    expect(clientsCsv([client({ name: "=HYPERLINK(1)" })])).toContain("'=HYPERLINK(1)");
  });
  it("supplier export includes Spend YTD only when present", () => {
    const s: SupplierSource = { id: "s", name: "Scene", contactName: null, email: null, phone: null, accountNumber: null, tags: ["a"], isActive: true, openOrders: 2 };
    expect(suppliersCsv([s]).split("\n")[0]).not.toContain("Spend");
    expect(suppliersCsv([{ ...s, spendYtd: 99 }]).split("\n")[0]).toContain("Spend YTD");
    expect(supplierRowOf({ ...s, spendYtd: 0 }).facts.spend).toEqual({ kind: "money", amount: null });
  });
  it("a truncated read shows spend as `at least`, never a confident total", () => {
    const s: SupplierSource = { id: "s", name: "Scene", contactName: null, email: null, phone: null, accountNumber: null, tags: [], isActive: true, openOrders: 2 };
    const partial = { ...s, spendYtd: 1200, spendPartial: true };
    expect(supplierRowOf(partial).facts.spend).toEqual({ kind: "text", label: "at least $1,200" });
    expect(supplierRowOf({ ...partial, spendPartial: false }).facts.spend).toEqual({ kind: "money", amount: 1200 });
    expect(suppliersCsv([partial])).toContain("at least 1200");
    expect(supplierSubline({ open: 1, openOrders: 2, spendYtd: 1200, truncated: 1, spendPartial: 1 })).toContain("at least $1,200 this year");
  });
  it("dayLabel is UTC", () => {
    expect(dayLabel(Math.floor(Date.UTC(2026, 10, 24) / 86_400_000))).toBe("24 Nov");
  });
});
