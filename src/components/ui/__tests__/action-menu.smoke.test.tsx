// @vitest-environment jsdom
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Pencil, Trash2 } from "lucide-react";

import { ActionMenu } from "@/components/ui/action-menu";
import type { ActionMenuSpec } from "@/lib/primitives/types";

const mobile = vi.hoisted(() => ({ value: false }));
vi.mock("@/hooks/use-mobile", () => ({ useIsMobile: () => mobile.value }));

function makeSpec() {
  const edit = vi.fn();
  const move = vi.fn();
  const del = vi.fn();
  const sub = vi.fn();
  const spec: ActionMenuSpec = {
    items: [
      // Deliberately out of order: the renderer sorts by ACTION_GROUPS.
      {
        key: "delete", label: "Delete", group: "danger", danger: true, kbd: "D", icon: Trash2, onSelect: del,
        confirm: { title: "Delete line?", body: "Reservations are released.", confirmLabel: "Delete line" },
      },
      { key: "edit", label: "Edit", group: "edit", kbd: "E", icon: Pencil, onSelect: edit },
      {
        key: "move", label: "Move to", group: "organise", kbd: "M", onSelect: move,
        children: [{ key: "case", label: "Case LX-04", group: "organise", onSelect: sub }],
      },
    ],
  };
  return { spec, edit, move, del, sub };
}

