// @vitest-environment jsdom
import React from "react";
import { describe, it, expect, vi, beforeAll } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

beforeAll(() => {
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.setPointerCapture ??= () => {};
  Element.prototype.releasePointerCapture ??= () => {};
  Element.prototype.scrollIntoView ??= () => {};
});

const contacts = [
  { id: "ct1", name: "Sarah Chen", email: "sarah@example.com" },
  { id: "ct2", name: "Bob Smith", email: "bob@example.com" },
];

vi.mock("@/hooks/use-clients", () => ({
  useClientContacts: vi.fn(() => contacts),
}));

vi.mock("@/hooks/use-quote-writes", () => ({
  useQuoteWrites: vi.fn(() => ({
    send: vi.fn(),
    recall: vi.fn(),
    newVersion: vi.fn(),
    markAccepted: vi.fn(),
    markDeclined: vi.fn(),
    repriceFromRevision: vi.fn(),
  })),
}));

vi.mock("@/hooks/use-document-dates-config", () => ({
  useDocumentDatesConfig: vi.fn(() => ({
    isLoading: false,
    quoteValidityDays: 30,
    paymentTermsDays: 14,
    timezone: undefined,
  })),
}));

vi.mock("@/hooks/use-native-project-writes", () => ({
  useNativeProjectStatus: vi.fn(() => ({ updateStatus: vi.fn() })),
}));

import { SendQuoteDialog } from "@/components/projects/finance/send-quote-dialog";

/**
 * Regression coverage for the standing Radix/Base-UI-in-modal footgun class
 * (CLAUDE.md): a Base UI popup inside a Radix modal `Dialog` inherits the
 * dialog's `pointer-events: none` body lock and swallows every click. This
 * dialog's recipient field MUST be the Radix-based `combobox-picker.tsx` — this
 * test actually opens the send dialog AND the contact picker inside it, the
 * same class of regression `model-roi-tab.smoke.test.tsx` covers for
 * `TooltipProvider`. Typecheck/lint/build all pass on a broken version of this;
 * only rendering (and clicking) catches it.
 */
describe("SendQuoteDialog smoke", () => {
  const baseProps = {
    open: true,
    onOpenChange: vi.fn(),
    projectId: "p1",
    projectNumber: "RVLT-2026-0001",
    orgId: "org1",
    clientId: "c1",
    revision: 1,
    subtotal: 100,
    taxAmount: 10,
    total: 110,
    projectStatus: "QUOTING",
  };

  it("renders the send dialog without throwing", async () => {
    render(<SendQuoteDialog {...baseProps} />);
    await waitFor(() => expect(screen.getByText("Send quote v1")).toBeTruthy());
    expect(screen.getByText(/Flow doesn.t email clients/)).toBeTruthy();
  });

  it("opens the recipient contact picker and lists the client's contacts", async () => {
    const user = userEvent.setup();
    render(<SendQuoteDialog {...baseProps} />);

    const trigger = await screen.findByRole("button", { name: /select a contact/i });
    await user.click(trigger);

    // The popover content portals to document.body — findByText searches the
    // whole document, so this proves the click wasn't swallowed by the modal
    // Dialog's pointer-events lock.
    expect(await screen.findByText("Sarah Chen")).toBeTruthy();
    expect(await screen.findByText("Bob Smith")).toBeTruthy();

    await user.click(screen.getByText("Sarah Chen"));
    // Selecting closes the popover and shows the chosen contact on the trigger.
    await waitFor(() => expect(screen.getByText("Sarah Chen")).toBeTruthy());
  });

  it("has no monetary input anywhere in the form (R-9.3)", () => {
    render(<SendQuoteDialog {...baseProps} />);
    const numberInputs = document.querySelectorAll('input[type="number"]');
    // The only numeric input is "valid for (days)" — never a price/amount field.
    numberInputs.forEach((input) => {
      expect(input.id).toBe("quote-validity");
    });
  });
});
