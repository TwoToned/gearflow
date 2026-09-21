// @vitest-environment jsdom
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

/**
 * Regression for the mobile "rubber banding" bug: tapping a bottom-nav tab, then
 * immediately tapping a DIFFERENT tab before the first navigation lands, could
 * fire two overlapping router.push calls. Next.js App Router doesn't guarantee
 * ordering between two in-flight soft navigations (vercel/next.js#83386) — the
 * slower first one can resolve after the second and snap the user back to it.
 * MobileNav's single-flight guard should drop the second tap while the first is
 * still pending, and accept new taps again once the pathname lands.
 */

const push = vi.fn();
let currentPathname = "/dashboard";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
  usePathname: () => currentPathname,
}));

import { MobileNav } from "@/components/layout/mobile-nav";

beforeEach(() => {
  push.mockClear();
  currentPathname = "/dashboard";
});

describe("MobileNav", () => {
  it("ignores a second tab tap while the first navigation is still in flight", () => {
    const { rerender } = render(<MobileNav />);

    fireEvent.click(screen.getByText("Jobs"));
    fireEvent.click(screen.getByText("Warehouse"));

    expect(push).toHaveBeenCalledTimes(1);
    expect(push).toHaveBeenCalledWith("/projects");

    // Simulate the first navigation landing.
    currentPathname = "/projects";
    rerender(<MobileNav />);

    fireEvent.click(screen.getByText("Warehouse"));
    expect(push).toHaveBeenCalledTimes(2);
    expect(push).toHaveBeenLastCalledWith("/warehouse");
  });

  it("does not navigate when tapping the already-active tab", () => {
    render(<MobileNav />);
    fireEvent.click(screen.getByText("Dashboard"));
    expect(push).not.toHaveBeenCalled();
  });
});
