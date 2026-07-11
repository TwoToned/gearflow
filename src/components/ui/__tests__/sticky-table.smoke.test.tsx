// @vitest-environment jsdom
import React from "react";
import { describe, it, expect } from "vitest";
import { render, screen, within } from "@testing-library/react";

import { StickyTable } from "@/components/ui/sticky-table";

function renderTable(props: Partial<React.ComponentProps<typeof StickyTable>> = {}) {
  return render(
    <StickyTable minTableWidth={560} colCountHint={5} {...props}>
      <table>
        <thead>
          <tr>
            <th>Item</th>
            <th>Qty</th>
            <th>Location</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Shure SLXD 6 Channel Kit</td>
            <td>1</td>
            <td>Rack B3</td>
          </tr>
        </tbody>
      </table>
    </StickyTable>,
  );
}

describe("StickyTable", () => {
  it("renders the table inside its own single scroll container (not nested)", () => {
    const { container } = renderTable();
    const scrollers = container.querySelectorAll(".stkt-scroll");
    expect(scrollers).toHaveLength(1);
    // The table is a direct child of the scroller — no inner overflow wrapper.
    expect(scrollers[0].querySelector(":scope > table")).toBeTruthy();
  });

  it("keeps the real table semantics (screen readers still see a table)", () => {
    renderTable();
    const table = screen.getByRole("table");
    expect(within(table).getByText("Shure SLXD 6 Channel Kit")).toBeTruthy();
  });

  it("emits scoped CSS that freezes the first column and resets it for print", () => {
    const { container } = renderTable({ frozenColWidths: [40, 180] });
    const style = container.querySelector("style")!.innerHTML;
    // Two frozen columns with cumulative left offsets (0, then 40).
    expect(style).toContain("left:0px");
    expect(style).toContain("left:40px");
    expect(style).toContain("position:sticky");
    // Min table width forces horizontal scroll.
    expect(style).toContain("min-width:560px");
    // Wrapping rows grow downward, never overlap.
    expect(style).toContain("vertical-align:top");
    // Print undoes sticky + scroll + min-width so the physical sheet is unchanged.
    expect(style).toContain("@media print");
    expect(style).toContain("position:static!important");
    expect(style).toContain("overflow:visible!important");
  });

  it("shows a scroll affordance (edge fade + column-count hint), both print-hidden", () => {
    const { container } = renderTable();
    const fade = container.querySelector('[aria-hidden].print\\:hidden');
    expect(fade).toBeTruthy();
    expect(screen.getByText(/↔ 5 cols/)).toBeTruthy();
  });
});
