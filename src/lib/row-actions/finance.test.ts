import { describe, expect, test } from "vitest";

import { buildInvoiceHubActions, buildQuoteHubActions, hubPreviewHref, invoiceHubBulk, pdfVerb, quoteHubBulk, VOID_INVOICE_COPY } from "./finance";

const noop = () => {};
const keys = (s: { items: { key: string }[] }) => s.items.map((i) => i.key);
type QRow = Parameters<typeof buildQuoteHubActions>[0];
type IRow = Parameters<typeof buildInvoiceHubActions>[0];
const q = (o: Partial<QRow> = {}) => ({ status: "SENT", dismissed: false, hasPdf: true, ...o }) as QRow;
const inv = (o: Partial<IRow> = {}) => ({ pill: "ISSUED", hasPdf: true, kind: "FULL", xero: null, invoiceNumber: "INV-1", ...o }) as IRow;

describe("pdfVerb: Generate only fills an empty slot", () => {
  test("stored -> open, draft -> preview, sent without a copy -> generate", () => {
    expect(pdfVerb({ hasPdf: true, draft: false })).toBe("open");
    expect(pdfVerb({ hasPdf: true, draft: true })).toBe("open");
    expect(pdfVerb({ hasPdf: false, draft: true })).toBe("preview");
    expect(pdfVerb({ hasPdf: false, draft: false })).toBe("generate");
  });
  test("a row with a stored PDF never offers Generate", () => {
    const all = { onOpenJob: noop, onOpenPdf: noop, onGeneratePdf: noop, onPreview: noop };
    expect(keys(buildQuoteHubActions(q({ hasPdf: true }), all))).not.toContain("generate");
    expect(keys(buildInvoiceHubActions(inv({ hasPdf: true }), all))).not.toContain("generate");
  });
});

describe("quote menu: absent, never disabled", () => {
  test("no handler (no permission) -> the verb is absent", () => {
    expect(keys(buildQuoteHubActions(q(), { onOpenJob: noop }))).toEqual(["open"]);
  });
  test("Mark accepted / Chase only on a sent or expired quote", () => {
    const ctx = { onOpenJob: noop, onAccept: noop, onChase: noop };
    expect(keys(buildQuoteHubActions(q({ status: "SENT" }), ctx))).toEqual(["open", "accept", "chase"]);
    expect(keys(buildQuoteHubActions(q({ status: "ACCEPTED" }), ctx))).toEqual(["open"]);
    expect(keys(buildQuoteHubActions(q({ status: "DRAFT" }), ctx))).toEqual(["open"]);
  });
  test("Acknowledge only on an undismissed expired quote", () => {
    const ctx = { onOpenJob: noop, onAcknowledge: noop };
    expect(keys(buildQuoteHubActions(q({ status: "EXPIRED" }), ctx))).toContain("ack");
    expect(keys(buildQuoteHubActions(q({ status: "EXPIRED", dismissed: true }), ctx))).not.toContain("ack");
    expect(keys(buildQuoteHubActions(q({ status: "SENT" }), ctx))).not.toContain("ack");
  });
});

