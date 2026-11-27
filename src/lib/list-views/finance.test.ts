import { describe, expect, it } from "vitest";

import { defaultListState, parseListState } from "@/lib/list-url-state";
import {
  INVOICES_SPEC,
  QUOTES_SPEC,
  hubFilters,
  hubQueryArgs,
  hubSegments,
  hubSubline,
  invoiceColumns,
  invoiceRow,
  invoiceStatusLine,
  moneyWords,
  parseHubTab,
  quoteColumns,
  quoteRow,
  quoteWhenLine,
  toRaiseRow,
  type InvoiceSource,
  type QuoteSource,
} from "@/lib/list-views/finance";

const project = { id: "p1", projectNumber: "#2341", name: "Hilton gala", clientName: "Hilton" };
const quote = (over: Partial<QuoteSource> = {}): QuoteSource => ({
  id: "q1", version: 3, status: "SENT", dismissed: false, sentAt: Date.UTC(2026, 10, 4), validUntil: null, daysLeft: 5, hasPdf: true, project, total: 5000, ...over,
});
const invoice = (over: Partial<InvoiceSource> = {}): InvoiceSource => ({
  id: "i1", invoiceNumber: "INV-0041", kind: "DEPOSIT", depositPercent: 30, pill: "ISSUED", pillLabel: "Issued", issuedAt: Date.UTC(2026, 10, 6), dueDate: null,
  overdueDays: null, hasPdf: true, xero: { status: "SYNCED", error: null }, project, total: 3300, outstanding: 3300, ...over,
});

describe("the hub's money words", () => {
  it("are four deep links into the lists they count, and ABSENT without money", () => {
    const words = moneyWords({ quoted: 12345.6, awaitingPayment: 800, invoicedThisMonth: 0, overdue: 70 });
    expect(words.map((w) => [w.label, w.amount, w.href])).toEqual([
      ["Quoted", "$12,346", "/finance?tab=quotes&seg=sent"],
      ["Awaiting payment", "$800", "/finance?tab=invoices&seg=issued"],
      ["Invoiced this month", "$0", "/finance?tab=invoices&seg=all&issued=month"],
      ["Overdue", "$70", "/finance?tab=invoices&seg=overdue"],
    ]);
    expect(words[3].tone).toBe("error");
    expect(moneyWords(undefined)).toEqual([]);
    // A figure behind a cut read reads `at least`, never a confident number.
    const approx = moneyWords({ quoted: 1000, awaitingPayment: 800, invoicedThisMonth: 0, overdue: 70 }, { overdue: true, awaitingPayment: true });
    expect(approx.map((w) => w.amount)).toEqual(["$1,000", "at least $800", "$0", "at least $70"]);
  });
});

describe("columns: a money column exists only when the server sent money", () => {
  it("quotes and invoices", () => {
    expect(quoteColumns(true).map((c) => c.id)).toContain("total");
    expect(quoteColumns(false).map((c) => c.id)).not.toContain("total");
    expect(invoiceColumns(false, true).map((c) => c.id)).toEqual(["job", "status", "issued", "xero"]);
    expect(invoiceColumns(true, false).map((c) => c.id)).toEqual(["job", "status", "issued", "total"]);
    expect(invoiceColumns(true, false).every((c) => c.id !== "total" || c.sortKey === "total")).toBe(true);
  });
  it("a hidden money field is simply not on the row (never a zero)", () => {
    const q = quoteRow(quote({ total: undefined }));
    const i = invoiceRow(invoice({ total: undefined, outstanding: undefined }));
    expect("total" in q.facts).toBe(false);
    expect("total" in i.facts).toBe(false);
  });
});

