// @vitest-environment jsdom
//
// UX Phase 10 (spec §8b, D55): the Finance tab's words-switch and position
// tiles. The switch is exercised by CLICKING it; the tiles are checked for
// presence rules: the Margin tile is ABSENT (never $0) when the server sent no
// margin (owner ruling 2026-11-24).
import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { FunctionReference } from "convex/server";

const DAY = 86_400_000;
const T0 = Date.UTC(2026, 10, 24);

vi.mock("@/hooks/use-stable-now", () => ({ useStableNow: () => T0 }));
vi.mock("@/hooks/use-authed-query", async () => {
  const { getFunctionName } = await import("convex/server");
  return {
    useAuthedQuery: (query: FunctionReference<"query">, args: unknown) => {
      if (args === "skip") return undefined;
      const name = getFunctionName(query);
      if (name === "invoices:listForProject") {
        return [{ id: "i1", kind: "DEPOSIT", status: "ISSUED", total: 1000, amountPaid: 100, paymentStatus: "PARTIALLY_PAID", dueDate: T0 - 3 * DAY, issuedAt: T0 - 10 * DAY }];
      }
      if (name === "quotes:revisionStateForProject") {
        return { revision: 1, liveRevision: 1, hasAcceptedQuote: true, draftQuoteId: null, liveQuote: { id: "q1", version: 1, status: "ACCEPTED", sentAt: 1, validUntil: null, snapshotId: null } };
      }
      return undefined;
    },
  };
});

import { PositionTiles } from "@/components/projects/finance/position-tiles";
import { FinanceWordsSwitch } from "@/components/projects/finance/finance-tab-parts";

vi.mock("@/hooks/use-project-operational-costs", () => ({ useProjectOperationalCosts: () => ({ data: undefined, isLoading: true }) }));
vi.mock("@/components/projects/project-version-context", () => ({ useProjectVersion: () => ({ versions: [], isViewingVersion: false, viewingVersion: null }) }));
vi.mock("@/lib/auth-client", () => ({ useActiveOrganization: () => ({ data: { id: "o1" } }) }));
vi.mock("@/components/projects/project-quote-rail", () => ({ ProjectQuoteRail: () => null, ASSIGN_CLIENT_FOR_QUOTES_MESSAGE: "x" }));
vi.mock("@/components/projects/finance/project-invoice-ledger", () => ({ ProjectInvoiceLedger: () => null }));

describe("FinanceWordsSwitch", () => {
  it("shows Quotes and Invoices as words and reports the one clicked", async () => {
    const user = userEvent.setup();
    const onValueChange = vi.fn();
    render(<FinanceWordsSwitch value="quotes" onValueChange={onValueChange} />);
    expect(screen.getByRole("tab", { name: "Quotes" }).getAttribute("aria-selected")).toBe("true");
    await user.click(screen.getByRole("tab", { name: "Invoices" }));
    expect(onValueChange).toHaveBeenCalledWith("invoices");
  });
});

describe("PositionTiles", () => {
  it("reads one derivation: Overdue outranks Part paid, in error tone, with the margin tile when sent", () => {
    render(<PositionTiles projectId="p1" orgId="o1" total={1100} taxAmount={100} margin={400} />);
    expect(screen.getByText("v1 · Accepted")).toBeTruthy();
    expect(screen.getByText("Overdue")).toBeTruthy(); // the Invoiced tile's headline
    expect(screen.getByText(/1 invoice overdue/).className).toMatch(/error/);
    expect(screen.getByText("Margin ex GST")).toBeTruthy();
    expect(screen.getByText("$400.00")).toBeTruthy();
  });

  it("renders NO margin tile (and no $0) when the server sent none", () => {
    const { container } = render(<PositionTiles projectId="p1" orgId="o1" total={1100} taxAmount={100} margin={null} />);
    expect(screen.queryByText("Margin ex GST")).toBeNull();
    expect(container.textContent).not.toMatch(/Margin/);
  });
});
