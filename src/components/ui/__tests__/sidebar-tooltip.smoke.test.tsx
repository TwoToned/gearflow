// @vitest-environment jsdom
import React from "react";
import { describe, it, expect, beforeAll } from "vitest";
import { render, screen } from "@testing-library/react";

beforeAll(() => {
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.setPointerCapture ??= () => {};
  Element.prototype.releasePointerCapture ??= () => {};
  Element.prototype.scrollIntoView ??= () => {};
  window.matchMedia ??= ((q: string) => ({
    matches: false,
    media: q,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
});

import {
  SidebarProvider,
  Sidebar,
  SidebarContent,
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
} from "@/components/ui/sidebar";

/**
 * `SidebarMenuButton` only renders a Tooltip when it is given a `tooltip` prop. No
 * caller passes one today, so the missing `TooltipProvider` was invisible — the
 * branch was dead. It would have thrown "Tooltip must be used within
 * TooltipProvider" and taken the whole sidebar down for whoever passed it first.
 *
 * This test passes the prop, so the branch can never rot back to broken.
 */
const renderSidebar = (tooltip?: string) =>
  render(
    <SidebarProvider>
      <Sidebar collapsible="icon">
        <SidebarContent>
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton tooltip={tooltip}>Projects</SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarContent>
      </Sidebar>
    </SidebarProvider>,
  );

describe("SidebarMenuButton tooltip smoke", () => {
  it("renders with a tooltip without throwing", () => {
    renderSidebar("Projects");
    expect(screen.getByText("Projects")).toBeTruthy();
  });

  /**
   * Second bug in the same dead branch: `render` was swapped for a
   * `<TooltipTrigger asChild>{render}</TooltipTrigger>`. Callers pass children and no
   * `render`, so that wrapped `undefined` and Radix's Slot rendered NOTHING — the menu
   * item came out silently empty. It has to still be a real button.
   */
  it("still renders its button when a tooltip is set", () => {
    renderSidebar("Projects");
    const btn = screen.getByRole("button", { name: "Projects" });
    expect(btn.tagName).toBe("BUTTON");
    expect(btn.getAttribute("data-slot")).toBe("sidebar-menu-button");
  });

  it("still renders with no tooltip prop (the common path)", () => {
    renderSidebar();
    expect(screen.getByRole("button", { name: "Projects" })).toBeTruthy();
  });

  // The nav composes with `render={<Link/>}` (Base UI useRender). Combining that with
  // a tooltip must keep the caller's element, not replace it with a bare button.
  it("preserves a custom `render` element alongside a tooltip", () => {
    render(
      <SidebarProvider>
        <Sidebar collapsible="icon">
          <SidebarContent>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton render={<a href="/projects" />} tooltip="Projects">
                  Projects
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarContent>
        </Sidebar>
      </SidebarProvider>,
    );

    const link = screen.getByRole("link", { name: "Projects" });
    expect(link.getAttribute("href")).toBe("/projects");
  });
});
