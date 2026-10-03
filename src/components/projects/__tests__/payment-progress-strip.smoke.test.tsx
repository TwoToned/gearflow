// @vitest-environment jsdom
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

/**
 * #1236 — the money-phase strip, RENDERED.
 *
 * The unit tests next door cover `computePaymentProgress` as a pure function, which
 * is not the same thing as proving the component mounts. This repo has been burned
 * by exactly that gap before: a `Tooltip` with no `TooltipProvider` ancestor passes
 * typecheck, lint AND `next build`, and only explodes when a human opens the page
 * (see `assets/__tests__/model-roi-tab.smoke.test.tsx`). Any new component that
 * renders on the project detail gets a test that actually mounts it.
 *
 * Also pins the behaviour that makes the strip safe to mount unconditionally: it
 * returns null — and issues NO queries — on every status except AWAITING_PAYMENT.
 */

const useAuthedQuery = vi.fn();
vi.mock("@/hooks/use-authed-query", () => ({ useAuthedQuery: (...a: unknown[]) => useAuthedQuery(...a) }));
vi.mock("../../../../convex/_generated/api", () => ({ api: { quotes: { listForProject: "quotes" }, invoices: { listForProject: "invoices" } } }));

import { PaymentProgressStrip } from "@/components/projects/payment-progress-strip";

const NOW = Date.UTC(2026, 6, 25);

/** Wire the two queries by the api ref each call passes, so argument order can't
 *  silently swap quotes and invoices without this failing. */
function mockData(quotes: unknown, invoices: unknown) {
  useAuthedQuery.mockImplementation((ref: string) => (ref === "quotes" ? quotes : invoices));
}

beforeEach(() => useAuthedQuery.mockReset());

describe("PaymentProgressStrip", () => {
  it("renders the three sub-steps while the job is awaiting payment", () => {
    mockData(
      [{ effectiveStatus: "ACCEPTED", version: 2, acceptedAt: Date.UTC(2026, 6, 21) }],
      [{ kind: "DEPOSIT", status: "ISSUED", total: 1650, invoiceNumber: "INV-0042", paymentStatus: "UNPAID" }],
    );
    render(<PaymentProgressStrip projectId="p1" orgId="org1" status="AWAITING_PAYMENT" now={NOW} />);

    expect(screen.getByText("Quote accepted")).toBeTruthy();
    expect(screen.getByText("Invoice sent")).toBeTruthy();
    expect(screen.getByText("Paid")).toBeTruthy();
    // The one we're actually waiting on carries the outstanding figure.
    expect(screen.getByText(/outstanding/)).toBeTruthy();
  });

  it("renders nothing, and queries nothing, on any other status", () => {
    mockData([], []);
    for (const status of ["QUOTED", "CONFIRMED", "PREPPING", "COMPLETED", null]) {
      const { container, unmount } = render(
        <PaymentProgressStrip projectId="p1" orgId="org1" status={status} now={NOW} />,
      );
      expect(container.firstChild).toBeNull();
      unmount();
    }
    // "skip" on every call — the strip must not cost two subscriptions on every
    // project page just to decide it has nothing to say.
    expect(useAuthedQuery.mock.calls.every((c) => c[1] === "skip")).toBe(true);
  });

  it("renders nothing without an org (the orgId is still resolving)", () => {
    mockData([], []);
    const { container } = render(
      <PaymentProgressStrip projectId="p1" orgId={undefined} status="AWAITING_PAYMENT" now={NOW} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders nothing while the queries are still in flight", () => {
    // `undefined` is Convex's loading sentinel. A skeleton here would flash under a
    // stepper that already says "Awaiting payment" — noise, not information.
    mockData(undefined, undefined);
    const { container } = render(
      <PaymentProgressStrip projectId="p1" orgId="org1" status="AWAITING_PAYMENT" now={NOW} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("survives a job with no quote and no invoice at all", () => {
    mockData([], []);
    render(<PaymentProgressStrip projectId="p1" orgId="org1" status="AWAITING_PAYMENT" now={NOW} />);
    expect(screen.getByText("Quote accepted")).toBeTruthy();
    expect(screen.queryByText(/outstanding/)).toBeNull();
  });
});
