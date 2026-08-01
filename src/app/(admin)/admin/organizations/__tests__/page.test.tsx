// @vitest-environment jsdom
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

/**
 * The real multi-org admin list (#1078, A8) — smoke coverage that it renders
 * without crashing and that the "Never activated" filter toggle actually
 * re-issues the query with the flag set (the data-shape/predicate logic
 * itself is covered at the server layer in site-admin-org-list.test.ts).
 */

vi.mock("next/navigation", () => ({
  usePathname: () => "/admin/organizations",
  useRouter: () => ({ push: vi.fn() }),
}));

let queryFnSpy: ((args: unknown) => unknown) | null = null;
const getAllOrganizations = vi.fn(async (args: unknown) => {
  queryFnSpy?.(args);
  return { organizations: [], total: 0, page: 1, pageSize: 20, totalPages: 0 };
});
vi.mock("@/server/site-admin", () => ({
  getAllOrganizations: (...a: unknown[]) => getAllOrganizations(a[0]),
}));

import AdminOrganizationsPage from "../page";

beforeEach(() => {
  vi.clearAllMocks();
  queryFnSpy = null;
});

describe("AdminOrganizationsPage", () => {
  it("renders without crashing and shows the empty state", async () => {
    render(<AdminOrganizationsPage />);
    await waitFor(() => expect(screen.getByText("No organizations found.")).toBeTruthy());
  });

  it("toggling 'Never activated' re-queries with the flag set", async () => {
    render(<AdminOrganizationsPage />);
    await waitFor(() => expect(getAllOrganizations).toHaveBeenCalled());

    fireEvent.click(screen.getByRole("button", { name: /never activated/i }));

    await waitFor(() =>
      expect(getAllOrganizations).toHaveBeenCalledWith(
        expect.objectContaining({ neverActivatedOnly: true }),
      ),
    );
    await waitFor(() => expect(screen.getByText("No never-activated organizations.")).toBeTruthy());
  });
});
