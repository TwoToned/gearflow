// @vitest-environment node
import { describe, test, expect } from "vitest";
import { deriveInvoicingState, type InvoiceLike } from "@/lib/project-invoicing-state";

function inv(over: Partial<InvoiceLike> & { id: string; kind: string }): InvoiceLike {
  return { status: "DRAFT", total: 1000, amountPaid: 0, ...over };
}

const DEPOSIT_BALANCE = "DEPOSIT_BALANCE";
const FULL_UPFRONT = "FULL_UPFRONT";

describe("next step — deposit/balance profile", () => {
  test("starts by asking for the deposit", () => {
    const s = deriveInvoicingState([], DEPOSIT_BALANCE, 25, 10_000);
    expect(s.nextStep).toEqual({ kind: "DEPOSIT", label: "Create deposit invoice", depositPercent: 25 });
  });

  test("waits for the deposit to be ISSUED before offering the balance", () => {
    const draftDeposit = deriveInvoicingState([inv({ id: "1", kind: "DEPOSIT" })], DEPOSIT_BALANCE, 25, 10_000);
    expect(draftDeposit.nextStep).toEqual({ kind: "NONE", reason: "Issue the deposit invoice first" });

    const issuedDeposit = deriveInvoicingState(
      [inv({ id: "1", kind: "DEPOSIT", status: "ISSUED" })],
      DEPOSIT_BALANCE,
      25,
      10_000,
    );
    expect(issuedDeposit.nextStep).toEqual({ kind: "BALANCE", label: "Create balance invoice" });
  });

  test("stops once both exist", () => {
    const s = deriveInvoicingState(
      [inv({ id: "1", kind: "DEPOSIT", status: "ISSUED" }), inv({ id: "2", kind: "BALANCE" })],
      DEPOSIT_BALANCE,
      25,
      10_000,
    );
    expect(s.nextStep.kind).toBe("NONE");
  });

  test("a VOID deposit doesn't count — the deposit is offered again", () => {
    const s = deriveInvoicingState([inv({ id: "1", kind: "DEPOSIT", status: "VOID" })], DEPOSIT_BALANCE, 25, 10_000);
    expect(s.nextStep.kind).toBe("DEPOSIT");
  });
});

describe("next step — full-upfront profile", () => {
  test("offers one full invoice, then stops", () => {
    expect(deriveInvoicingState([], FULL_UPFRONT, 25, 10_000).nextStep).toEqual({
      kind: "FULL",
      label: "Create invoice",
    });
    const s = deriveInvoicingState([inv({ id: "1", kind: "FULL" })], FULL_UPFRONT, 25, 10_000);
    expect(s.nextStep).toEqual({ kind: "NONE", reason: "Already invoiced" });
  });
});

describe("money", () => {
  test("only ISSUED invoices count as money owed", () => {
    const s = deriveInvoicingState(
      [inv({ id: "1", kind: "DEPOSIT", status: "ISSUED", total: 2500 }), inv({ id: "2", kind: "BALANCE", total: 7500 })],
      DEPOSIT_BALANCE,
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
      DEPOSIT_BALANCE,
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
      FULL_UPFRONT,
      25,
      1000,
    );
    expect(s.outstanding).toBe(0);
  });

  test("a VOID invoice contributes nothing", () => {
    const s = deriveInvoicingState(
      [inv({ id: "1", kind: "FULL", status: "VOID", total: 9999, amountPaid: 9999 })],
      FULL_UPFRONT,
      25,
      1000,
    );
    expect(s.invoicedTotal).toBe(0);
    expect(s.paidTotal).toBe(0);
    expect(s.notYetInvoiced).toBe(1000);
  });

  test("an unknown project total leaves notYetInvoiced unknown rather than guessing", () => {
    const s = deriveInvoicingState([], FULL_UPFRONT, 25, null);
    expect(s.notYetInvoiced).toBeNull();
  });
});

describe("headline", () => {
  test("no invoices reads as not started", () => {
    expect(deriveInvoicingState([], FULL_UPFRONT, 25, 1000).headline).toBe("NOT_STARTED");
  });

  test("drafts only reads as draft", () => {
    expect(deriveInvoicingState([inv({ id: "1", kind: "FULL" })], FULL_UPFRONT, 25, 1000).headline).toBe("DRAFT");
  });

  test("issued and untouched reads as awaiting payment", () => {
    const s = deriveInvoicingState(
      [inv({ id: "1", kind: "FULL", status: "ISSUED", total: 1000 })],
      FULL_UPFRONT,
      25,
      1000,
    );
    expect(s.headline).toBe("AWAITING_PAYMENT");
  });

  test("part-paid is distinguished from untouched", () => {
    const s = deriveInvoicingState(
      [inv({ id: "1", kind: "FULL", status: "ISSUED", total: 1000, amountPaid: 400 })],
      FULL_UPFRONT,
      25,
      1000,
    );
    expect(s.headline).toBe("PARTIALLY_PAID");
  });

  test("a paid deposit alone is NOT paid in full — the balance is still to raise", () => {
    const s = deriveInvoicingState(
      [inv({ id: "1", kind: "DEPOSIT", status: "ISSUED", total: 2500, amountPaid: 2500 })],
      DEPOSIT_BALANCE,
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
      DEPOSIT_BALANCE,
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
      DEPOSIT_BALANCE,
      25,
      10_000,
    );
    expect(s.latestIssued?.id).toBe("new");
  });

  test("is null when nothing has been issued", () => {
    expect(deriveInvoicingState([inv({ id: "1", kind: "FULL" })], FULL_UPFRONT, 25, 1000).latestIssued).toBeNull();
  });
});

describe("first unpaid issued", () => {
  test("targets the invoice outstanding longest, not the newest", () => {
    const s = deriveInvoicingState(
      [
        inv({ id: "new", kind: "BALANCE", status: "ISSUED", issuedAt: 900, total: 500 }),
        inv({ id: "old", kind: "DEPOSIT", status: "ISSUED", issuedAt: 100, total: 500 }),
      ],
      DEPOSIT_BALANCE,
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
      DEPOSIT_BALANCE,
      25,
      1000,
    );
    expect(s.firstUnpaidIssued?.id).toBe("owing");
  });

  test("is null when nothing is owing", () => {
    const s = deriveInvoicingState(
      [inv({ id: "1", kind: "FULL", status: "ISSUED", total: 500, amountPaid: 500 })],
      FULL_UPFRONT,
      25,
      500,
    );
    expect(s.firstUnpaidIssued).toBeNull();
  });
});
