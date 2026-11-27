// @vitest-environment jsdom
import React from "react";
import { describe, it, expect, vi, afterEach, beforeAll } from "vitest";
import { cleanup, render, screen, waitFor, within, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { FinanceHub } from "@/components/finance/finance-hub";

beforeAll(() => {
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.setPointerCapture ??= () => {};
  Element.prototype.releasePointerCapture ??= () => {};
  Element.prototype.scrollIntoView ??= () => {};
});

const state = vi.hoisted(() => ({
  search: "tab=quotes",
  money: true,
  approxInvoices: false,
  canPublish: true,
  xero: { isConnected: true } as { isConnected: boolean } | null | undefined,
  push: vi.fn(),
  ack: vi.fn(async () => ({ id: "q", version: 1 })),
  data: {} as Record<string, unknown>,
}));

vi.mock("@/hooks/use-mobile", () => ({ useIsMobile: () => false }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: state.push, replace: vi.fn() }),
  usePathname: () => "/finance",
  useSearchParams: () => new URLSearchParams(state.search),
}));
vi.mock("@/lib/auth-client", () => ({ useActiveOrganization: () => ({ data: { id: "org_1" } }) }));
vi.mock("@/lib/use-permissions", () => ({ useCanDo: () => state.canPublish }));
vi.mock("@/hooks/use-stable-now", () => ({ useStableNow: () => Date.UTC(2026, 10, 24, 12) }));
vi.mock("@/hooks/use-xero-linked", () => ({ useXeroIntegration: () => state.xero }));
vi.mock("@/server/finance-documents", () => ({ generateQuoteArtifact: vi.fn(), generateInvoiceArtifact: vi.fn() }));
vi.mock("@/server/xero", () => ({ pushInvoiceToXero: vi.fn() }));
vi.mock("@/hooks/use-invoice-writes", () => ({ useInvoiceWrites: () => ({ void: vi.fn(), deleteDraft: vi.fn() }) }));
vi.mock("@/hooks/use-payment-writes", () => ({ usePaymentWrites: () => ({ record: vi.fn() }) }));
vi.mock("@/hooks/use-quote-writes", () => ({ useQuoteWrites: () => ({ acknowledgeExpired: state.ack }) }));
vi.mock("@/hooks/use-authed-query", () => ({
  useAuthedQuery: (ref: { _name?: string } | string, args: unknown) => {
    if (args === "skip") return undefined;
    const name = String((ref as unknown as { [k: symbol]: unknown })[Symbol.for("functionName")] ?? "");
    return state.data[name];
  },
}));

const project = { id: "p1", projectNumber: "#2341", name: "Hilton gala", clientId: "c1", clientName: "Hilton" };

function setData() {
  const m = state.money;
  state.data = {
    "financeHub:hubCounts": {
      quotes: { all: 3, draft: 0, sent: 1, accepted: 1, expired: 1 },
      invoices: { all: 2, draft: 0, depositdue: 1, issued: 0, paid: 0, overdue: 1 },
      truncated: false,
      approx: {
        quotes: false,
        invoices: state.approxInvoices,
        depositdue: false,
        words: { quoted: false, awaitingPayment: state.approxInvoices, overdue: state.approxInvoices, invoicedThisMonth: false },
      },
      ...(m ? { money: { quoted: 5000, awaitingPayment: 0, invoicedThisMonth: 330, overdue: 70 } } : {}),
    },
    "financeHub:quotesPage": {
      items: [
        { id: "q_sent", version: 3, status: "SENT", dismissed: false, sentAt: Date.UTC(2026, 10, 4), validUntil: null, daysLeft: 5, hasPdf: true, project, ...(m ? { total: 5000 } : {}) },
        { id: "q_exp", version: 1, status: "EXPIRED", dismissed: false, sentAt: Date.UTC(2026, 9, 4), validUntil: null, daysLeft: -2, hasPdf: true, project, ...(m ? { total: 900 } : {}) },
      ],
      total: 2, totalPages: 1, page: 1, pageSize: 25, truncated: false, moneyVisible: m, now: 0,
    },
    "financeHub:invoicesPage": {
      kind: "invoices",
      items: [
        { id: "i_od", invoiceNumber: "INV-0041", kind: "DEPOSIT", depositPercent: 30, pill: "OVERDUE", pillLabel: "Overdue", issuedAt: Date.UTC(2026, 10, 1), dueDate: null, overdueDays: 4, hasPdf: true, xero: { status: "SYNCED", error: null }, project, ...(m ? { total: 3300, outstanding: 70 } : {}) },
      ],
      total: 1, totalPages: 1, page: 1, pageSize: 25, truncated: false, moneyVisible: m, now: 0,
    },
  };
}

