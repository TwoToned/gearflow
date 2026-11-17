// @vitest-environment jsdom
import React from "react";
import { describe, it, expect, vi, beforeEach, beforeAll } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { TooltipProvider } from "@/components/ui/tooltip";

/**
 * D67 — the tablet icon rail. The rail/full swap is CSS (so SSR first paint is
 * right), which jsdom cannot evaluate, so this pins the class contract plus the
 * runtime pieces jsdom CAN check: the manual ⌘B collapse (a no-op <= 1023px)
 * and the rail's flyout menus, which carry every sub-page.
 */

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
  usePathname: () => "/assets/registry",
}));
vi.mock("@/lib/use-permissions", () => ({
  useCurrentRole: () => ({ permissions: null, isLoading: true }),
}));
vi.mock("@/components/layout/user-nav", () => ({
  UserNav: ({ compact }: { compact?: boolean }) => <div data-testid={compact ? "user-compact" : "user-full"} />,
}));

let tablet = false;
beforeAll(() => {
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.setPointerCapture ??= () => {};
  Element.prototype.releasePointerCapture ??= () => {};
  Element.prototype.scrollIntoView ??= () => {};
  window.matchMedia = ((q: string) => ({
    matches: q.includes("1023") ? tablet : false,
    media: q,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
  window.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
});

import { SidebarProvider } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/layout/app-sidebar";

const renderShell = () =>
  render(
    <TooltipProvider>
      <SidebarProvider>
        <AppSidebar />
      </SidebarProvider>
    </TooltipProvider>,
  );

const wrapperState = () => document.querySelector('[data-slot="sidebar"]')!.getAttribute("data-state");

beforeEach(() => {
  tablet = false;
  document.cookie = "sidebar_state=; max-age=0; path=/";
});

describe("AppSidebar tablet rail (D67)", () => {
  it("renders the full view and the rail view; CSS picks one at the 1023/1024 boundary", () => {
    renderShell();
    const full = document.querySelector('[data-sidebar-view="full"]')!;
    const rail = document.querySelector('[data-sidebar-view="rail"]')!;
    // <= 1023px (max-lg): full hides, rail shows. >= 1024px: the reverse (rail only when manually collapsed).
    expect(full.className).toContain("max-lg:hidden");
    expect(rail.className).toContain("max-lg:flex");
    expect(rail.className).toContain("hidden");
    expect(full.className).toContain("group-data-[collapsible=icon]:hidden");
  });

  it("forces the 72px width at <= 1023px in CSS, from the same lg breakpoint", () => {
    const css = readFileSync(join(__dirname, "../../../app/globals.css"), "utf8");
    expect(css).toMatch(/@media \(width < theme\(--breakpoint-lg\)\)\s*\{[^}]*--sidebar-width:\s*var\(--sidebar-width-icon\)\s*!important/);
  });

  it("uses the module vocabulary: Home, Jobs, Schedule", () => {
    renderShell();
    for (const label of ["Home", "Jobs", "Schedule"]) {
      expect(screen.getAllByText(label).length).toBeGreaterThan(0);
    }
    expect(screen.queryByText("Dashboard")).toBeNull();
    expect(screen.queryByText("Projects")).toBeNull();
  });

  it("⌘B collapses at >= 1024px and is remembered; it does nothing at <= 1023px", () => {
    renderShell();
    expect(wrapperState()).toBe("expanded");
    fireEvent.keyDown(window, { key: "b", metaKey: true });
    expect(wrapperState()).toBe("collapsed");
    expect(document.cookie).toContain("sidebar_state=false");
    fireEvent.keyDown(window, { key: "b", metaKey: true });
    expect(wrapperState()).toBe("expanded");

    tablet = true;
    fireEvent.keyDown(window, { key: "b", metaKey: true });
    expect(wrapperState()).toBe("expanded");
  });

  it("opens a rail flyout that still reaches every sub-page", async () => {
    renderShell();
    const rail = document.querySelector('[data-sidebar-view="rail"]') as HTMLElement;
    const assets = Array.from(rail.querySelectorAll("button")).find((b) => b.textContent === "Assets")!;
    await act(async () => {
      fireEvent.mouseEnter(assets);
      fireEvent.pointerDown(assets, { button: 0, ctrlKey: false });
    });
    for (const sub of ["Open Assets", "Models", "Categories", "Kits", "Fleet ROI", "Sales Stock"]) {
      expect(await screen.findByRole("menuitem", { name: new RegExp(sub) })).toBeTruthy();
    }
  });
});