describe("rows read the DERIVED words the server sent", () => {
  it("a quote row is `#2341 v3`, opens the job's Finance tab, and flags a sent quote in its last week", () => {
    const r = quoteRow(quote());
    expect(r.title).toBe("#2341 v3");
    expect(r.href).toBe("/projects/p1?tab=finance");
    expect(r.status?.label).toBe("Sent");
    expect(r.flags).toEqual([{ label: "5d left", tone: "warning" }]);
    expect(quoteRow(quote({ daysLeft: 20 })).flags).toEqual([]);
  });

  it("an expired quote is a red flag until it is dismissed", () => {
    const fresh = quoteRow(quote({ status: "EXPIRED", daysLeft: -2 }));
    expect(fresh.status?.label).toBe("Expired");
    expect(fresh.flags?.[0].tone).toBe("error");
    expect(quoteWhenLine({ status: "EXPIRED", daysLeft: -2 })).toBe("expired 2d ago");
    expect(quoteRow(quote({ status: "EXPIRED", daysLeft: -20, dismissed: true })).flags).toEqual([]);
  });

  it("an invoice row shows the ONE pill: Overdue outranks Part paid (D56), and the line under it is days late + what is owed", () => {
    const r = invoiceRow(invoice({ pill: "OVERDUE", pillLabel: "Overdue", overdueDays: 4, outstanding: 70 }));
    expect(r.status?.label).toBe("Overdue");
    expect(r.status?.intent).toBe("error");
    expect(invoiceStatusLine({ pill: "OVERDUE", overdueDays: 4, outstanding: 70 })).toBe("4d overdue · $70 to go");
    expect(invoiceStatusLine({ pill: "PART_PAID", overdueDays: null, outstanding: 2950 })).toBe("$2,950 to go");
    expect(invoiceStatusLine({ pill: "PAID", overdueDays: null, outstanding: 0 })).toBeUndefined();
    expect(invoiceStatusLine({ pill: "PART_PAID", overdueDays: null, outstanding: undefined })).toBeUndefined(); // no money, no "to go"
  });

  it("dates print in the ORG timezone, not UTC (00:10 on 1 Dec Sydney is 1 Dec, not 30 Nov)", () => {
    const at = Date.UTC(2026, 10, 30, 13, 10);
    expect(invoiceRow(invoice({ issuedAt: at }), undefined, "Australia/Sydney").facts.issued).toEqual({ kind: "text", label: "1 Dec" });
    expect(invoiceRow(invoice({ issuedAt: at }), undefined, "UTC").facts.issued).toEqual({ kind: "text", label: "30 Nov" });
    expect(quoteRow(quote({ sentAt: at }), undefined, "Australia/Sydney").facts.sent).toEqual({ kind: "text", label: "1 Dec" });
  });

  it("kind and Xero words", () => {
    expect(invoiceRow(invoice()).subtitle).toBe("Deposit 30%");
    expect(invoiceRow(invoice()).facts.xero).toEqual({ kind: "text", label: "Synced" });
    expect(invoiceRow(invoice({ xero: { status: "ERROR", error: "x" } })).facts.xero).toEqual({ kind: "text", label: "Failed" });
    expect(invoiceRow(invoice({ xero: null })).facts.xero).toBeUndefined();
  });

  it("a job still to invoice is a project row with the deposit to raise (money only when sent)", () => {
    const r = toRaiseRow({ id: "p3", projectNumber: "#1003", name: "Gala", clientName: "Deposit Co", depositPercent: 30, amount: 3000 });
    expect(r.status?.label).toBe("Deposit due");
    expect(r.facts.total).toEqual({ kind: "money", amount: 3000 });
    expect("total" in toRaiseRow({ id: "p3", projectNumber: "#1003", name: "Gala", clientName: null, depositPercent: 30 }).facts).toBe(false);
  });
});

