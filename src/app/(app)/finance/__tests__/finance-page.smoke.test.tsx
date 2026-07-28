// @vitest-environment jsdom
//
// The org-level Finance section (#992, Phase F) — smoke test that actually
// renders the page (CLAUDE.md's overlay-UI convention: typecheck/lint/build
// all pass on a broken form; only rendering catches runtime-only crashes).
import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

vi.mock("@/lib/auth-client", () => ({
  useActiveOrganization: () => ({ data: { id: "org1" } }),
}));

vi.mock("@/lib/use-permissions", () => ({
  useCurrentRole: () => ({ permissions: { invoice: ["read"] }, isLoading: false }),
}));

const PROJECT_A = { id: "p1", projectNumber: "P-1", name: "Big Show", status: "QUOTED", clientId: "c1", clientName: "Acme Events" };
const PROJECT_B = { id: "p2", projectNumber: "P-2", name: "Small Gig", status: "CONFIRMED", clientId: "c2", clientName: "Beta Co" };

const BUNDLE = {
  quotesOut: [
    { quoteId: "q1", version: 2, status: "SENT", sentAt: 0, validUntil: 100 * 86_400_000, total: 5000, project: PROJECT_A },
  ],
  expiring: [
    { quoteId: "q1", version: 2, status: "SENT", validUntil: 3 * 86_400_000, daysLeft: 3, total: 5000, project: PROJECT_A },
  ],
  neverSent: [],
  confirmedUninvoiced: [
    { project: PROJECT_B, rentalEndDate: 5 * 86_400_000, total: 3000 },
  ],
  depositDue: [],
  outstanding: [
    { invoiceId: "inv1", invoiceNumber: "INV-1", kind: "FULL", total: 3000, paymentStatus: "UNPAID", issuedAt: 0, dueDate: 10 * 86_400_000, project: PROJECT_B },
  ],
  capped: false,
};

vi.mock("@/hooks/use-native-org-finance", async () => {
  const actual = await vi.importActual<typeof import("@/hooks/use-native-org-finance")>("@/hooks/use-native-org-finance");
  return {
    ...actual,
    useNativeOrgFinance: () => ({ data: BUNDLE, isLoading: false }),
  };
});

import FinancePage from "../page";

describe("FinancePage smoke", () => {
  it("renders without throwing, showing rows from every non-empty section", () => {
    render(<FinancePage />);
    expect(screen.getByText("Finance")).toBeTruthy();
    expect(screen.getAllByText(/P-1 v2/).length).toBeGreaterThan(0);
    expect(screen.getByText(/P-2 — Small Gig/)).toBeTruthy();
    expect(screen.getByText(/INV-1/)).toBeTruthy();
  });

  it("shows the zero-noise empty label for a section with no rows", () => {
    render(<FinancePage />);
    expect(screen.getByText("No unsent drafts.")).toBeTruthy();
    expect(screen.getByText("No outstanding deposits.")).toBeTruthy();
  });

  it("filters rows by client name without crashing", () => {
    render(<FinancePage />);
    const input = screen.getByPlaceholderText("Filter by client…");
    fireEvent.change(input, { target: { value: "Beta" } });
    expect(screen.queryByText(/P-1 v2/)).toBeNull();
    expect(screen.getByText(/P-2 — Small Gig/)).toBeTruthy();
  });
});

describe("FinancePage smoke — all-clear state", () => {
  it("renders the all-clear state when every section is empty", async () => {
    vi.resetModules();
    vi.doMock("@/hooks/use-native-org-finance", async () => {
      const actual = await vi.importActual<typeof import("@/hooks/use-native-org-finance")>("@/hooks/use-native-org-finance");
      return {
        ...actual,
        useNativeOrgFinance: () => ({
          data: { quotesOut: [], expiring: [], neverSent: [], confirmedUninvoiced: [], depositDue: [], outstanding: [], capped: false },
          isLoading: false,
        }),
      };
    });
    const { default: EmptyFinancePage } = await import("../page");
    render(<EmptyFinancePage />);
    expect(screen.getByText("Nothing to chase.")).toBeTruthy();
  });
});
