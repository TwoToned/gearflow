// @vitest-environment jsdom
import React from "react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

import { ListHead } from "@/components/ui/list-page-parts";
import type { ActionMenuSpec } from "@/lib/primitives/types";

/**
 * UX Phase 13 (C9): the additive `subline` and `titleMenu` props on ListHead. On a
 * phone the title opens the People switcher (a bottom sheet); on desktop it stays a
 * plain heading. Absent props change nothing for every other list.
 */
const mobile = vi.hoisted(() => ({ value: false }));
vi.mock("@/hooks/use-mobile", () => ({ useIsMobile: () => mobile.value }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

const select = vi.fn();
const menu: ActionMenuSpec = {
  items: [
    { key: "clients", label: "Clients", group: "organise", onSelect: select },
    { key: "suppliers", label: "Suppliers", group: "organise", onSelect: select },
  ],
};

afterEach(() => {
  cleanup();
  mobile.value = false;
  select.mockClear();
});

describe("ListHead subline and titleMenu", () => {
  it("prints the sub line under the title", () => {
    render(<ListHead title="Clients" subline="10 with open jobs" />);
    expect(screen.getByText("10 with open jobs")).toBeTruthy();
  });

  it("desktop keeps a plain title (no switcher button)", () => {
    render(<ListHead title="Crew" titleMenu={menu} />);
    expect(screen.queryByRole("button", { name: /Switch from Crew/ })).toBeNull();
    expect(screen.getByRole("heading", { name: "Crew" })).toBeTruthy();
  });

  it("phone: tapping the title OPENS the People sheet and an item selects", () => {
    mobile.value = true;
    render(<ListHead title="Crew" titleMenu={menu} />);
    fireEvent.click(screen.getByRole("button", { name: "Crew" }));
    fireEvent.click(screen.getByText("Suppliers"));
    expect(select).toHaveBeenCalled();
  });

  it("no props, no change", () => {
    render(<ListHead title="Jobs" />);
    expect(screen.getByRole("heading", { name: "Jobs" })).toBeTruthy();
  });
});
