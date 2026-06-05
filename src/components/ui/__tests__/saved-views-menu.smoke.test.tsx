// @vitest-environment jsdom
import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

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

import { SavedViewsMenu } from "@/components/ui/saved-views-menu";

describe("SavedViewsMenu smoke", () => {
  it("renders the trigger without throwing", () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    expect(() =>
      render(
        <QueryClientProvider client={qc}>
          <SavedViewsMenu tableId="assets" currentConfig={{}} applyConfig={() => {}} />
        </QueryClientProvider>,
      ),
    ).not.toThrow();
  });

  // Regression: clicking the "Views" button opens the menu, which mounts the
  // DropdownMenuLabel. Base UI's GroupLabel throws if not inside a Group — that
  // crashed every list page. The trigger-only smoke test above missed it.
  it("opens the menu without throwing (DropdownMenuLabel must be in a Group)", async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <SavedViewsMenu tableId="assets" currentConfig={{}} applyConfig={() => {}} />
      </QueryClientProvider>,
    );
    fireEvent.click(screen.getByRole("button"));
    await waitFor(() => expect(screen.getByText("Saved views")).toBeTruthy());
  });
});
