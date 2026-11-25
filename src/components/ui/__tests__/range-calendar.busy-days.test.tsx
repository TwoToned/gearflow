// @vitest-environment jsdom
import React from "react";
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { RangeCalendar } from "../range-calendar";

describe("RangeCalendar busyDays", () => {
  const value = { start: new Date(2026, 11, 10), end: undefined };

  it("draws a dot, titled with the jobs, only under the busy days", () => {
    const { container } = render(
      <RangeCalendar value={value} onChange={() => {}} busyDays={new Map([["2026-12-12", "#2350, #2351"]])} />,
    );
    const dots = container.querySelectorAll("[data-busy-dot]");
    expect(dots).toHaveLength(1);
    expect(dots[0].getAttribute("aria-label")).toBe("#2350, #2351");
    expect(dots[0].closest("button")?.getAttribute("title")).toBe("#2350, #2351");
  });

  it("draws nothing without the prop (every existing caller)", () => {
    const { container } = render(<RangeCalendar value={value} onChange={() => {}} />);
    expect(container.querySelectorAll("[data-busy-dot]")).toHaveLength(0);
  });
});
