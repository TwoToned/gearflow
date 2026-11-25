// @vitest-environment jsdom
import React from "react";
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { AvailabilityLine, type Overlap } from "../new-job/availability-line";

const job = (n: string) => ({ id: n, number: n, status: "CONFIRMED", start: 0, end: 1, hard: true });
const overlap = (n: number, truncated = false): Overlap => ({ total: n, truncated, jobs: Array.from({ length: n }, (_, i) => job(`#${i}`)) });

describe("AvailabilityLine", () => {
  it("without dates it says availability was not checked", () => {
    render(<AvailabilityLine hasDates={false} others={null} shortLines={0} lineCount={0} />);
    expect(screen.getByText(/Availability not checked/)).toBeTruthy();
  });

  it("names the other jobs in the dates, and that gear is not checked until there are lines", () => {
    render(<AvailabilityLine hasDates others={overlap(2)} shortLines={0} lineCount={0} />);
    expect(screen.getByText(/2 other jobs in these dates #0 #1/)).toBeTruthy();
    expect(screen.getByText("Gear not checked yet")).toBeTruthy();
  });

  it("says short lines and all-free in words", () => {
    const { rerender } = render(<AvailabilityLine hasDates others={overlap(0)} shortLines={2} lineCount={7} />);
    expect(screen.getByText("No other jobs in these dates")).toBeTruthy();
    expect(screen.getByText("2 lines short")).toBeTruthy();
    rerender(<AvailabilityLine hasDates others={overlap(0)} shortLines={0} lineCount={7} />);
    expect(screen.getByText("All 7 lines free")).toBeTruthy();
  });

  it("a capped read says 50+, never a false exact count", () => {
    render(<AvailabilityLine hasDates others={overlap(50, true)} shortLines={0} lineCount={0} />);
    expect(screen.getByText(/50\+ other jobs/)).toBeTruthy();
  });
});
