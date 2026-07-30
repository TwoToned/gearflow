// @vitest-environment jsdom
import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Trash2 } from "lucide-react";

import { RowActionsMenu, type RowAction } from "@/components/ui/row-actions-menu";

/**
 * #1038 — the row-level overflow menu that replaces walls of pill buttons on
 * the Finance tab's quote/invoice rows. New overlay UI, so it gets the
 * standing jsdom-smoke rule (CLAUDE.md): typecheck/lint/build all pass on a
 * menu that throws at render time, only actually mounting it catches that.
 */
describe("RowActionsMenu smoke", () => {
  it("renders nothing when there are no actions", () => {
    const { container } = render(<RowActionsMenu actions={[]} />);
    expect(container.firstChild).toBeNull();
  });

  it("renders a trigger and opens the menu with every action", async () => {
    const onClick = vi.fn();
    const actions: RowAction[] = [
      { key: "a", label: "Mark accepted", icon: Trash2, onClick },
      { key: "b", label: "Delete draft", icon: Trash2, onClick: vi.fn(), destructive: true },
    ];
    const user = userEvent.setup();
    render(<RowActionsMenu actions={actions} label="Row actions" />);

    expect(screen.queryByText("Mark accepted")).toBeNull();
    await user.click(screen.getByRole("button", { name: "Row actions" }));
    expect(await screen.findByText("Mark accepted")).toBeTruthy();
    expect(screen.getByText("Delete draft")).toBeTruthy();

    await user.click(screen.getByText("Mark accepted"));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("disables a loading action", async () => {
    const user = userEvent.setup();
    const actions: RowAction[] = [{ key: "a", label: "Protect", icon: Trash2, onClick: vi.fn(), loading: true }];
    render(<RowActionsMenu actions={actions} />);
    await user.click(screen.getByRole("button", { name: "More actions" }));
    const item = await screen.findByText("Protect");
    expect(item.closest('[role="menuitem"]')?.getAttribute("aria-disabled")).toBe("true");
  });
});
