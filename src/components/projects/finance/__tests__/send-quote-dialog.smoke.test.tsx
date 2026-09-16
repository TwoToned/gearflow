// @vitest-environment jsdom
import React from "react";
import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
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

// Named so the #1233 targetVersion tests below can assert on the arguments
// `SendQuoteDialog` calls it with (the third, `versionId`, in particular).
const sendMock = vi.fn(async (_projectId: string, _data: unknown, _versionId?: string) => ({
  id: "qnew",
  version: 2,
  validUntil: 4102444800000,
  offerStatusChange: null,
}));

vi.mock("@/hooks/use-quote-writes", () => ({
  useQuoteWrites: vi.fn(() => ({
    send: sendMock,
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

/**
 * #1233 (Phase 6) UI follow-up — `targetVersion` makes this SAME dialog send
 * a NON-live `projectVersions` row's quote instead of the live version's,
 * with a label/copy that can never be confused with the live branch's own
 * "v{N}" (a different counter — a quote-revision number, FEATUREDOCS/78).
 * `targetVersion` omitted (every test above) stays byte-identical to
 * pre-follow-up behaviour — this block only covers what's NEW.
 */
describe("SendQuoteDialog — targetVersion (non-live send, #1233 UI follow-up)", () => {
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
  const TARGET_VERSION = { id: "pv7", number: 7, label: "Budget option" };

  beforeEach(() => {
    sendMock.mockClear();
  });

  it("titles itself by the PROJECT version, not the quote-revision counter", async () => {
    render(<SendQuoteDialog {...baseProps} targetVersion={TARGET_VERSION} />);
    expect(await screen.findByRole("heading", { name: /send v7.s quote/i })).toBeTruthy();
    // Never the live branch's revision-number title while targeting a version.
    expect(screen.queryByText(/send quote v1\b/i)).toBeNull();
  });

  it("never offers the live-only preview link (it always renders the LIVE project, #987)", async () => {
    render(<SendQuoteDialog {...baseProps} targetVersion={TARGET_VERSION} />);
    await screen.findByRole("heading", { name: /send v7.s quote/i });
    expect(screen.queryByRole("link", { name: /preview draft/i })).toBeNull();
  });

  it("does not print the live project's own totals under a 'Summary' heading for a different version", async () => {
    render(<SendQuoteDialog {...baseProps} targetVersion={TARGET_VERSION} />);
    await screen.findByRole("heading", { name: /send v7.s quote/i });
    expect(screen.queryByText("Summary")).toBeNull();
    expect(screen.queryByText("$110.00")).toBeNull();
  });

  it("threads targetVersion.id to useQuoteWrites().send() as the versionId argument", async () => {
    const user = userEvent.setup();
    render(<SendQuoteDialog {...baseProps} targetVersion={TARGET_VERSION} />);
    await user.click(screen.getByRole("button", { name: /^send v7.s quote$/i }));
    await waitFor(() => expect(sendMock).toHaveBeenCalledTimes(1));
    expect(sendMock.mock.calls[0][2]).toBe("pv7");
  });

  it("the post-send handover never claims pricing is now locked (only a LIVE send locks it, D55)", async () => {
    const user = userEvent.setup();
    render(<SendQuoteDialog {...baseProps} targetVersion={TARGET_VERSION} />);
    await user.click(screen.getByRole("button", { name: /^send v7.s quote$/i }));
    expect(await screen.findByText(/v7.s quote sent/i)).toBeTruthy();
    expect(screen.queryByText(/pricing is now locked/i)).toBeNull();
    expect(screen.getByText(/stays fully editable/i)).toBeTruthy();
  });

  it("live send (targetVersion omitted) keeps its own pre-follow-up copy unchanged", async () => {
    const user = userEvent.setup();
    render(<SendQuoteDialog {...baseProps} />);
    expect(screen.getByRole("link", { name: /preview draft/i })).toBeTruthy();
    await user.click(screen.getByRole("button", { name: /^send quote$/i }));
    // `sendMock` resolves `version: 2` regardless of caller — the handover
    // title reads the RESULT's own version number, same as pre-follow-up.
    expect(await screen.findByRole("heading", { name: /quote v2 sent/i })).toBeTruthy();
    expect(screen.getByText(/pricing is now locked/i)).toBeTruthy();
  });
});
