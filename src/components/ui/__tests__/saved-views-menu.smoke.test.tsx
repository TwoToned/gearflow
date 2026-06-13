// @vitest-environment jsdom
import React from "react";
import { describe, it, expect, vi } from "vitest";
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

describe("SavedViewsMenu smoke", () => {
  it("renders the trigger without throwing", () => {
    expect(() =>
      render(
        <SavedViewsMenu tableId="assets" currentConfig={{}} applyConfig={() => {}} />,
      ),
    ).not.toThrow();
  });

  // Regression: clicking the "Views" button opens the menu, which mounts the
  // DropdownMenuLabel. Base UI's GroupLabel throws if not inside a Group — that
  // crashed every list page. The trigger-only smoke test above missed it.
  it("opens the menu without throwing (DropdownMenuLabel must be in a Group)", async () => {
    render(
      <SavedViewsMenu tableId="assets" currentConfig={{}} applyConfig={() => {}} />,
    );
    fireEvent.click(screen.getByRole("button"));
    await waitFor(() => expect(screen.getByText("Saved views")).toBeTruthy());
  });

  // Regression: Base UI Menu.Item fires onClick, NOT Radix's onSelect. Using
  // onSelect made every menu action a dead button. Clicking "Save current view…"
  // must open the save dialog.
  it("'Save current view' opens the save dialog (items use onClick)", async () => {
    render(
      <SavedViewsMenu tableId="assets" currentConfig={{ filters: { a: ["x"] } }} applyConfig={() => {}} />,
    );
    fireEvent.click(screen.getByRole("button"));
    const item = await waitFor(() => screen.getByText("Save current view…"));
    fireEvent.click(item);
    // The dialog title is exactly "Save current view" (no ellipsis).
    await waitFor(() => expect(screen.getByText("Save current view")).toBeTruthy());
  });
});
