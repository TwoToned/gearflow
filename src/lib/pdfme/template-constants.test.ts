import { describe, it, expect } from "vitest";
import {
  getPageGeometry,
  PAGE_WIDTH,
  PAGE_HEIGHT,
  MARGIN,
  CONTENT_WIDTH,
  PAGE_CONTENT_HEIGHT,
  FOOTER_HEIGHT,
} from "./template-constants";

describe("getPageGeometry — I5 (#1084)", () => {
  it("A4 (the default, and the explicit case) is byte-identical to the bare module constants", () => {
    for (const geometry of [getPageGeometry(), getPageGeometry("A4")]) {
      expect(geometry.width).toBe(PAGE_WIDTH);
      expect(geometry.height).toBe(PAGE_HEIGHT);
      expect(geometry.margin).toBe(MARGIN);
      expect(geometry.contentWidth).toBe(CONTENT_WIDTH);
      expect(geometry.contentHeight).toBe(PAGE_CONTENT_HEIGHT);
      expect(geometry.footerHeight).toBe(FOOTER_HEIGHT);
    }
  });

  it("LETTER is 216 × 279mm — wider AND shorter than A4", () => {
    const letter = getPageGeometry("LETTER");
    expect(letter.width).toBe(216);
    expect(letter.height).toBe(279);
    expect(letter.width).toBeGreaterThan(PAGE_WIDTH);
    expect(letter.height).toBeLessThan(PAGE_HEIGHT);
  });

  it("LETTER's content area is wider AND shorter than A4's — both matter for pagination", () => {
    const a4 = getPageGeometry("A4");
    const letter = getPageGeometry("LETTER");
    expect(letter.contentWidth).toBeGreaterThan(a4.contentWidth);
    expect(letter.contentHeight).toBeLessThan(a4.contentHeight);
  });

  it("margin and footer height are fixed layout choices, unchanged by paper size", () => {
    const a4 = getPageGeometry("A4");
    const letter = getPageGeometry("LETTER");
    expect(letter.margin).toBe(a4.margin);
    expect(letter.footerHeight).toBe(a4.footerHeight);
  });

  it("contentWidth/contentHeight are always derived from width/height/margin/footerHeight, for any paper size", () => {
    for (const size of ["A4", "LETTER"] as const) {
      const g = getPageGeometry(size);
      expect(g.contentWidth).toBe(g.width - g.margin * 2);
      expect(g.contentHeight).toBe(g.height - g.margin * 2 - g.footerHeight);
    }
  });
});
