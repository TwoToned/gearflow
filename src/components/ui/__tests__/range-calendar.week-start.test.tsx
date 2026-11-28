// @vitest-environment jsdom
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render } from "@testing-library/react";

const weekStart = vi.hoisted(() => ({ value: 1 as 0 | 1 }));
vi.mock("@/lib/use-org-country", () => ({
  useOrgWeekStartsOn: () => weekStart.value,
  useOrgCountry: () => undefined,
}));

import { RangeCalendar } from "../range-calendar";

// December 2026: the 1st is a Tuesday.
const value = { start: new Date(2026, 11, 10), end: undefined };

function headerAndFirstCell(container: HTMLElement) {
  const grid = container.querySelector(".grid-cols-7")!;
  const cells = Array.from(grid.children);
  return { headers: cells.slice(0, 7).map((c) => c.textContent), firstDay: cells[7].textContent };
}

describe("RangeCalendar week start (I6)", () => {
  beforeEach(() => {
    weekStart.value = 1;
  });

  it("is Monday-first for a Monday-start org, with the grid beginning on 30 Nov", () => {
    const { headers, firstDay } = headerAndFirstCell(render(<RangeCalendar value={value} onChange={() => {}} />).container);
    expect(headers[0]).toBe("Mo");
    expect(headers[6]).toBe("Su");
    expect(firstDay).toContain("30");
  });

  it("is Sunday-first for a Sunday-start org, with the grid beginning on 29 Nov", () => {
    weekStart.value = 0;
    const { headers, firstDay } = headerAndFirstCell(render(<RangeCalendar value={value} onChange={() => {}} />).container);
    expect(headers[0]).toBe("Su");
    expect(headers[6]).toBe("Sa");
    expect(firstDay).toContain("29");
  });
});
