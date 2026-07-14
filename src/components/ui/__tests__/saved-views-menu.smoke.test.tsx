// @vitest-environment jsdom
import React from "react";
import { describe, it, expect, vi, beforeAll } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

vi.mock("@/lib/auth-client", () => ({
  useActiveOrganization: () => ({ data: { id: "org1" } }),
  useSession: () => ({ data: { user: { id: "u1" } } }),
}));
// Writes are now browser-direct (useMutation(api.savedTableViewsWrites.*)); stub the
// hook so the smoke test needs no ConvexProvider in the tree.
vi.mock("@/hooks/use-saved-views-writes", () => ({
  useSavedViewWrites: () => ({
    create: vi.fn(async () => ({ id: "v1", name: "x" })),
    update: vi.fn(async () => {}),
    remove: vi.fn(async () => {}),
    setDefault: vi.fn(async () => {}),
  }),
}));
// The list now derives from the reactive Convex subscription; stub the hook so the
// smoke test doesn't need a ConvexProvider in the tree (undefined = loading → empty).
vi.mock("@/hooks/use-back-office", () => ({
  useSavedTableViews: () => undefined,
}));

import { SavedViewsMenu } from "@/components/ui/saved-views-menu";

// The RVLT registry menu is Radix-based (@radix-ui/react-dropdown-menu). Radix
// uses pointer-capture + scrollIntoView, which jsdom doesn't implement, and it
// opens on keyboard/pointer events (not a bare click). Shim the missing APIs
// and drive the trigger via keyboard so the menu actually mounts.
beforeAll(() => {
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.setPointerCapture ??= () => {};
  Element.prototype.releasePointerCapture ??= () => {};
  Element.prototype.scrollIntoView ??= () => {};
});

function openMenu() {
  const trigger = screen.getByRole("button");
  trigger.focus();
  fireEvent.keyDown(trigger, { key: "Enter" });
  return trigger;
}

describe("SavedViewsMenu smoke", () => {
  it("renders the trigger without throwing", () => {
    expect(() =>
      render(
        <SavedViewsMenu tableId="assets" currentConfig={{}} applyConfig={() => {}} />,
      ),
    ).not.toThrow();
  });

  // Regression: opening the menu mounts the DropdownMenuLabel + items. Guards
  // against the menu crashing on open. The menu must open and show its
  // "Saved views" label.
  it("opens the menu and renders its label", async () => {
    render(
      <SavedViewsMenu tableId="assets" currentConfig={{}} applyConfig={() => {}} />,
    );
    openMenu();
    await waitFor(() => expect(screen.getByText("Saved views")).toBeTruthy());
  });

  // Regression: menu items must be live (a wrong onSelect/onClick wiring once
  // made every action a dead button). Clicking "Save current view…" must open
  // the save dialog.
  it("'Save current view' opens the save dialog", async () => {
    render(
      <SavedViewsMenu tableId="assets" currentConfig={{ filters: { a: ["x"] } }} applyConfig={() => {}} />,
    );
    openMenu();
    const item = await waitFor(() => screen.getByText("Save current view…"));
    fireEvent.click(item);
    // The dialog title is exactly "Save current view" (no ellipsis).
    await waitFor(() => expect(screen.getByText("Save current view")).toBeTruthy());
  });
});
