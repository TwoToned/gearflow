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

  it("scopes the frozen/scroll treatment to mobile so desktop stays a plain table", () => {
    const { container } = renderTable({ frozenColWidths: [40, 180] });
    const style = container.querySelector("style")!.innerHTML;
    // The sticky/min-width rules live inside a max-width media query; base rules don't.
    const mobile = style.slice(
      style.indexOf("@media (max-width:767px)"),
      style.indexOf("@media print"),
    );
    expect(style).toContain("@media (max-width:767px)");
    expect(mobile).toContain("position:sticky");
    expect(mobile).toContain("min-width:560px");
  });

  it("resets cell min-width/white-space (not just table width) for print", () => {
    const { container } = renderTable({ frozenColWidths: [40, 180] });
    const style = container.querySelector("style")!.innerHTML;
    const printBlock = style.slice(style.indexOf("@media print"));
    expect(printBlock).toContain("min-width:0!important");
    expect(printBlock).toContain("white-space:normal!important");
    expect(printBlock).toContain("vertical-align:initial!important");
  });

  it("sanitizes frozenBg so it can't break out of the <style> element", () => {
    const { container } = renderTable({
      frozenBg: "red}</style><script>alert(1)</script>",
    });
    const style = container.querySelector("style")!.innerHTML;
    expect(style).not.toContain("<script>");
    expect(style).not.toContain("</style>");
    // Falls back to the safe default.
    expect(style).toContain("--stkt-bg:var(--paper)");
  });

  it("skips full-width colSpan header rows when freezing columns positionally", () => {
    const { container } = render(
      <StickyTable frozenColWidths={[40, 200]} minTableWidth={720}>
        <table>
          <tbody>
            <tr>
              {/* colSpan category header — must NOT be pinned as the identity column */}
              <td colSpan={4}>Wireless microphones</td>
            </tr>
            <tr>
              <td>reorder</td>
              <td>Shure SLXD 6 Channel Kit</td>
              <td>1</td>
              <td>actions</td>
            </tr>
          </tbody>
        </table>
      </StickyTable>,
    );
    const style = container.querySelector("style")!.innerHTML;
    // The freeze selectors exclude colSpan cells, so a full-width header row scrolls.
    expect(style).toContain(":nth-child(1):not([colspan])");
    expect(style).toContain(":nth-child(2):not([colspan])");
  });

  it("shows a scroll affordance (edge fade + column-count hint), both print-hidden", () => {
    const { container } = renderTable();
    const fade = container.querySelector('[aria-hidden].print\\:hidden');
    expect(fade).toBeTruthy();
    expect(screen.getByText(/↔ 5 cols/)).toBeTruthy();
  });
});
