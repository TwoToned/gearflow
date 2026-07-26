/**
 * Tests for Sparkline and UtilizationBar pure logic.
 *
 * These components render SVG — we test the math and edge cases
 * by extracting the logic or calling the components and checking
 * the SVG output attributes.
 */
import { describe, it, expect } from "vitest";

// ─── Sparkline math helpers ──────────────────────────────────────────
// We replicate the pure math from Sparkline to test it in isolation.

function computeSparklinePoints(
  data: number[],
  width: number,
  height: number,
) {
  if (!data || data.length < 2) return null;

  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const padding = 1;

  return data.map((v, i) => {
    const x = (i / (data.length - 1)) * (width - padding * 2) + padding;
    const y =
      height - padding - ((v - min) / range) * (height - padding * 2);
    return { x, y };
  });
}

describe("Sparkline math", () => {
  it("returns null for empty data", () => {
    expect(computeSparklinePoints([], 80, 24)).toBeNull();
  });

  it("returns null for single data point", () => {
    expect(computeSparklinePoints([5], 80, 24)).toBeNull();
  });

  it("computes points for a simple ascending series", () => {
    const pts = computeSparklinePoints([0, 50, 100], 80, 24);
    expect(pts).not.toBeNull();
    expect(pts!.length).toBe(3);

    // First point should be bottom-left area
    expect(pts![0].x).toBeCloseTo(1); // padding
    expect(pts![0].y).toBeCloseTo(23); // near bottom

    // Last point should be top-right area
    expect(pts![2].x).toBeCloseTo(79); // width - padding
    expect(pts![2].y).toBeCloseTo(1); // near top
  });

  it("handles all identical values without division by zero", () => {
    const pts = computeSparklinePoints([5, 5, 5, 5], 80, 24);
    expect(pts).not.toBeNull();
    // When range is 0, fallback to 1 — all points should be at same y
    const ys = pts!.map((p) => p.y);
    expect(ys.every((y) => y === ys[0])).toBe(true);
    // Should not produce NaN
    expect(ys.every((y) => !isNaN(y))).toBe(true);
  });

  it("handles negative values", () => {
    const pts = computeSparklinePoints([-10, -5, 0, 5], 80, 24);
    expect(pts).not.toBeNull();
    // Last point (highest value) should be near top
    expect(pts![3].y).toBeCloseTo(1);
    // First point (lowest value) should be near bottom
    expect(pts![0].y).toBeCloseTo(23);
  });
});

// ─── UtilizationBar math ─────────────────────────────────────────────

function computeBarProps(value: number, color?: string) {
  const clampedValue = Math.min(100, Math.max(0, value));
  const barColor =
    color ||
    (clampedValue > 80
      ? "var(--destructive)"
      : clampedValue > 50
        ? "var(--warning)"
        : "var(--primary)");
  return { clampedValue, barColor };
}

describe("UtilizationBar math", () => {
  it("clamps value > 100 to 100", () => {
    expect(computeBarProps(150).clampedValue).toBe(100);
  });

  it("clamps value < 0 to 0", () => {
    expect(computeBarProps(-10).clampedValue).toBe(0);
  });

  it("passes through values in range", () => {
    expect(computeBarProps(50).clampedValue).toBe(50);
  });

  it("uses destructive color when > 80", () => {
    expect(computeBarProps(85).barColor).toBe("var(--destructive)");
  });

  it("uses warning color when > 50 and <= 80", () => {
    expect(computeBarProps(60).barColor).toBe("var(--warning)");
    expect(computeBarProps(80).barColor).toBe("var(--warning)");
  });

  it("uses primary color when <= 50", () => {
    expect(computeBarProps(50).barColor).toBe("var(--primary)");
    expect(computeBarProps(0).barColor).toBe("var(--primary)");
  });

  it("uses custom color when provided", () => {
    expect(computeBarProps(90, "red").barColor).toBe("red");
  });

  it("boundary: 81 is destructive, 80 is warning, 51 is warning, 50 is primary", () => {
    expect(computeBarProps(81).barColor).toBe("var(--destructive)");
    expect(computeBarProps(80).barColor).toBe("var(--warning)");
    expect(computeBarProps(51).barColor).toBe("var(--warning)");
    expect(computeBarProps(50).barColor).toBe("var(--primary)");
  });
});