describe("invoice menu", () => {
  const all = { onOpenJob: noop, onRecordPayment: noop, onChase: noop, onPushXero: noop, onVoid: noop, onDeleteDraft: noop };
  test("an unsettled invoice offers pay/chase/void; delete is a draft-only verb", () => {
    const k = keys(buildInvoiceHubActions(inv({ pill: "OVERDUE" }), all));
    expect(k).toEqual(expect.arrayContaining(["pay", "chase", "void"]));
    expect(k).not.toContain("delete");
  });
  test("a draft offers only Delete draft (confirmed, red, last)", () => {
    const s = buildInvoiceHubActions(inv({ pill: "DRAFT", hasPdf: false, invoiceNumber: null }), all);
    expect(keys(s)).toEqual(["open", "delete"]);
    const del = s.items[s.items.length - 1];
    expect(del.danger).toBe(true);
    expect(del.confirm?.title).toBe("Delete this draft?");
  });
  test("Void is offered only on an unsettled invoice with NO recorded payment (voidNative checks none)", () => {
    expect(keys(buildInvoiceHubActions(inv({ pill: "PAID", hasPayments: true }), all))).not.toContain("void");
    expect(keys(buildInvoiceHubActions(inv({ pill: "PART_PAID", hasPayments: true }), all))).not.toContain("void");
    expect(keys(buildInvoiceHubActions(inv({ pill: "OVERDUE", hasPayments: true }), all))).not.toContain("void"); // overdue AND part-paid
    expect(keys(buildInvoiceHubActions(inv({ pill: "OVERDUE", hasPayments: false }), all))).toContain("void");
    expect(keys(buildInvoiceHubActions(inv({ pill: "VOID" }), all))).not.toContain("void");
    expect(keys(buildInvoiceHubActions(inv({ pill: "VOID" }), all))).not.toContain("generate");
    expect(keys(buildInvoiceHubActions(inv({ pill: "PAID" }), all))).not.toContain("pay");
    expect(keys(buildInvoiceHubActions(inv({ pill: "PAID" }), all))).not.toContain("chase");
  });
  test("the Void copy makes no claim the server does not keep", () => {
    expect(VOID_INVOICE_COPY.body).not.toMatch(/payment blocks|voided there too/i);
    expect(VOID_INVOICE_COPY.body).toMatch(/does not change Xero/i);
  });
  test("a credit note is never paid or chased", () => {
    const k = keys(buildInvoiceHubActions(inv({ kind: "CREDIT" }), all));
    expect(k).not.toContain("pay");
    expect(k).not.toContain("chase");
  });
  test("Push to Xero only for an unsynced or errored row; the label says Retry on error", () => {
    expect(keys(buildInvoiceHubActions(inv({ xero: { status: "SYNCED" } as IRow["xero"] }), all))).not.toContain("xero");
    const err = buildInvoiceHubActions(inv({ xero: { status: "ERROR" } as IRow["xero"] }), all);
    expect(err.items.find((i) => i.key === "xero")?.label).toBe("Retry push to Xero");
  });
  test("danger verbs sort after everything else", () => {
    const s = buildInvoiceHubActions(inv({ pill: "ISSUED" }), all);
    expect(s.items[s.items.length - 1].key).toBe("void");
  });
});

describe("bulk verbs are absent without their handler", () => {
  test("quotes: Export is always there, the rest need a handler", () => {
    expect(quoteHubBulk({ onExport: noop }).map((b) => b.key)).toEqual(["export"]);
    expect(quoteHubBulk({ onExport: noop, onChaseMany: noop, onAcknowledgeMany: noop }).map((b) => b.key)).toEqual(["chase", "ack", "export"]);
  });
  test("invoices: Delete drafts is danger + confirmed and last", () => {
    const b = invoiceHubBulk({ onExport: noop, onChaseMany: noop, onSyncXeroMany: noop, onDeleteDraftsMany: noop });
    expect(b.map((x) => x.key)).toEqual(["chase", "xero", "export", "delete"]);
    expect(b[3].danger).toBe(true);
    expect(b[3].confirm).toBeTruthy();
    expect(invoiceHubBulk({ onExport: noop }).map((x) => x.key)).toEqual(["export"]);
  });
});

describe("hubPreviewHref names the exact draft (a job can hold several)", () => {
  test("an invoice preview carries its invoiceId", () => {
    expect(hubPreviewHref("invoice", "p1", { invoiceId: "inv_9" })).toBe("/api/documents/p1?type=invoice&preview=1&invoiceId=inv_9");
  });
  test("a quote preview carries the version it was built from; a draft without one previews the live version", () => {
    expect(hubPreviewHref("quote", "p1", { versionId: "v_2" })).toBe("/api/documents/p1?type=quote&preview=1&versionId=v_2");
    expect(hubPreviewHref("quote", "p1", { versionId: null })).toBe("/api/documents/p1?type=quote&preview=1");
  });
  test("ids are URL-encoded", () => {
    expect(hubPreviewHref("invoice", "p1", { invoiceId: "a&b" })).toContain("invoiceId=a%26b");
  });
});
