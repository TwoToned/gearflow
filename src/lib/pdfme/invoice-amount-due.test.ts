// @vitest-environment node
//
/**
 * Regression coverage for the deposit-invoice bug (reported 2026-09-15 against
 * INV-260901): a DEPOSIT invoice's PDF deducted the project's derived
 * `depositPaid` — which issuing that very invoice had just set to the
 * invoice's own total (`convex/lib/recalc.ts` step 6b) — so the document read
 * as if the deposit had already been paid, and carried a "Balance Due" taken
 * from the PROJECT total that contradicted the "Total" row directly above it.
 *
 * The invariant these tests hold: whenever a render represents a SPECIFIC
 * invoice, the amount owed on the page is that invoice's own `total` and
 * nothing is deducted from it. Every invoice kind is already netted at
 * creation time by `invoicesWrites.ts` createNative, so a second deduction
 * here is always a double-count.
 */
import { describe, it, expect } from "vitest";
import { resolveInvoiceAmountDue } from "./build-document-data";

describe("resolveInvoiceAmountDue — a specific invoice states its own amount owed", () => {
  it("a DEPOSIT invoice never deducts itself (the reported bug: INV-260901)", () => {
    // The exact shape of the reported document: a $1320 project, a 25%
    // deposit invoice for $330, issued — which set projects.depositPaid to
    // 330. The old code printed "Deposit Paid -$330.00" and "Balance Due
    // $990.00" underneath a "Total $330.00".
    const result = resolveInvoiceAmountDue({
      invoice: { total: 330 },
      projectTotal: 1320,
      projectDepositInvoiced: 330,
    });
    expect(result.depositInvoiced).toBe(0);
    expect(result.balanceDue).toBe(330);
  });

  it("a BALANCE invoice owes its own already-netted total, not the project's", () => {
    // createNative computes a BALANCE as projectTotal less every non-VOID
    // partial — deducting the deposit again here would bill $660 on a $990
    // document.
    const result = resolveInvoiceAmountDue({
      invoice: { total: 990 },
      projectTotal: 1320,
      projectDepositInvoiced: 330,
    });
    expect(result.depositInvoiced).toBe(0);
    expect(result.balanceDue).toBe(990);
  });

  it("holds with MULTIPLE prior partials, where the old arithmetic broke outright", () => {
    // Two $330 deposits raised. The old `projectTotal - depositPaid` gave
    // $660 regardless of which invoice was being rendered.
    const secondDeposit = resolveInvoiceAmountDue({
      invoice: { total: 330 },
      projectTotal: 1320,
      projectDepositInvoiced: 660,
    });
    expect(secondDeposit.balanceDue).toBe(330);

    const balance = resolveInvoiceAmountDue({
      invoice: { total: 660 },
      projectTotal: 1320,
      projectDepositInvoiced: 660,
    });
    expect(balance.balanceDue).toBe(660);
  });

  it("a FULL invoice owes the whole project total with no deposit row", () => {
    const result = resolveInvoiceAmountDue({
      invoice: { total: 1320 },
      projectTotal: 1320,
      projectDepositInvoiced: 0,
    });
    expect(result.depositInvoiced).toBe(0);
    expect(result.balanceDue).toBe(1320);
  });

  it("a CREDIT invoice's negative total passes through unchanged", () => {
    const result = resolveInvoiceAmountDue({
      invoice: { total: -330 },
      projectTotal: 1320,
      projectDepositInvoiced: 330,
    });
    expect(result.depositInvoiced).toBe(0);
    expect(result.balanceDue).toBe(-330);
  });

  it("the balance due always equals the rendered invoice's Total row", () => {
    // The contradiction the bug produced, stated as a property: `total` on
    // the page comes from the same invoiceContext, so these must agree for
    // every kind and every project position.
    for (const invoiceTotal of [0.01, 330, 990, 1320, -330]) {
      for (const projectDepositInvoiced of [0, 330, 660, 1320]) {
        const { balanceDue, depositInvoiced } = resolveInvoiceAmountDue({
          invoice: { total: invoiceTotal },
          projectTotal: 1320,
          projectDepositInvoiced,
        });
        expect(balanceDue).toBe(invoiceTotal);
        expect(depositInvoiced).toBe(0);
      }
    }
  });
});

describe("resolveInvoiceAmountDue — the project-level DRAFT PREVIEW keeps its deposit row", () => {
  it("shows the project's position when no specific invoice is being rendered", () => {
    const result = resolveInvoiceAmountDue({
      invoice: null,
      projectTotal: 1320,
      projectDepositInvoiced: 330,
    });
    expect(result.depositInvoiced).toBe(330);
    expect(result.balanceDue).toBe(990);
  });

  it("omits the deposit row (0, the TotalsBlock gate) when nothing has been invoiced", () => {
    const result = resolveInvoiceAmountDue({
      invoice: null,
      projectTotal: 1320,
      projectDepositInvoiced: 0,
    });
    expect(result.depositInvoiced).toBe(0);
    expect(result.balanceDue).toBe(1320);
  });
});
