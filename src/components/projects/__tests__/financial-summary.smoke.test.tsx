// @vitest-environment jsdom
//
// WS11 (#950) regression: sale revenue/COGS used to have no dedicated rows
// here and silently folded into "Services" (the caller derived
// serviceChargeTotal as subtotal - equipmentRevenue, which — once saleRevenue
// existed — over-counted "Services" by exactly the sale amount). Pins that
// FinancialSummary renders its own "Sale items"/"Sale cost of goods" rows
// instead.
import React from "react";
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { FinancialSummary } from "@/components/projects/financial-summary";

const BASE_PROPS = {
  equipmentRevenue: 1000,
  serviceCostTotal: null,
  labourCostTotal: null,
  subtotal: 1000,
  discountPercent: null,
  discountAmount: null,
  taxRate: 10,
  taxAmount: 100,
  total: 1100,
  margin: 400,
  depositPaid: null,
  invoicedTotal: null,
};

describe("FinancialSummary smoke", () => {
  it("renders no sale rows when saleRevenue/saleCostTotal are absent", () => {
    render(<FinancialSummary {...BASE_PROPS} />);
    expect(screen.queryByText("Sale items")).toBeNull();
    expect(screen.queryByText("Sale cost of goods")).toBeNull();
  });

  it("renders a 'Sale items' revenue row and a 'Sale cost of goods' cost row", () => {
    render(<FinancialSummary {...BASE_PROPS} saleRevenue={250} saleCostTotal={90} />);
    expect(screen.getByText("Sale items")).toBeTruthy();
    expect(screen.getByText("$250.00")).toBeTruthy();
    expect(screen.getByText("Sale cost of goods")).toBeTruthy();
    // $90 is also the (only) "Total costs" figure — assert at least one, not uniqueness.
    expect(screen.getAllByText("$90.00").length).toBeGreaterThan(0);
  });
});
