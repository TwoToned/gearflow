// @vitest-environment jsdom
import React from "react";
import { describe, it, expect, vi, beforeAll } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

beforeAll(() => {
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.setPointerCapture ??= () => {};
  Element.prototype.releasePointerCapture ??= () => {};
  Element.prototype.scrollIntoView ??= () => {};
});

vi.mock("@/hooks/use-billing-summary", () => ({
  useBillingOverride: vi.fn(() => ({ setOverride: vi.fn(), clearOverride: vi.fn() })),
  useProjectPricingStaleness: vi.fn(() => 0),
  useRecalcAutoPricedLines: vi.fn(() => ({ recalc: vi.fn() })),
}));

import { BillingSummaryRow } from "@/components/projects/billing-summary-row";
import { StalePricingBanner } from "@/components/projects/stale-pricing-banner";
import * as useBillingSummaryModule from "@/hooks/use-billing-summary";

/**
 * #943 — BillingSummaryRow renders a Radix `Dialog` (billing-period edit).
 * Per CLAUDE.md's overlay-composition note, new overlay UI needs a jsdom
 * smoke test that actually RENDERS + OPENS it, not just a closed-trigger
 * render — typecheck/lint/build all pass on a broken composition (e.g. the
 * Tooltip-without-provider class of bug); only opening the overlay catches it.
 */
describe("BillingSummaryRow smoke", () => {
  it("renders the derived summary (no override) with no 'edited' marker", () => {
    render(
      <BillingSummaryRow
        projectId="p1"
        orgId="org1"
        rentalStartDate={new Date(0)}
        rentalEndDate={new Date(6 * 86_400_000)} // 7 inclusive days -> 1 wk 0 d
        billingWeeksOverride={null}
        billingDaysOverride={null}
      />,
    );
    expect(screen.getByText("1 wk 0 d")).toBeTruthy();
    expect(screen.queryByText("edited")).toBeNull();
  });

  it("shows the 'edited' marker when an override is set", () => {
    render(
      <BillingSummaryRow
        projectId="p1"
        orgId="org1"
        rentalStartDate={null}
        rentalEndDate={null}
        billingWeeksOverride={3}
        billingDaysOverride={2}
      />,
    );
    expect(screen.getByText("3 wk 2 d")).toBeTruthy();
    expect(screen.getByText("edited")).toBeTruthy();
  });

  it("opens the edit dialog without throwing and shows both inputs", async () => {
    render(
      <BillingSummaryRow
        projectId="p1"
        orgId="org1"
        rentalStartDate={null}
        rentalEndDate={null}
        billingWeeksOverride={null}
        billingDaysOverride={null}
      />,
    );
    fireEvent.click(screen.getByLabelText("Edit billing period"));
    await waitFor(() => expect(screen.getByText("Billing period")).toBeTruthy());
    expect(screen.getByLabelText("Weeks")).toBeTruthy();
    expect(screen.getByLabelText("Days")).toBeTruthy();
    // No "Reset to derived" button when there's nothing to reset.
    expect(screen.queryByText("Reset to derived")).toBeNull();
  });

  it("shows 'Reset to derived' in the dialog when an override is active", async () => {
    render(
      <BillingSummaryRow
        projectId="p1"
        orgId="org1"
        rentalStartDate={null}
        rentalEndDate={null}
        billingWeeksOverride={1}
        billingDaysOverride={0}
      />,
    );
    fireEvent.click(screen.getByLabelText("Edit billing period"));
    await waitFor(() => expect(screen.getByText("Reset to derived")).toBeTruthy());
  });
});

describe("StalePricingBanner smoke", () => {
  it("renders nothing when nothing is stale", () => {
    const { container } = render(<StalePricingBanner projectId="p1" orgId="org1" />);
    expect(container.firstChild).toBeNull();
  });

  it("renders the banner + Recalculate button when lines are stale", () => {
    vi.mocked(useBillingSummaryModule.useProjectPricingStaleness).mockReturnValueOnce(2);
    render(<StalePricingBanner projectId="p1" orgId="org1" />);
    expect(screen.getByText(/2 line items need recalculating/)).toBeTruthy();
    expect(screen.getByRole("button", { name: /recalculate/i })).toBeTruthy();
  });
});
