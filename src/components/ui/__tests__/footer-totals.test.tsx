// @vitest-environment jsdom
import React from "react";
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { FooterTotals } from "@/components/ui/footer-totals";

describe("FooterTotals", () => {
  it("renders caller-derived lines, a blank amount is a dash not $0", () => {
    render(
      <FooterTotals
        lines={[
          { label: "Subtotal", amount: 1200 },
          { label: "Unpriced", amount: null, note: "2 lines" },
          { label: "Total", amount: 1320, note: "incl. GST" },
        ]}
      />,
    );
    expect(screen.getByText("$1,200.00")).toBeTruthy();
    expect(screen.getByText("—")).toBeTruthy();
    expect(screen.queryByText("$0.00")).toBeNull();
    expect(screen.getByText("incl. GST")).toBeTruthy();
  });
  it("renders nothing without lines", () => {
    const { container } = render(<FooterTotals lines={[]} />);
    expect(container.firstChild).toBeNull();
  });
});
