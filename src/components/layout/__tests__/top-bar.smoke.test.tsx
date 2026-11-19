// @vitest-environment jsdom
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

/** The top bar renders the real trail, names the record via PageMeta, and sets document.title from it. */

const push = vi.fn();
let pathname = "/projects/cm1abcdefghijklmnopqrstuv";
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }), usePathname: () => pathname }));
vi.mock("@/lib/use-platform-name", () => ({ usePlatformName: () => "RVLT Flow" }));
vi.mock("@/components/ui/sidebar", () => ({ SidebarTrigger: () => <button>toggle</button> }));
vi.mock("@/components/layout/command-search", () => ({ CommandSearch: () => <button>search</button> }));
vi.mock("@/components/layout/notifications", () => ({ Notifications: () => <button>bell</button> }));

import { TopBar } from "@/components/layout/top-bar";
import { BreadcrumbProvider } from "@/components/layout/breadcrumbs";
import { PageMeta } from "@/components/layout/page-meta";

const renderBar = (title?: string) =>
  render(
    <BreadcrumbProvider>
      <TopBar />
      <PageMeta title={title} />
    </BreadcrumbProvider>,
  );

beforeEach(() => {
  push.mockClear();
  pathname = "/projects/cm1abcdefghijklmnopqrstuv";
});

describe("TopBar trail", () => {
  it("shows Jobs › the record name (a link, then ink) and titles the tab from it", () => {
    renderBar("#2341 Hilton gala");
    const nav = screen.getByRole("navigation", { name: "Breadcrumb" });
    const link = nav.querySelector("a")!;
    expect(link.textContent).toBe("Jobs");
    expect(link.getAttribute("href")).toBe("/projects");
    expect(nav.querySelector('[aria-current="page"]')!.textContent).toBe("#2341 Hilton gala");
    expect(document.title).toBe("#2341 Hilton gala — RVLT Flow");
    fireEvent.click(link);
    expect(push).toHaveBeenCalledWith("/projects");
  });

  it("never prints the raw id while the record is still loading", () => {
    renderBar(undefined);
    expect(document.body.textContent).not.toContain("cm1abcdefghijklmnopqrstuv");
  });

  it("a module root is a single ink crumb (Home, not Dashboard)", () => {
    pathname = "/dashboard";
    renderBar();
    const nav = screen.getByRole("navigation", { name: "Breadcrumb" });
    expect(nav.querySelectorAll("a").length).toBe(0);
    expect(nav.textContent).toBe("Home");
  });
});
