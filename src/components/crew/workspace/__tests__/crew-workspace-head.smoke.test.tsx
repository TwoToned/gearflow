// @vitest-environment jsdom
//
// The Crew head on the planner (UX Phase 15, slice 2): `Crew` with the
// Planner · Timesheets words, and a page ⋯ (OPENED) whose Crew roles & rates…
// writes `?sheet=roles` (the same URL /crew/settings redirects to).
import React from "react";
import { describe, it, expect, vi, beforeAll } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

beforeAll(() => {
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.setPointerCapture ??= () => {};
  Element.prototype.releasePointerCapture ??= () => {};
  Element.prototype.scrollIntoView ??= () => {};
});

const nav = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: nav.push, replace: nav.replace }),
  usePathname: () => "/crew/planner",
  useSearchParams: () => new URLSearchParams("week=1700000000000"),
}));
vi.mock("@/hooks/use-mobile", () => ({ useIsMobile: () => false }));
vi.mock("@/components/crew/workspace/roles/crew-roles-sheet", () => ({
  CrewRolesSheet: ({ open }: { open: boolean }) => (open ? <div>ROLES SHEET</div> : null),
}));

import { CrewWorkspaceHead } from "../crew-workspace";

describe("CrewWorkspaceHead (planner)", () => {
  it("marks Planner current and links Timesheets", () => {
    render(<CrewWorkspaceHead view="planner" />);
    expect(screen.getByRole("heading", { name: "Crew" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Planner" }).getAttribute("aria-current")).toBe("page");
    expect(screen.getByRole("link", { name: "Timesheets" }).getAttribute("href")).toBe("/crew/timesheets");
  });

  it("page ⋯ › Crew roles & rates… adds ?sheet=roles and keeps the other params; Crew list goes to /crew", async () => {
    const user = userEvent.setup();
    render(<CrewWorkspaceHead view="planner" />);
    await user.click(screen.getByRole("button", { name: "Crew options" }));
    await user.click(await screen.findByRole("menuitem", { name: /Crew roles & rates…/ }));
    expect(nav.replace).toHaveBeenCalledWith("/crew/planner?week=1700000000000&sheet=roles", { scroll: false });
    await user.click(screen.getByRole("button", { name: "Crew options" }));
    await user.click(await screen.findByRole("menuitem", { name: /Crew list/ }));
    expect(nav.push).toHaveBeenCalledWith("/crew");
  });
});
