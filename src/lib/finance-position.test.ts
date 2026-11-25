// @vitest-environment node
import { describe, expect, test } from "vitest";
import { financePositionTiles } from "@/lib/finance-position";
import { deriveInvoicingState, type InvoiceLike } from "@/lib/project-invoicing-state";

const DAY = 86_400_000;
const NOW = Date.UTC(2026, 10, 24);
const money = (n: number) => `$${n}`;
const inv = (over: Partial<InvoiceLike>): InvoiceLike => ({ id: "i", kind: "FULL", status: "ISSUED", total: 1000, amountPaid: 0, ...over });
const tiles = (invoices: InvoiceLike[], over: Partial<Parameters<typeof financePositionTiles>[0]> = {}) =>
  financePositionTiles({
    liveQuote: { version: 3, status: "SENT", validUntil: NOW + 5 * DAY },
    invoicing: deriveInvoicingState(invoices, 25, 4000, NOW),
    total: 4000,
    margin: 1200,
    revenueExGst: 3600,
    now: NOW,
    money,
    ...over,
  });
const by = (t: ReturnType<typeof tiles>, key: string) => t.find((x) => x.key === key)!;

describe("financePositionTiles", () => {
  test("quote tile: human status word and validity", () => {
    expect(by(tiles([]), "quote")).toMatchObject({ headline: "v3 · Sent", detail: "valid 5 days more" });
    expect(by(tiles([], { liveQuote: null }), "quote").headline).toBe("No quote yet");
  });

  test("invoiced and paid tiles read the one derivation, incl. Deposit paid", () => {
    const t = tiles([inv({ kind: "DEPOSIT", total: 1000, amountPaid: 1000, paymentStatus: "PAID" })]);
    expect(by(t, "invoiced")).toMatchObject({ headline: "Deposit paid", detail: "$1000 of $4000 · $3000 not yet raised" });
    expect(by(t, "paid")).toMatchObject({ headline: "$1000 of $1000", detail: "nothing owing" });
  });

  test("an overdue invoice reads in error tone and outranks part paid (D56)", () => {
    const t = tiles([inv({ amountPaid: 100, paymentStatus: "PARTIALLY_PAID", dueDate: NOW - 3 * DAY })]);
    expect(by(t, "invoiced").headline).toBe("Overdue");
    expect(by(t, "paid")).toMatchObject({ tone: "error", detail: "1 invoice overdue · $900 outstanding" });
  });

  test("the margin tile is ABSENT, not $0, when the server sent no margin", () => {
    expect(tiles([]).map((x) => x.key)).toContain("margin");
    expect(tiles([], { margin: null }).map((x) => x.key)).not.toContain("margin");
    expect(tiles([], { margin: undefined }).map((x) => x.key)).not.toContain("margin");
  });
});
