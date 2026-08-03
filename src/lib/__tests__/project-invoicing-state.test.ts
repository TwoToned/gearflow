// @vitest-environment node
import { describe, test, expect } from "vitest";
import { deriveInvoicingState, type InvoiceLike } from "@/lib/project-invoicing-state";

function inv(over: Partial<InvoiceLike> & { id: string; kind: string }): InvoiceLike {
  return { status: "DRAFT", total: 1000, amountPaid: 0, ...over };
}

describe("partial step — always offered while something remains", () => {
  test("offers a partial invoice with no invoices yet", () => {
    const s = deriveInvoicingState([], 25, 10_000);
    expect(s.partialStep).toEqual({ kind: "DEPOSIT", label: "Partial balance", depositPercent: 25 });
  });

  test("stays offered after one partial already exists — multiple partials are allowed", () => {
    const s = deriveInvoicingState([inv({ id: "1", kind: "DEPOSIT", status: "ISSUED", total: 2500 })], 25, 10_000);
    expect(s.partialStep).toEqual({ kind: "DEPOSIT", label: "Partial balance", depositPercent: 25 });
  });

  test("disappears once the project total is fully invoiced", () => {
    const s = deriveInvoicingState([inv({ id: "1", kind: "FULL", status: "ISSUED", total: 10_000 })], 25, 10_000);
    expect(s.partialStep).toEqual({ kind: "NONE", reason: "Fully invoiced" });
  });

  test("a VOID invoice doesn't count against the remainder", () => {
    const s = deriveInvoicingState([inv({ id: "1", kind: "FULL", status: "VOID", total: 10_000 })], 25, 10_000);
    expect(s.partialStep.kind).toBe("DEPOSIT");
  });

  test("unavailable when the project total is unknown", () => {
    const s = deriveInvoicingState([], 25, null);
    expect(s.partialStep).toEqual({ kind: "NONE", reason: "Project total not set" });
  });
});

describe("remaining step — FULL the first time, BALANCE after that", () => {
  test("offers a FULL (itemized) invoice with nothing raised yet", () => {
    const s = deriveInvoicingState([], 25, 10_000);
    expect(s.remainingStep).toEqual({ kind: "FULL", label: "Remaining balance" });
  });

  test("offers BALANCE once a partial already exists, even a draft one", () => {
    const s = deriveInvoicingState([inv({ id: "1", kind: "DEPOSIT", total: 2500 })], 25, 10_000);
    expect(s.remainingStep).toEqual({ kind: "BALANCE", label: "Remaining balance" });
  });

  test("stops once fully invoiced", () => {
    const s = deriveInvoicingState(
      [inv({ id: "1", kind: "DEPOSIT", status: "ISSUED", total: 2500 }), inv({ id: "2", kind: "BALANCE", status: "ISSUED", total: 7500 })],
      25,
      10_000,
    );
    expect(s.remainingStep).toEqual({ kind: "NONE", reason: "Fully invoiced" });
  });

  test("unavailable when the project total is unknown", () => {
    expect(deriveInvoicingState([], 25, null).remainingStep).toEqual({ kind: "NONE", reason: "Project total not set" });
  });
});

describe("money", () => {
  test("only ISSUED invoices count as money owed", () => {
    const s = deriveInvoicingState(
      [inv({ id: "1", kind: "DEPOSIT", status: "ISSUED", total: 2500 }), inv({ id: "2", kind: "BALANCE", total: 7500 })],
      25,
      10_000,
    );
    expect(s.invoicedTotal).toBe(2500);
    expect(s.outstanding).toBe(2500);
    expect(s.notYetInvoiced).toBe(0); // the draft still occupies its slice of the job
  });

  test("payments reduce what's outstanding", () => {
    const s = deriveInvoicingState(
      [inv({ id: "1", kind: "DEPOSIT", status: "ISSUED", total: 2500, amountPaid: 1000 })],
      25,
      10_000,
    );
    expect(s.paidTotal).toBe(1000);
    expect(s.outstanding).toBe(1500);
    expect(s.notYetInvoiced).toBe(7500);
  });

  test("an overpayment never shows as negative outstanding", () => {
    const s = deriveInvoicingState(
      [inv({ id: "1", kind: "FULL", status: "ISSUED", total: 1000, amountPaid: 1200 })],
      25,
      1000,
    );
    expect(s.outstanding).toBe(0);
  });

  test("a VOID invoice contributes nothing", () => {
    const s = deriveInvoicingState(
      [inv({ id: "1", kind: "FULL", status: "VOID", total: 9999, amountPaid: 9999 })],
      25,
      1000,
    );
    expect(s.invoicedTotal).toBe(0);
    expect(s.paidTotal).toBe(0);
    expect(s.notYetInvoiced).toBe(1000);
  });

  test("an unknown project total leaves notYetInvoiced unknown rather than guessing", () => {
    const s = deriveInvoicingState([], 25, null);
    expect(s.notYetInvoiced).toBeNull();
  });
});

