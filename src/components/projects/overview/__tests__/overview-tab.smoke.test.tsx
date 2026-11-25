// @vitest-environment jsdom
//
// UX Phase 7, slice B: the job Overview (§6b). Rendered with real rules and
// real derivations; only the reads and the heavy dialogs are stubbed. Every
// overlay is OPENED, not just rendered closed (CLAUDE.md): `+ Invoice ▾`,
// Send quote / Record accept, Record payment, All revisions, All invoices, the
// PM editor, and the readiness `and n more ›` expander.
import React from "react";
import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import { render, screen, cleanup, within, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { getFunctionName } from "convex/server";

beforeAll(() => {
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.setPointerCapture ??= () => {};
  Element.prototype.releasePointerCapture ??= () => {};
  Element.prototype.scrollIntoView ??= () => {};
});

const push = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, replace: vi.fn() }),
  usePathname: () => "/projects/p1",
  useSearchParams: () => new URLSearchParams("tab=overview"),
}));
vi.mock("next/link", () => ({
  default: ({ href, children, ...p }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...p}>
      {children}
    </a>
  ),
}));
vi.mock("@/components/auth/permission-gate", () => ({ CanDo: ({ children }: { children: React.ReactNode }) => <>{children}</> }));

const NOW = Date.UTC(2026, 10, 9);
let reads: Record<string, unknown> = {};
const queryCalls: string[] = [];
vi.mock("@/hooks/use-authed-query", () => ({
  useAuthedQuery: (ref: Parameters<typeof getFunctionName>[0], args: unknown) => {
    const name = getFunctionName(ref);
    queryCalls.push(name);
    return args === "skip" ? undefined : reads[name];
  },
}));
const conflictsQuery = vi.fn(async () => [] as unknown[]);
vi.mock("convex/react", async () => {
  const actual = await vi.importActual<typeof import("convex/react")>("convex/react");
  return { ...actual, useConvex: () => ({ query: conflictsQuery }), useConvexAuth: () => ({ isAuthenticated: true, isLoading: false }) };
});
let canSeeActivity = true;
vi.mock("@/hooks/use-nav-items", () => ({
  useNavItems: () => ({ byKey: (k: string) => (k === "activity" && canSeeActivity ? { key: "activity" } : undefined) }),
}));
vi.mock("@/hooks/use-stable-now", () => ({ useStableNow: () => NOW }));
vi.mock("@/hooks/use-invoice-writes", () => ({ useInvoiceWrites: () => ({ create: vi.fn(async () => {}) }) }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

// Heavy dialogs have their own tests; stubs prove they open.
const { stub } = vi.hoisted(() => ({
  stub:
    (id: string) =>
    ({ open }: { open: boolean }) =>
      open ? React.createElement("div", { "data-testid": id }) : null,
}));
vi.mock("@/components/projects/finance/send-quote-dialog", () => ({ SendQuoteDialog: stub("send-quote") }));
vi.mock("@/components/projects/finance/accept-quote-dialog", () => ({ AcceptQuoteDialog: stub("accept-quote") }));
vi.mock("@/components/projects/finance/quote-manager-dialog", () => ({ QuoteManagerDialog: stub("quote-manager") }));
vi.mock("@/components/projects/finance/create-partial-invoice-dialog", () => ({ CreatePartialInvoiceDialog: stub("partial-invoice") }));
vi.mock("@/components/projects/finance/record-payment-dialog", () => ({ RecordPaymentDialog: stub("record-payment") }));
vi.mock("@/components/projects/finance/invoice-manager-dialog", () => ({ InvoiceManagerDialog: stub("invoice-manager") }));
vi.mock("@/components/projects/project-managers-panel", () => ({ ProjectManagersPanel: () => <div data-testid="pm-panel" /> }));

import { OverviewTab, type OverviewTabProject } from "@/components/projects/overview/overview-tab";

const crew = (over: Record<string, unknown> = {}) => ({
  unconfirmedCount: 2, activeCount: 5, servicesMissingCrew: [], crewShortfall: 0, unconfirmedServices: [], activeServiceCount: 0, ...over,
});
function readiness(over: Record<string, unknown> = {}) {
  return {
    hasWindow: true,
    window: { start: NOW, end: NOW + 2 * 86_400_000 },
    gear: { hard: [], pencilled: [], hardQty: 0, pencilledQty: 0 },
    crew: crew(),
    pricing: { unpriced: [{ id: "l1", label: "Truss bracket", kind: "LINE" }], unpricedCount: 1 },
    packing: { totalCount: 4, notPlannedCount: 1 },
    incidents: { openCount: 1, truncated: false },
    ...over,
  };
}

const SENT_QUOTE = { id: "q3", version: 3, status: "SENT", sentAt: NOW - 86_400_000, validUntil: NOW + 20 * 86_400_000, snapshotId: null };
const ISSUED = { id: "i1", kind: "DEPOSIT", status: "ISSUED", invoiceNumber: "INV-0041", total: 5000, amountPaid: 0, issuedAt: NOW - 86_400_000 };

function setReads(over: Record<string, unknown> = {}) {
  reads = {
    "projectReadiness:forProject": readiness(),
    "collaboration:getProjectBlockingSummary": { count: 1 },
    "quotes:revisionStateForProject": { revision: 3, liveQuote: SENT_QUOTE },
    "quotes:listForProject": [{ id: "q3", snapshot: { total: 23880 }, pdfFileId: "f1" }],
    "invoices:listForProject": [ISSUED],
    "clients:getById": { name: "Hilton", profileDepositPercent: 25 },
    "activityLog:recentForProject": { items: [{ id: "a1", userName: "Mel", summary: "recorded a payment", createdAt: NOW - 3_600_000 }] },
    ...over,
  };
}

const PROJECT: OverviewTabProject = {
  projectNumber: "#2341",
  status: "CONFIRMED",
  clientId: "c1",
  client: { id: "c1", name: "Hilton" },
  total: 23880,
  subtotal: 21709,
  taxAmount: 2171,
  rentalStartDate: "2026-11-12T00:00:00",
  rentalEndDate: "2026-11-14T00:00:00",
  location: { name: "Hilton Sydney · Grand Ballroom", address: "488 George St", latitude: -33.8, longitude: 151.2 },
  siteContactName: "Priya Shah",
  siteContactPhone: "0412 555 019",
  siteContactEmail: "priya@hilton.example",
  projectManagers: [{ userId: "u1", user: { id: "u1", name: "Jayden Cole", email: "j@x", image: null } }],
};

function setup(over: Partial<OverviewTabProject> = {}, isTemplate = false) {
  const onOpenTab = vi.fn();
  const onOpenDiscussion = vi.fn();
  render(
    <OverviewTab projectId="p1" orgId="org1" project={{ ...PROJECT, ...over }} isTemplate={isTemplate} onOpenTab={onOpenTab} onOpenDiscussion={onOpenDiscussion} />,
  );
  return { onOpenTab, onOpenDiscussion };
}

beforeEach(() => {
  cleanup();
  push.mockReset();
  queryCalls.length = 0;
  conflictsQuery.mockClear();
  canSeeActivity = true;
  setReads();
});

describe("Overview › readiness", () => {
  it("leads with the blocking discussion, links to it, and lists the rest worst first", async () => {
    const user = userEvent.setup();
    const { onOpenDiscussion, onOpenTab } = setup();
    const section = screen.getByRole("region", { name: "Readiness" });
    expect(within(section).getByRole("heading", { name: "Prep is held" })).toBeTruthy();
    expect(section.textContent).toContain("1 blocking discussion holds prep. Prep and dispatch are held until it is resolved.");
    await user.click(within(section).getByRole("button", { name: "Open the discussion ›" }));
    expect(onOpenDiscussion).toHaveBeenCalled();

    const rows = within(section).getByRole("list", { name: "Things to sort" });
    // crew, pricing, packing shown; incidents behind "and 1 more".
    expect(within(rows).getAllByRole("button").map((b) => b.textContent)).toEqual([
      expect.stringContaining("2 of 5 crew unconfirmed"),
      expect.stringContaining("1 line item unpriced"),
      expect.stringContaining("1 of 4 lines not planned"),
      "and 1 more ›",
    ]);
    await user.click(within(rows).getByRole("button", { name: /2 of 5 crew unconfirmed/ }));
    expect(onOpenTab).toHaveBeenCalledWith("labour");

    await user.click(within(rows).getByRole("button", { name: "and 1 more ›" }));
    await user.click(within(rows).getByRole("button", { name: /1 open incident on this job's gear/ }));
    expect(push).toHaveBeenCalledWith("/warehouse/p1");
    expect(within(rows).getByRole("button", { name: "show fewer" })).toBeTruthy();
  });

  it("double-booking is checked ONCE (one-shot), and a failed check reads as not checked", async () => {
    conflictsQuery.mockRejectedValueOnce(new Error("boom"));
    setup();
    await waitFor(() => expect(conflictsQuery).toHaveBeenCalledTimes(1));
    const section = screen.getByRole("region", { name: "Readiness" });
    await waitFor(() => expect(section.textContent).not.toContain("No assets double-booked"));
    expect(queryCalls).not.toContain("reservationConflicts:projectConflicts");
    expect(queryCalls).not.toContain("maintenanceRecords:list");
  });

  it("all clear reads Ready for prep with the clear checks named", async () => {
    setReads({
      "projectReadiness:forProject": readiness({ crew: crew({ unconfirmedCount: 0 }), pricing: { unpriced: [], unpricedCount: 0 }, packing: { totalCount: 0, notPlannedCount: 0 }, incidents: { openCount: 0, truncated: false } }),
      "collaboration:getProjectBlockingSummary": { count: 0 },
    });
    setup();
    const section = screen.getByRole("region", { name: "Readiness" });
    await waitFor(() => expect(within(section).getByRole("heading", { name: "Ready for prep" })).toBeTruthy());
    expect(section.textContent).toContain("No assets double-booked");
  });

  it("from Out onward it is one state sentence, with failing incidents and discussions under it", () => {
    setup({ status: "CHECKED_OUT" });
    const section = screen.getByRole("region", { name: "Readiness" });
    expect(within(section).getByRole("heading").textContent).toBe("Out — the gear has left the warehouse.");
    const rows = within(section).getAllByRole("button").map((b) => b.textContent);
    // Past prep the discussion row no longer claims to hold prep.
    expect(rows).toEqual([expect.stringContaining("1 blocking discussion open"), expect.stringContaining("1 open incident")]);
    expect(section.textContent).not.toContain("holds prep");
    expect(section.textContent).not.toContain("crew unconfirmed");
  });

  it("a template has no readiness, money or recent activity", () => {
    setup({}, true);
    expect(screen.queryByRole("region", { name: "Readiness" })).toBeNull();
    expect(screen.queryByRole("region", { name: "Money" })).toBeNull();
    expect(screen.queryByRole("region", { name: "Recent activity" })).toBeNull();
    expect(screen.getByRole("region", { name: "When, where and who" })).toBeTruthy();
  });
});

describe("Overview › money lines", () => {
  it("the quote line states the frozen amount and where it stands; Record accept, PDF and All revisions open", async () => {
    const user = userEvent.setup();
    const { onOpenTab } = setup();
    const money = screen.getByRole("region", { name: "Money" });
    expect(money.textContent).toContain("$23,880.00 inc GST");
    expect(money.textContent).toMatch(/v3 sent .* · valid until /);
    expect(within(money).getByRole("link", { name: "PDF" }).getAttribute("href")).toBe("/api/finance/quote/q3/pdf");
    await user.click(within(money).getByRole("button", { name: "Record accept" }));
    expect(screen.getByTestId("accept-quote")).toBeTruthy();
    await user.click(within(money).getByRole("button", { name: "All revisions" }));
    expect(screen.getByTestId("quote-manager")).toBeTruthy();
    await user.click(within(money).getAllByRole("button", { name: "Finance ›" })[0]);
    expect(onOpenTab).toHaveBeenCalledWith("finance");
  });

  it("prints to the cent, as the stored PDF does: a sent $1,240.50 never rounds", () => {
    setReads({ "quotes:listForProject": [{ id: "q3", snapshot: { total: 1240.5 }, pdfFileId: "f1" }] });
    setup();
    expect(screen.getByRole("region", { name: "Money" }).textContent).toContain("$1,240.50 inc GST");
  });

  it("a sub-dollar outstanding prints $0.40; a fully paid job prints $0.00 outstanding and why nothing more can be raised", () => {
    setReads({ "invoices:listForProject": [{ ...ISSUED, total: 23880, amountPaid: 23879.6 }] });
    setup();
    expect(screen.getByRole("region", { name: "Money" }).textContent).toContain("$0.40 outstanding");
    cleanup();
    setReads({ "invoices:listForProject": [{ ...ISSUED, total: 23880, amountPaid: 23880 }] });
    setup();
    const money = screen.getByRole("region", { name: "Money" }).textContent;
    expect(money).toContain("Paid in full · $0.00 outstanding");
    expect(money).toContain("Fully invoiced");
  });

  it("nothing raised says so with the client's partial default, as the card did", () => {
    setReads({ "invoices:listForProject": [] });
    setup();
    expect(screen.getByRole("region", { name: "Money" }).textContent).toContain(
      "Not started · Hilton's partial invoices default to 25%. Nothing raised yet.",
    );
  });

  it("a never-sent quote offers Send quote", async () => {
    const user = userEvent.setup();
    setReads({ "quotes:revisionStateForProject": { revision: 1, liveQuote: null }, "quotes:listForProject": [] });
    setup();
    const money = screen.getByRole("region", { name: "Money" });
    expect(money.textContent).toContain("v1 · not sent yet");
    await user.click(within(money).getByRole("button", { name: "Send quote" }));
    expect(screen.getByTestId("send-quote")).toBeTruthy();
  });

  it("the invoicing line says what the derivation says; + Invoice ▾ opens, and so do Record payment and All invoices", async () => {
    const user = userEvent.setup();
    setup();
    const money = screen.getByRole("region", { name: "Money" });
    expect(money.textContent).toContain(
      "Awaiting payment · $5,000.00 outstanding · $5,000.00 invoiced to date · $18,880.00 not yet raised",
    );
    expect(money.textContent).toContain("Last: INV-0041 deposit issued");

    await user.click(within(money).getByRole("button", { name: "+ Invoice ▾" }));
    await user.click(await screen.findByRole("menuitem", { name: "Partial balance…" }));
    expect(screen.getByTestId("partial-invoice")).toBeTruthy();

    await user.click(within(money).getByRole("button", { name: "Record payment" }));
    expect(screen.getByTestId("record-payment")).toBeTruthy();
    await user.click(within(money).getByRole("button", { name: "All invoices" }));
    expect(screen.getByTestId("invoice-manager")).toBeTruthy();
  });

  it("no client: says what to fix instead of an invoicing line", () => {
    setup({ clientId: null, client: null });
    expect(screen.getByRole("region", { name: "Money" }).textContent).toContain("Assign a client to this job to raise quotes and invoices.");
  });
});

describe("Overview › When · Where · Who · Recent", () => {
  it("shows the facts; Edit goes to the edit page; the PM editor opens; Recent links out", async () => {
    const user = userEvent.setup();
    const { onOpenTab, onOpenDiscussion } = setup();
    const facts = screen.getByRole("region", { name: "When, where and who" });
    expect(facts.textContent).toContain("12 Nov – 14 Nov · 3 days");
    expect(facts.textContent).toContain("Hilton Sydney · Grand Ballroom");
    expect(facts.textContent).toContain("Priya Shah");
    expect(facts.textContent).toContain("PM Jayden Cole");
    expect(facts.textContent).toContain("2 unconfirmed");
    // Both open the edit sheet in place (?edit=1), keeping the current tab.
    await user.click(within(facts).getByRole("button", { name: "Edit dates" }));
    expect(push).toHaveBeenLastCalledWith("/projects/p1?tab=overview&edit=1");
    await user.click(within(facts).getByRole("button", { name: "Edit" }));
    expect(push).toHaveBeenLastCalledWith("/projects/p1?tab=overview&edit=1");
    expect(within(facts).getByRole("link", { name: "directions" }).getAttribute("href")).toContain("google.com/maps");
    expect(within(facts).getByRole("link", { name: "priya@hilton.example" }).getAttribute("href")).toBe("mailto:priya@hilton.example");

    await user.click(within(facts).getByRole("button", { name: "Edit job managers" }));
    expect(screen.getByTestId("pm-panel")).toBeTruthy();
    await user.click(within(facts).getAllByRole("button", { name: "Logistics ›" })[0]);
    expect(onOpenTab).toHaveBeenCalledWith("labour");

    const recent = screen.getByRole("region", { name: "Recent activity" });
    expect(recent.textContent).toContain("Mel recorded a payment");
    expect(within(recent).getByRole("link", { name: "All activity ›" }).getAttribute("href")).toBe("/activity?entityType=project&entityId=p1");
    await user.click(within(recent).getByRole("button", { name: "Discussion ›" }));
    expect(onOpenDiscussion).toHaveBeenCalled();
  });

  it("Recent reads the BOUNDED audit-log query; All activity › is absent when the user can't open /activity", () => {
    canSeeActivity = false;
    setup();
    expect(queryCalls).toContain("activityLog:recentForProject");
    expect(queryCalls).not.toContain("activityLog:listByEntity");
    const recent = screen.getByRole("region", { name: "Recent activity" });
    expect(within(recent).queryByRole("link", { name: "All activity ›" })).toBeNull();
    expect(within(recent).getByRole("button", { name: "Discussion ›" })).toBeTruthy();
  });

  it("the old tiles are gone", () => {
    setup();
    for (const label of ["Equipment", "Services", "Crew", "Total"]) {
      expect(screen.queryByText(label, { selector: ".t-overline" })).toBeNull();
    }
  });
});