describe("ActionMenu smoke", () => {
  beforeEach(() => {
    mobile.value = false;
  });

  it("renders nothing for an empty spec", () => {
    const { container } = render(<ActionMenu spec={{ items: [] }} />);
    expect(container.firstChild).toBeNull();
  });

  it("desktop: opens, orders groups with danger last, selects an item", async () => {
    const { spec, edit } = makeSpec();
    const user = userEvent.setup();
    render(<ActionMenu spec={spec} label="Row actions" />);
    await user.click(screen.getByRole("button", { name: "Row actions" }));
    const labels = (await screen.findAllByRole("menuitem")).map((m) => m.textContent);
    expect(labels[0]).toContain("Edit");
    expect(labels[labels.length - 1]).toContain("Delete");
    await user.click(screen.getByRole("menuitem", { name: /Edit/ }));
    expect(edit).toHaveBeenCalledTimes(1);
  });

  it("desktop: opens a submenu", async () => {
    const { spec, sub } = makeSpec();
    const user = userEvent.setup();
    render(<ActionMenu spec={spec} />);
    await user.click(screen.getByRole("button", { name: "More actions" }));
    // Keyboard-open: pointer grace-area logic is not reliable in jsdom.
    const parent = await screen.findByRole("menuitem", { name: /Move to/ });
    parent.focus();
    await user.keyboard("{ArrowRight}");
    const child = await screen.findByRole("menuitem", { name: /Case LX-04/ });
    child.focus();
    await user.keyboard("{Enter}");
    expect(sub).toHaveBeenCalledTimes(1);
  });

  it("desktop: a danger item asks first and only runs on confirm", async () => {
    const { spec, del } = makeSpec();
    const user = userEvent.setup();
    render(<ActionMenu spec={spec} />);
    await user.click(screen.getByRole("button", { name: "More actions" }));
    await user.click(await screen.findByRole("menuitem", { name: /Delete/ }));
    expect(await screen.findByText("Delete line?")).toBeTruthy();
    expect(del).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Delete line" }));
    expect(del).toHaveBeenCalledTimes(1);
  });

  it("desktop: Cancel on the confirm dialog does not run it", async () => {
    const { spec, del } = makeSpec();
    const user = userEvent.setup();
    render(<ActionMenu spec={spec} />);
    await user.click(screen.getByRole("button", { name: "More actions" }));
    await user.click(await screen.findByRole("menuitem", { name: /Delete/ }));
    await user.click(await screen.findByRole("button", { name: "Cancel" }));
    expect(del).not.toHaveBeenCalled();
  });

  it("desktop: a single-key shortcut fires while the menu is open", async () => {
    const { spec, edit } = makeSpec();
    const user = userEvent.setup();
    render(<ActionMenu spec={spec} />);
    await user.click(screen.getByRole("button", { name: "More actions" }));
    await screen.findAllByRole("menuitem");
    await user.keyboard("e");
    expect(edit).toHaveBeenCalledTimes(1);
  });

  it("phone: opens the bottom sheet with 48px items, closes on tap", async () => {
    mobile.value = true;
    const { spec, edit } = makeSpec();
    const user = userEvent.setup();
    render(<ActionMenu spec={spec} />);
    await user.click(screen.getByRole("button", { name: "More actions" }));
    const item = await screen.findByRole("button", { name: "Edit" });
    expect(item.className).toContain("min-h-12");
    await user.click(item);
    expect(edit).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.queryByRole("button", { name: "Edit" })).toBeNull());
  });

  it("phone: a parent item opens its sub-level and Back returns", async () => {
    mobile.value = true;
    const { spec, sub } = makeSpec();
    const user = userEvent.setup();
    render(<ActionMenu spec={spec} />);
    await user.click(screen.getByRole("button", { name: "More actions" }));
    await user.click(await screen.findByRole("button", { name: "Move to" }));
    expect(screen.queryByRole("button", { name: "Edit" })).toBeNull();
    await user.click(screen.getByRole("button", { name: "Back" }));
    expect(await screen.findByRole("button", { name: "Edit" })).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Move to" }));
    await user.click(await screen.findByRole("button", { name: "Case LX-04" }));
    expect(sub).toHaveBeenCalledTimes(1);
  });

  it("phone: danger confirms through the Dialog", async () => {
    mobile.value = true;
    const { spec, del } = makeSpec();
    const user = userEvent.setup();
    render(<ActionMenu spec={spec} />);
    await user.click(screen.getByRole("button", { name: "More actions" }));
    await user.click(await screen.findByRole("button", { name: "Delete" }));
    await user.click(await screen.findByRole("button", { name: "Delete line" }));
    expect(del).toHaveBeenCalledTimes(1);
  });

  it("a danger item without a confirm runs immediately (its handler owns the dialog)", async () => {
    const onSelect = vi.fn();
    const user = userEvent.setup();
    render(<ActionMenu spec={{ items: [{ key: "v", label: "Void invoice", group: "danger", danger: true, onSelect }] }} />);
    await user.click(screen.getByRole("button", { name: "More actions" }));
    await user.click(await screen.findByRole("menuitem", { name: /Void invoice/ }));
    expect(onSelect).toHaveBeenCalledTimes(1);
  });

  it("a custom trigger opens the menu on desktop", async () => {
    const { spec, edit } = makeSpec();
    const user = userEvent.setup();
    render(<ActionMenu spec={spec} trigger={<button type="button">Documents</button>} />);
    expect(screen.queryByRole("button", { name: "More actions" })).toBeNull();
    await user.click(screen.getByRole("button", { name: "Documents" }));
    await user.click(await screen.findByRole("menuitem", { name: /Edit/ }));
    expect(edit).toHaveBeenCalledTimes(1);
  });

  it("a custom trigger opens the bottom sheet on phone", async () => {
    mobile.value = true;
    const { spec, edit } = makeSpec();
    const user = userEvent.setup();
    render(<ActionMenu spec={spec} trigger={<button type="button">Documents</button>} />);
    await user.click(screen.getByRole("button", { name: "Documents" }));
    await user.click(await screen.findByRole("button", { name: "Edit" }));
    expect(edit).toHaveBeenCalledTimes(1);
  });

  it("renders a non-interactive header when open, on desktop", async () => {
    const { spec } = makeSpec();
    const user = userEvent.setup();
    render(<ActionMenu spec={spec} header="Locked by Sam on 3 Nov. Pricing is read-only." />);
    expect(screen.queryByText(/Locked by Sam/)).toBeNull();
    await user.click(screen.getByRole("button", { name: "More actions" }));
    expect(await screen.findByText(/Locked by Sam/)).toBeTruthy();
  });

  it("renders the header in the phone sheet", async () => {
    mobile.value = true;
    const { spec } = makeSpec();
    const user = userEvent.setup();
    render(<ActionMenu spec={spec} header="Locked by Sam on 3 Nov. Pricing is read-only." />);
    await user.click(screen.getByRole("button", { name: "More actions" }));
    expect(await screen.findByText(/Locked by Sam/)).toBeTruthy();
  });
});