describe("URL state and query args", () => {
  it("each list has its own segments, sorts and default; the tab is not a list param", () => {
    expect(QUOTES_SPEC.segments).toEqual(["all", "draft", "sent", "accepted", "expired"]);
    expect(INVOICES_SPEC.segments).toEqual(["all", "draft", "depositdue", "issued", "paid", "overdue"]);
    expect(parseListState(new URLSearchParams("tab=invoices&seg=overdue"), INVOICES_SPEC).seg).toBe("overdue");
    expect(parseListState(new URLSearchParams("seg=nope"), INVOICES_SPEC).seg).toBe("all");
    expect(parseHubTab("invoices")).toBe("invoices");
    expect(parseHubTab("junk")).toBe("quotes");
  });

  it("`show` opts declined/superseded (quotes) or void (invoices) back in", () => {
    const base = defaultListState(QUOTES_SPEC);
    expect(hubQueryArgs("quotes", { ...base, filters: { show: ["closed"] } }, 1)).toMatchObject({ includeClosed: true });
    expect(hubQueryArgs("quotes", base, 1)).toMatchObject({ includeClosed: false });
    expect(hubQueryArgs("invoices", { ...defaultListState(INVOICES_SPEC), filters: { show: ["void"] } }, 1)).toMatchObject({ includeVoid: true });
    expect(hubQueryArgs("quotes", base, 7).now).toBe(7);
  });

  it("the spec's remaining filters ride the list URL schema and become typed query args", () => {
    const qs = parseListState(new URLSearchParams("client=c1,c2&sent=30d&validity=7d&show=closed"), QUOTES_SPEC);
    expect(hubQueryArgs("quotes", qs, 5)).toMatchObject({ clientIn: ["c1", "c2"], sent: "30d", validity: "7d", includeClosed: true });
    const is = parseListState(new URLSearchParams("tab=invoices&kind=DEPOSIT,FULL&issued=month&xero=ERROR,SYNCED&client=c9"), INVOICES_SPEC);
    expect(hubQueryArgs("invoices", is, 5)).toMatchObject({ kindIn: ["DEPOSIT", "FULL"], issued: "month", xeroIn: ["ERROR", "SYNCED"], clientIn: ["c9"], includeVoid: false });
    // Junk values are dropped, not forwarded.
    const bad = parseListState(new URLSearchParams("kind=BOGUS&issued=forever&xero=NOPE&sent=1y"), INVOICES_SPEC);
    expect(hubQueryArgs("invoices", bad, 5)).toMatchObject({ kindIn: undefined, issued: undefined, xeroIn: undefined });
    expect((hubQueryArgs("quotes", parseListState(new URLSearchParams("sent=1y"), QUOTES_SPEC), 5) as { sent?: string }).sent).toBeUndefined();
  });

  it("filter words: quotes Client/Sent/Validity; invoices Client/Kind/Issued, Xero only when connected", () => {
    expect(hubFilters("quotes").map((f) => f.key)).toEqual(["client", "sent", "validity", "show"]);
    expect(hubFilters("invoices").map((f) => f.key)).toEqual(["client", "kind", "issued", "show"]);
    expect(hubFilters("invoices", { xeroConnected: true }).map((f) => f.key)).toEqual(["client", "kind", "issued", "xero", "show"]);
    expect(hubFilters("quotes", { clients: [{ id: "c1", name: "Hilton" }] })[0].options).toEqual([{ value: "c1", label: "Hilton" }]);
  });

  it("segment counts come from the server's strip, and the sub line says `at least` when capped", () => {
    expect(hubSegments("quotes", { all: 6, sent: 2 }).find((s) => s.key === "sent")?.count).toBe(2);
    // A cut read leaves the counts OFF the strip (they would be a confident floor).
    expect(hubSegments("invoices", { all: 6, overdue: 1, depositdue: 2 }, { tab: true }).map((s) => s.count)).toEqual([undefined, undefined, 2, undefined, undefined, undefined]);
    expect(hubSegments("invoices", { all: 6, depositdue: 2 }, { depositdue: true }).find((s) => s.key === "depositdue")?.count).toBeUndefined();
    expect(hubSubline({ quotes: { all: 27 }, invoices: { all: 20 } })).toBe("27 quotes · 20 invoices");
    expect(hubSubline({ quotes: { all: 1 }, invoices: { all: 1 }, approx: { quotes: true, invoices: true } })).toBe("at least 1 quote \u00b7 at least 1 invoice");
    expect(hubSubline({ quotes: { all: 1 }, invoices: { all: 4 }, approx: { invoices: true } })).toBe("1 quote \u00b7 at least 4 invoices");
    expect(hubSubline(undefined)).toBeUndefined();
  });
});