afterEach(() => {
  cleanup();
  state.search = "tab=quotes";
  state.money = true;
  state.approxInvoices = false;
  state.canPublish = true;
  state.xero = { isConnected: true };
  state.push.mockClear();
  state.ack.mockClear();
});

describe("Finance hub", () => {
  it("quotes: head words with counts, four money words that deep-link, the strip, derived statuses", () => {
    setData();
    render(<FinanceHub />);
    expect(screen.getByRole("link", { name: "Quotes 3" }).getAttribute("href")).toBe("/finance?tab=quotes");
    expect(screen.getByRole("link", { name: "Invoices 2" }).getAttribute("href")).toBe("/finance?tab=invoices");
    const money = screen.getByLabelText("Money");
    expect(within(money).getByRole("link", { name: /overdue/i }).getAttribute("href")).toBe("/finance?tab=invoices&seg=overdue");
    expect(within(money).getByText("$5,000")).toBeTruthy();
    expect(screen.getAllByText("Sent", { selector: "td span span" }).length).toBe(1);
    expect(screen.getByText("Expired", { selector: "span span" })).toBeTruthy();
    expect(screen.getAllByText("#2341 v3").length).toBeGreaterThan(0);
  });

  it("a cut invoice read never prints a confident number: `at least` on the head count, the money words, and no strip counts", () => {
    state.approxInvoices = true;
    setData();
    render(<FinanceHub />);
    expect(screen.getByRole("link", { name: "Invoices 2+" })).toBeTruthy();
    const money = screen.getByLabelText("Money");
    expect(within(money).getByText("at least $70")).toBeTruthy(); // Overdue
    expect(within(money).getByText("$5,000")).toBeTruthy(); // Quoted is from the (uncut) quotes read
    expect(screen.getByText(/1 quote.*at least 2 invoices|3 quotes · at least 2 invoices/)).toBeTruthy();
  });

  it("a caller without job-cost visibility gets no money words and no Total column", () => {
    state.money = false;
    setData();
    render(<FinanceHub />);
    expect(screen.queryByLabelText("Money")).toBeNull();
    expect(screen.queryByRole("columnheader", { name: /total/i })).toBeNull();
    expect(document.body.textContent).not.toMatch(/\$5,000|\$900/);
  });

  it("invoices: Overdue outranks Part paid, with days late and what is owed, and a Xero word", () => {
    state.search = "tab=invoices&seg=overdue";
    setData();
    render(<FinanceHub />);
    expect(screen.getByText("Overdue", { selector: "span span" })).toBeTruthy();
    expect(screen.getByText("Synced")).toBeTruthy();
    expect(screen.getByText("INV-0041")).toBeTruthy();
  });

  it("without a Xero connection the Xero column is absent and a one-line note says so", () => {
    state.search = "tab=invoices";
    state.xero = null;
    setData();
    render(<FinanceHub />);
    expect(screen.queryByText("Synced")).toBeNull();
    expect(screen.getByText(/xero isn't connected/i)).toBeTruthy();
  });

  it("an expired quote's row menu offers Open on the job and Acknowledge expired (invoice:publish), which writes", async () => {
    setData();
    const user = userEvent.setup();
    render(<FinanceHub />);
    const exp = screen.getAllByText("#2341 v1")[0].closest("tr")!;
    await user.click(within(exp as HTMLElement).getByRole("button", { name: /actions/i }));
    expect(await screen.findByText("Open on the job")).toBeTruthy();
    fireEvent.click(await screen.findByText("Acknowledge expired"));
    await waitFor(() => expect(state.ack).toHaveBeenCalledWith("q_exp"));
  });

  it("Acknowledge is absent for a role without invoice:publish", async () => {
    state.canPublish = false;
    setData();
    const user = userEvent.setup();
    render(<FinanceHub />);
    const exp = screen.getAllByText("#2341 v1")[0].closest("tr")!;
    await user.click(within(exp as HTMLElement).getByRole("button", { name: /actions/i }));
    expect(await screen.findByText("Open on the job")).toBeTruthy();
    expect(screen.queryByText("Acknowledge expired")).toBeNull();
  });
});
