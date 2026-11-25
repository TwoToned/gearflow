// @vitest-environment jsdom
//
// UX Phase 10 (spec §8b): the invoice row. The ⋯ is OPENED (CLAUDE.md: overlays
// are tested open, not just closed): `Issue…` lives only in the menu, never as a
// row button; `Record payment` and `Push to Xero` stay on the row; the status is
// ONE word with Overdue outranking Part paid (D56); Credit note… opens a dialog
// that calls the existing create-credit verb.
import React from "react";
import { describe, it, expect, vi, beforeAll } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

beforeAll(() => {
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.setPointerCapture ??= () => {};
  Element.prototype.releasePointerCapture ??= () => {};
  Element.prototype.scrollIntoView ??= () => {};
});

vi.mock("@/hooks/use-mobile", () => ({ useIsMobile: () => false }));
vi.mock("@/lib/use-permissions", () => ({ useCanDo: () => true, useIsOwner: () => true }));
vi.mock("@/hooks/use-authed-query", () => ({ useAuthedQuery: () => [] }));
vi.mock("@/server/xero", () => ({ pushInvoiceToXero: vi.fn() }));
vi.mock("@/server/finance-documents", () => ({ generateInvoiceArtifact: vi.fn() }));
const createCredit = vi.fn(async () => ({ id: "c1" }));
vi.mock("@/hooks/use-invoice-writes", () => ({ useInvoiceWrites: () => ({ createCredit }) }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() } }));

import { InvoiceRow, type InvoiceRowDoc } from "@/components/projects/finance/invoice-row";
import { CreditNoteDialog } from "@/components/projects/finance/credit-note-dialog";

const DAY = 86_400_000;
const NOW = Date.UTC(2026, 10, 24);

function renderRow(inv: Partial<InvoiceRowDoc>, over: Partial<React.ComponentProps<typeof InvoiceRow>> = {}) {
  const handlers = {
    onIssue: vi.fn(), onCreditRequest: vi.fn(), onDeleteDraft: vi.fn(), onVoidRequest: vi.fn(),
    onDeleteVoidRequest: vi.fn(), onRecordPaymentRequest: vi.fn(), onVoidPaymentRequest: vi.fn(),
  };
  const invoice: InvoiceRowDoc = { id: "i1", status: "ISSUED", kind: "FULL", invoiceNumber: "INV-0041", total: 1000, issuedAt: NOW - 20 * DAY, dueDate: NOW + 5 * DAY, ...inv };
  render(
    <ul>
      <InvoiceRow invoice={invoice} projectId="p1" orgId="o1" xeroLinked now={NOW} hasCreditNote={false} {...handlers} {...over} />
    </ul>,
  );
  return handlers;
}

describe("InvoiceRow", () => {
  it("a draft has no Issue button on the row; Issue… is inside the opened ⋯", async () => {
    const user = userEvent.setup();
    const h = renderRow({ status: "DRAFT", invoiceNumber: undefined, issuedAt: undefined, dueDate: undefined });
    expect(screen.queryByRole("button", { name: /^Issue/ })).toBeNull();
    await user.click(screen.getByRole("button", { name: /actions/i }));
    await user.click(await screen.findByRole("menuitem", { name: /Issue…/ }));
    expect(h.onIssue).toHaveBeenCalledTimes(1);
  });

  it("an issued invoice keeps Record payment and Push to Xero on the row and offers Credit note… and Void in ⋯", async () => {
    const user = userEvent.setup();
    const h = renderRow({});
    expect(screen.getByRole("button", { name: /Record payment/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Push to Xero/ })).toBeTruthy();
    await user.click(screen.getByRole("button", { name: /actions/i }));
    const menu = await screen.findByRole("menu");
    expect(within(menu).getByRole("menuitem", { name: /Credit note…/ })).toBeTruthy();
    expect(within(menu).getByRole("menuitem", { name: /Void invoice/ })).toBeTruthy();
    expect(within(menu).queryByRole("menuitem", { name: /Record payment|Push to Xero|Issue/ })).toBeNull();
    await user.click(within(menu).getByRole("menuitem", { name: /Credit note…/ }));
    expect(h.onCreditRequest).toHaveBeenCalledTimes(1);
  });

  it("shows ONE status word: Overdue outranks Part paid once past due (D56), with the days overdue", () => {
    renderRow({ paymentStatus: "PARTIALLY_PAID", amountPaid: 100, dueDate: NOW - 3 * DAY });
    expect(screen.getByText("Overdue")).toBeTruthy();
    expect(screen.queryByText("Part paid")).toBeNull();
    expect(screen.getByText(/3 days overdue/)).toBeTruthy();
  });

  it("reads Part paid before the due day", () => {
    renderRow({ paymentStatus: "PARTIALLY_PAID", amountPaid: 100 });
    expect(screen.getByText("Part paid")).toBeTruthy();
    expect(screen.getByText(/Balance \$900\.00/)).toBeTruthy();
  });

  it("the stored document is a download of the stored bytes, never a live render", () => {
    renderRow({ pdfFileId: "f1" });
    expect(screen.getByRole("link", { name: /Document/ }).getAttribute("href")).toBe("/api/finance/invoice/i1/pdf");
  });
});

describe("CreditNoteDialog", () => {
  it("opens, creates the draft credit through the existing verb with trimmed notes, and closes", async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();
    render(<CreditNoteDialog open onOpenChange={onOpenChange} invoiceId="i1" invoiceNumber="INV-0041" total={1000} />);
    expect(screen.getByRole("heading", { name: /Credit INV-0041/ })).toBeTruthy();
    await user.type(screen.getByLabelText(/Notes/), "  wrong rate  ");
    await user.click(screen.getByRole("button", { name: /Create credit note/ }));
    await waitFor(() => expect(createCredit).toHaveBeenCalledWith("i1", "wrong rate"));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});