describe("headline", () => {
  test("no invoices reads as not started", () => {
    expect(deriveInvoicingState([], 25, 1000).headline).toBe("NOT_STARTED");
  });

  test("drafts only reads as draft", () => {
    expect(deriveInvoicingState([inv({ id: "1", kind: "FULL" })], 25, 1000).headline).toBe("DRAFT");
  });

  test("issued and untouched reads as awaiting payment", () => {
    const s = deriveInvoicingState([inv({ id: "1", kind: "FULL", status: "ISSUED", total: 1000 })], 25, 1000);
    expect(s.headline).toBe("AWAITING_PAYMENT");
  });

  test("part-paid is distinguished from untouched", () => {
    const s = deriveInvoicingState(
      [inv({ id: "1", kind: "FULL", status: "ISSUED", total: 1000, amountPaid: 400 })],
      25,
      1000,
    );
    expect(s.headline).toBe("PARTIALLY_PAID");
  });

  test("a paid partial alone is NOT paid in full — the remainder is still to raise", () => {
    const s = deriveInvoicingState(
      [inv({ id: "1", kind: "DEPOSIT", status: "ISSUED", total: 2500, amountPaid: 2500 })],
      25,
      10_000,
    );
    expect(s.outstanding).toBe(0);
    expect(s.notYetInvoiced).toBe(7500);
    expect(s.headline).toBe("AWAITING_PAYMENT");
  });

  test("everything raised and paid reads as paid in full", () => {
    const s = deriveInvoicingState(
      [
        inv({ id: "1", kind: "DEPOSIT", status: "ISSUED", total: 2500, amountPaid: 2500 }),
        inv({ id: "2", kind: "BALANCE", status: "ISSUED", total: 7500, amountPaid: 7500 }),
      ],
      25,
      10_000,
    );
    expect(s.headline).toBe("PAID_IN_FULL");
  });
});

describe("latest issued", () => {
  test("picks the most recently issued invoice", () => {
    const s = deriveInvoicingState(
      [
        inv({ id: "old", kind: "DEPOSIT", status: "ISSUED", issuedAt: 100 }),
        inv({ id: "new", kind: "BALANCE", status: "ISSUED", issuedAt: 900 }),
        inv({ id: "draft", kind: "FULL", issuedAt: 9999 }),
      ],
      25,
      10_000,
    );
    expect(s.latestIssued?.id).toBe("new");
  });

  test("is null when nothing has been issued", () => {
    expect(deriveInvoicingState([inv({ id: "1", kind: "FULL" })], 25, 1000).latestIssued).toBeNull();
  });
});

describe("first unpaid issued", () => {
  test("targets the invoice outstanding longest, not the newest", () => {
    const s = deriveInvoicingState(
      [
        inv({ id: "new", kind: "BALANCE", status: "ISSUED", issuedAt: 900, total: 500 }),
        inv({ id: "old", kind: "DEPOSIT", status: "ISSUED", issuedAt: 100, total: 500 }),
      ],
      25,
      1000,
    );
    expect(s.firstUnpaidIssued?.id).toBe("old");
  });

  test("skips fully-paid invoices and ignores float dust", () => {
    const s = deriveInvoicingState(
      [
        inv({ id: "paid", kind: "DEPOSIT", status: "ISSUED", issuedAt: 100, total: 500, amountPaid: 499.999 }),
        inv({ id: "owing", kind: "BALANCE", status: "ISSUED", issuedAt: 200, total: 500, amountPaid: 100 }),
      ],
      25,
      1000,
    );
    expect(s.firstUnpaidIssued?.id).toBe("owing");
  });

  test("is null when nothing is owing", () => {
    const s = deriveInvoicingState([inv({ id: "1", kind: "FULL", status: "ISSUED", total: 500, amountPaid: 500 })], 25, 500);
    expect(s.firstUnpaidIssued).toBeNull();
  });
});
