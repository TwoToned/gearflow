// @vitest-environment jsdom
import React from "react";
import { describe, it, expect, vi, beforeAll } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

vi.mock("@/lib/auth-client", () => ({
  useActiveOrganization: () => ({ data: { id: "org1" } }),
}));
vi.mock("@/server/saved-views", () => ({
  getSavedViews: vi.fn(async () => []),
  createSavedView: vi.fn(async () => ({})),
  updateSavedView: vi.fn(async () => ({})),
  deleteSavedView: vi.fn(async () => {}),
  setDefaultSavedView: vi.fn(async () => {}),
}));
// The component subscribes to Convex for cross-tab sync; stub the hook so the
// smoke test doesn't need a ConvexProvider in the tree.
vi.mock("@/hooks/use-back-office", () => ({
  useSavedTableViews: () => undefined,
  fingerprintSavedTableViews: () => undefined,
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
