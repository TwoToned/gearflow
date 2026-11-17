// @vitest-environment jsdom
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, cleanup, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ActionMenuSpec } from "@/lib/primitives/types";

let mockIsMobile = false;
vi.mock("@/hooks/use-mobile", () => ({ useIsMobile: () => mockIsMobile }));

import { DetailHeader } from "@/components/ui/detail-header";

const steps = ["Enquiry", "Quote", "Confirmed", "Prep"].map((label) => ({ key: label, label }));

function setup(over: Partial<React.ComponentProps<typeof DetailHeader>> = {}) {
  const unlock = vi.fn();
  const doc = vi.fn();
  const more = vi.fn();
  const lockMenu: ActionMenuSpec = {
    items: [{ key: "unlock", label: "Unlock pricing", group: "edit", onSelect: unlock }],
  };
  const documents: ActionMenuSpec = {
    items: [{ key: "pick", label: "Pick list", group: "documents", onSelect: doc }],
  };
  const menu: ActionMenuSpec = {
    items: [
      { key: "dup", label: "Duplicate", group: "organise", onSelect: more },
      {
        key: "cancel",
        label: "Cancel job",
        group: "danger",
        danger: true,
        onSelect: vi.fn(),
        confirm: { title: "Cancel this job?", body: "Reservations are released.", confirmLabel: "Cancel job" },
      },
    ],
  };
  render(
    <DetailHeader
      title="Hilton gala"
      status={{ label: "Confirmed", intent: "success" }}
      lock={{ label: "Pricing locked", summary: "Read-only while locked: prices, discounts, rates and tax.", menu: lockMenu }}
      meta={["#2341", "Hilton", "6 Nov · 3 days"]}
      primary={{ label: "Advance to Prep", onSelect: vi.fn() }}
      documents={documents}
      onEdit={vi.fn()}
      menu={menu}
      progress={{ steps, currentIndex: 2, subLabel: "accepted" }}
      {...over}
    />,
  );
  return { unlock, doc, more };
}

describe("DetailHeader", () => {
  beforeEach(() => {
    cleanup();
    mockIsMobile = false;
  });

  it("renders the calm header: title, status word, meta, one primary, progress", () => {
    setup();
    expect(screen.getByRole("heading", { name: "Hilton gala" })).toBeTruthy();
    expect(screen.getByText("Confirmed")).toBeTruthy();
    expect(screen.getByText("#2341")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Advance to Prep" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Edit" })).toBeTruthy();
    const current = screen.getByRole("list", { name: "Progress" }).querySelector('[aria-current="step"]');
    expect(current?.textContent).toBe("Confirmed · accepted");
  });

  it("the lock glyph opens a menu that says what it is and unlocks", async () => {
    const { unlock } = setup();
    await userEvent.click(screen.getByRole("button", { name: "Pricing locked" }));
    expect(screen.getByRole("button", { name: "Pricing locked" }).getAttribute("title")).toContain("Read-only");
    await userEvent.click(await screen.findByRole("menuitem", { name: "Unlock pricing" }));
    expect(unlock).toHaveBeenCalledTimes(1);
  });

  it("Documents ▾ opens its menu", async () => {
    const { doc } = setup();
    await userEvent.click(screen.getByRole("button", { name: /Documents/ }));
    await userEvent.click(await screen.findByRole("menuitem", { name: "Pick list" }));
    expect(doc).toHaveBeenCalledTimes(1);
  });

  it("⋯ opens the menu; a danger verb asks first", async () => {
    setup();
    await userEvent.click(screen.getByRole("button", { name: "More actions" }));
    const menu = await screen.findByRole("menu");
    expect(within(menu).getByRole("menuitem", { name: "Duplicate" })).toBeTruthy();
    await userEvent.click(within(menu).getByRole("menuitem", { name: "Cancel job" }));
    expect(await screen.findByText("Cancel this job?")).toBeTruthy();
  });

  it("on a phone the lock and Documents open as bottom sheets", async () => {
    mockIsMobile = true;
    const { doc } = setup();
    await userEvent.click(screen.getByRole("button", { name: /Documents/ }));
    await userEvent.click(await screen.findByRole("button", { name: "Pick list" }));
    expect(doc).toHaveBeenCalledTimes(1);
  });

  it("warehouse variant shows the packer's facts instead of the meta line", () => {
    setup({ variant: "warehouse", packerFacts: { loadsOut: "Thu 07:00", truck: "T2", packing: ["Sam", "Alex"] } });
    expect(screen.getByText("Loads out Thu 07:00")).toBeTruthy();
    expect(screen.getByText("Truck T2")).toBeTruthy();
    expect(screen.getByText("Packing Sam, Alex")).toBeTruthy();
    expect(screen.queryByText("#2341")).toBeNull();
  });

  it("the quiet strip slot appears only when given", () => {
    setup({ strip: "Viewing v2, a draft" });
    expect(screen.getByText("Viewing v2, a draft")).toBeTruthy();
  });
});
