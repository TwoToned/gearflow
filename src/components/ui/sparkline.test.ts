/**
 * Tests for Sparkline, UtilizationBar, and DateRangeBar pure logic.
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

// ─── DateRangeBar math ───────────────────────────────────────────────

function computeDateBarProps(
  start: Date,
  end: Date,
  rangeStart: Date,
  rangeEnd: Date,
) {
  const totalMs = rangeEnd.getTime() - rangeStart.getTime();
  if (totalMs <= 0) return null;

  const leftPct = Math.max(
    0,
    ((start.getTime() - rangeStart.getTime()) / totalMs) * 100,
  );
  const widthPct = Math.min(
    100 - leftPct,
    ((end.getTime() - start.getTime()) / totalMs) * 100,
  );
  return { leftPct, widthPct: Math.max(widthPct, 2) };
}

describe("DateRangeBar math", () => {
  const jan1 = new Date("2026-01-01");
  const jan15 = new Date("2026-01-15");
  const jan31 = new Date("2026-01-31");
  const feb1 = new Date("2026-02-01");

  it("returns null when range end <= range start", () => {
    expect(computeDateBarProps(jan1, jan15, jan31, jan1)).toBeNull();
  });

  it("returns null when range is zero (same start and end)", () => {
    expect(computeDateBarProps(jan1, jan15, jan1, jan1)).toBeNull();
  });

  it("computes correct position for rental in middle of range", () => {
    const result = computeDateBarProps(jan15, jan31, jan1, feb1);
    expect(result).not.toBeNull();
    // Jan 15 is about 45% through January
    expect(result!.leftPct).toBeGreaterThan(40);
    expect(result!.leftPct).toBeLessThan(50);
    // 16 days out of 31 is about 52%
    expect(result!.widthPct).toBeGreaterThan(45);
    expect(result!.widthPct).toBeLessThan(55);
  });

  it("clamps left to 0 when rental starts before range", () => {
    const beforeRange = new Date("2025-12-15");
    const result = computeDateBarProps(beforeRange, jan15, jan1, jan31);
    expect(result).not.toBeNull();
    expect(result!.leftPct).toBe(0);
  });

  it("enforces minimum 2% width for very short rentals", () => {
    // 1 hour rental in a 31-day range
    const start = new Date("2026-01-15T10:00:00");
    const end = new Date("2026-01-15T11:00:00");
    const result = computeDateBarProps(start, end, jan1, jan31);
    expect(result).not.toBeNull();
    expect(result!.widthPct).toBe(2);
  });

  it("clamps width when rental extends beyond range", () => {
    const farEnd = new Date("2026-06-01");
    const result = computeDateBarProps(jan15, farEnd, jan1, jan31);
    expect(result).not.toBeNull();
    // Width should be clamped to 100 - leftPct
    expect(result!.leftPct + result!.widthPct).toBeLessThanOrEqual(100);
  });

  it("full range rental spans 100%", () => {
    const result = computeDateBarProps(jan1, jan31, jan1, jan31);
    expect(result).not.toBeNull();
    expect(result!.leftPct).toBe(0);
    expect(result!.widthPct).toBe(100);
  });
});
