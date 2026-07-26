// @vitest-environment jsdom
import React from "react";
import { describe, it, expect, vi, beforeAll } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

/**
 * Smoke test for the returns-station page (issue #944 WS5) — renders it with an
 * open exceptions list, per CLAUDE.md's overlay-UI test rule ("Cover new overlay
 * UI with a jsdom smoke test that actually renders it" — the disambiguation
 * `Dialog` here is Radix, composed correctly, but this still catches any
 * TooltipProvider-style crash on first render, same pattern as
 * `src/components/assets/__tests__/model-roi-tab.smoke.test.tsx`).
 */

beforeAll(() => {
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.setPointerCapture ??= () => {};
  Element.prototype.releasePointerCapture ??= () => {};
  Element.prototype.scrollIntoView ??= () => {};
});

const board = {
  projects: [
    {
      projectId: "p1",
      projectName: "Gig One",
      projectNumber: "P-001",
      status: "CHECKED_OUT",
      rentalEndDate: null,
      urgency: "overdue" as const,
      lines: [
        {
          lineItemId: "li1",
          description: "Moving Light",
          modelName: "Moving Light",
          kind: "serialized" as const,
          quantity: 1,
          checkedOutQuantity: 1,
          returnedQuantity: 0,
          outstanding: 1,
          scannable: true,
          kitId: null,
          kitAssetTag: null,
          accessories: [],
        },
      ],
    },
  ],
  truncated: false,
};

const refetch = vi.fn().mockResolvedValue(board);
const resolveScan = vi.fn().mockResolvedValue({ kind: "not_found" });
const returnScan = vi.fn().mockResolvedValue({ updatedLineIds: ["li1"], projectId: "p1", autoAdvanced: false });
const returnBatch = vi.fn().mockResolvedValue([]);
const correctCondition = vi.fn().mockResolvedValue({ updated: true });
const raiseRepair = vi.fn().mockResolvedValue({ id: "rec1" });

vi.mock("@/hooks/use-returns", () => ({
  useReturnsBoard: () => ({ data: board, isLoading: false, refetch }),
  useReturnsWrites: () => ({
    orgId: "org_1",
    returnScan,
    returnBulk: vi.fn(),
    returnBatch,
    correctCondition,
    raiseRepair,
  }),
  useResolveScan: () => resolveScan,
  useLineUnits: () => vi.fn().mockResolvedValue([]),
}));

vi.mock("@/hooks/use-warehouse-writes", () => ({
  useWarehouseWrites: () => ({ checkInKit: vi.fn() }),
}));

vi.mock("@/lib/auth-client", () => ({
  useActiveOrganization: () => ({ data: { id: "org_1" } }),
  useSession: () => ({ data: { user: { id: "user_1", name: "Alice" } } }),
}));

vi.mock("@/lib/use-permissions", () => ({
  useCurrentRole: () => ({ role: "admin", roleName: "Admin", permissions: { warehouse: ["read", "check_in"], maintenance: ["create"] }, isLoading: false }),
  useCanDo: () => true,
  useIsViewer: () => false,
}));

import ReturnsStationPage from "../page";

describe("Returns station page smoke test", () => {
  it("renders without throwing and shows the board", async () => {
    render(<ReturnsStationPage />);
    await waitFor(() => expect(screen.getByText("Returns")).toBeTruthy());
    expect(screen.getByText("Gig One")).toBeTruthy();
    expect(screen.getByText("Moving Light")).toBeTruthy();
  });

  it("logs an exception (session-local) for an unresolvable scan, never blocking the dock", async () => {
    const user = userEvent.setup();
    render(<ReturnsStationPage />);
    const input = await screen.findByPlaceholderText(/scan any asset/i);
    await user.type(input, "UNKNOWN-TAG{Enter}");
    await waitFor(() => expect(screen.getByText(/Exceptions \(1\)/)).toBeTruthy());
    expect(screen.getByText("UNKNOWN-TAG")).toBeTruthy();
    // The scan input is still usable — an exception never blocks the dock.
    expect((input as HTMLInputElement).disabled).toBe(false);
  });

  it("the refresh button is a real button, not a button nested inside another button", async () => {
    render(<ReturnsStationPage />);
    const refreshBtn = await screen.findByLabelText("Refresh");
    expect(refreshBtn.tagName).toBe("BUTTON");
    expect(refreshBtn.querySelector("button")).toBeNull();
  });
});
