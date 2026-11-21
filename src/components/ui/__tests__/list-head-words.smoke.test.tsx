// @vitest-environment jsdom
import React from "react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";

import { ListHead, type HeadWords } from "@/components/ui/list-page-parts";

/**
 * UX Phase 15 (Q-I2): the additive `headWords` prop on ListHead / ListPage —
 * page-level view words (`Planner  Timesheets`), each a link to its own route.
 * Rendered for real: desktop puts them in the head row, phone on their own row.
 */
const mobile = vi.hoisted(() => ({ value: false }));
vi.mock("@/hooks/use-mobile", () => ({ useIsMobile: () => mobile.value }));

const words: HeadWords = {
  value: "timesheets",
  words: [
    { key: "planner", label: "Planner", href: "/crew/planner" },
    { key: "timesheets", label: "Timesheets", href: "/crew/timesheets" },
  ],
};

afterEach(() => {
  cleanup();
  mobile.value = false;
});

describe("ListHead headWords", () => {
  it("renders each word as a link to its route, the current one marked", () => {
    render(<ListHead title="Crew" headWords={words} primary={{ label: "Log time", onSelect: vi.fn() }} />);
    const nav = screen.getByRole("navigation", { name: "Views" });
    const planner = within(nav).getByRole("link", { name: "Planner" });
    const timesheets = within(nav).getByRole("link", { name: "Timesheets" });
    expect(planner.getAttribute("href")).toBe("/crew/planner");
    expect(timesheets.getAttribute("href")).toBe("/crew/timesheets");
    expect(timesheets.getAttribute("aria-current")).toBe("page");
    expect(planner.getAttribute("aria-current")).toBeNull();
    // Desktop: the words share the head row with the primary.
    expect(screen.getByRole("button", { name: "Log time" })).toBeTruthy();
  });

  it("on a phone the words get their own 44px row and the primary leaves the head", () => {
    mobile.value = true;
    render(<ListHead title="Crew" headWords={words} primary={{ label: "Log time", onSelect: vi.fn() }} />);
    const link = screen.getByRole("link", { name: "Planner" });
    expect(link.className).toContain("min-h-11");
    expect(screen.queryByRole("button", { name: "Log time" })).toBeNull();
  });

  it("is absent when no words are passed (every other list is unchanged)", () => {
    render(<ListHead title="Jobs" />);
    expect(screen.queryByRole("navigation", { name: "Views" })).toBeNull();
  });
});
