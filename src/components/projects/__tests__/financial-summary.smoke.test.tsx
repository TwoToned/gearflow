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
import { mapProject } from "@/lib/project-detail-reconstruct";

// recalcProjectTotals always writes the cost buckets as numbers: 0 = "no cost", never null.
const BASE_PROPS = {
  equipmentRevenue: 1000,
  serviceCostTotal: 0,
  labourCostTotal: 0,
  subtotal: 1000,
  discountPercent: null,
  discountAmount: null,
  taxRate: 10,
  taxAmount: 100,
  total: 1100,
  margin: 400,
};

const RECONSTRUCTED_DOC = { id: "p1", organizationId: "o1", projectNumber: "1", name: "Gig", status: "CONFIRMED", total: 1100, subtotal: 1000, taxAmount: 100, taxRate: 10, equipmentRevenue: 1000, subHireCostTotal: 0 };

function renderMapped(p: ReturnType<typeof mapProject>) {
  return render(
    <FinancialSummary
      equipmentRevenue={p.equipmentRevenue} serviceCostTotal={p.serviceCostTotal} labourCostTotal={p.labourCostTotal}
      subHireCostTotal={p.subHireCostTotal} subtotal={p.subtotal} discountPercent={p.discountPercent} discountAmount={p.discountAmount}
      taxRate={p.taxRate} taxAmount={p.taxAmount} total={p.total} margin={p.margin}
    />,
  );
}

describe("FinancialSummary smoke", () => {
  it("renders no sale rows when saleRevenue/saleCostTotal are absent", () => {
    render(<FinancialSummary {...BASE_PROPS} />);
    expect(screen.queryByText("Sale items")).toBeNull();
    expect(screen.queryByText("Sale cost of goods")).toBeNull();
  });

  it("without job cost (job-cost totals and margin ABSENT): no margin and no costs render, revenue does", () => {
    const { serviceCostTotal: _s, labourCostTotal: _l, margin: _m, ...redacted } = BASE_PROPS;
    void _s; void _l; void _m;
    const { container } = render(<FinancialSummary {...redacted} subHireCostTotal={200} />);
    expect(container.textContent).not.toMatch(/Margin/);
    expect(screen.queryByText("Costs")).toBeNull();
    expect(screen.queryByText("Total costs")).toBeNull();
    expect(screen.queryByText("No costs recorded")).toBeNull();
    expect(screen.getByText("Equipment")).toBeTruthy(); // revenue stays
    expect(screen.getByText("$1,100.00")).toBeTruthy(); // the total stays
  });

  it("the RECONSTRUCTED shape (mapProject turns an absent field into null) prints no margin, never $0.00", () => {
    // A project doc as a read without job cost returns it: the job-cost totals and margin left out.
    const p = mapProject(RECONSTRUCTED_DOC as unknown as Parameters<typeof mapProject>[0]);
    expect(p.margin).toBeNull(); // the trap: absent became null
    const { container } = renderMapped(p);
    expect(container.textContent).not.toMatch(/Margin/);
    expect(container.textContent).not.toMatch(/Costs|No costs recorded/);
  });

  it("the RECONSTRUCTED shape a member with invoice:read gets (job cost present) prints the margin and the costs", () => {
    // The owner ruling 2026-11-24: projectDetail.bundle sends a member the job-level totals.
    const p = mapProject({ ...RECONSTRUCTED_DOC, serviceCostTotal: 650, labourCostTotal: 300, margin: 4050 } as unknown as Parameters<typeof mapProject>[0]);
    const { container } = renderMapped(p);
    expect(container.textContent).toMatch(/Margin: \$4,050\.00/);
    expect(screen.getByText("Labour")).toBeTruthy();
    expect(screen.getByText("Services")).toBeTruthy();
  });

  it("with job cost visible the margin and costs render", () => {
    render(<FinancialSummary {...BASE_PROPS} labourCostTotal={300} />);
    expect(screen.getByText(/Margin:/)).toBeTruthy();
    expect(screen.getByText("Labour")).toBeTruthy();
  });

  it("renders a 'Sale items' revenue row and a 'Sale cost of goods' cost row", () => {
    render(<FinancialSummary {...BASE_PROPS} saleRevenue={250} saleCostTotal={90} />);
    expect(screen.getByText("Sale items")).toBeTruthy();
    expect(screen.getByText("$250.00")).toBeTruthy();
    expect(screen.getByText("Sale cost of goods")).toBeTruthy();
    // $90 is also the (only) "Total costs" figure — assert at least one, not uniqueness.
    expect(screen.getAllByText("$90.00").length).toBeGreaterThan(0);
  });

  it("folds maintenance into the Costs column and its total (one margin, ex GST)", () => {
    const { container } = render(
      <FinancialSummary {...BASE_PROPS} serviceCostTotal={100} maintenance={{ total: 60, count: 2, href: "/maintenance?projectId=p1", labourRevenue: 0 }} />,
    );
    expect(screen.getByText("Maintenance (2)")).toBeTruthy();
    expect(screen.getByRole("link", { name: /Maintenance records/ }).getAttribute("href")).toBe("/maintenance?projectId=p1");
    expect(screen.getByText("Total costs").nextSibling?.textContent).toBe("$160.00");
    expect(container.textContent).toMatch(/Margin: \$400\.00 ex GST/);
  });

  it("never shows maintenance without job cost, even when it is passed", () => {
    const { container } = render(
      <FinancialSummary {...BASE_PROPS} serviceCostTotal={undefined} labourCostTotal={undefined} margin={null} maintenance={{ total: 60, count: 2, href: "/m", labourRevenue: 5 }} />,
    );
    expect(container.textContent).not.toMatch(/Maintenance|Costs|Margin/);
  });

  it("opens Show group pricing", async () => {
    const user = (await import("@testing-library/user-event")).default.setup();
    render(<FinancialSummary {...BASE_PROPS} groupBreakdown={[{ title: "FOH package", quantity: 1, price: 500 }]} />);
    expect(screen.queryByText("FOH package")).toBeNull();
    await user.click(screen.getByRole("button", { name: /Show group pricing/ }));
    expect(screen.getByText("FOH package")).toBeTruthy();
  });
});
