// @vitest-environment jsdom
//
// #1233 (Phase 6) UI follow-up — the ONE thing this follow-up adds: a
// version-aware "Send quote" trigger on `ProjectQuoteRail` (the Finance
// tab), plus never hiding a second SENT quote on another version (D19).
// Mirrors `model-roi-tab.smoke.test.tsx`'s pattern (CLAUDE.md): this
// actually RENDERS the rail and OPENS the send dialog rather than snapshotting
// a closed state, the same discipline `send-quote-dialog.smoke.test.tsx` and
// `make-live-dialog.smoke.test.tsx` already use for this Finance-tab surface.
//
// `ProjectQuoteRail` itself stays context-free — it takes `versionContext` as
// a plain prop (see the file's own doc) — so this test drives it directly
// with an explicit `versionContext` rather than mounting the whole page's
// `ProjectVersionProvider`. `versionContext` omitted/absent is exactly what
// the Overview tab's `QuoteCard`/`QuoteManagerDialog` do today, so the "no
// versionContext" cases below double as the regression guard that those
// embed sites keep their exact pre-follow-up behaviour.
import React from "react";
import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { FunctionReference } from "convex/server";

beforeAll(() => {
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.setPointerCapture ??= () => {};
  Element.prototype.releasePointerCapture ??= () => {};
  Element.prototype.scrollIntoView ??= () => {};
});

interface QuoteFixture {
  id: string;
  version: number;
  effectiveStatus: string;
  versionId?: string;
  sentAt?: number;
  label?: string;
}

interface RevisionStateFixture {
  revision: number;
  liveRevision: number;
  hasAcceptedQuote: boolean;
  draftQuoteId: string | null;
  liveQuote: { id: string; version: number; status: string; sentAt: number | null; validUntil: number | null; snapshotId: string | null } | null;
}

let quotesFixture: QuoteFixture[] = [];
let revisionStateFixture: RevisionStateFixture | null = null;

vi.mock("@/hooks/use-authed-query", async () => {
  const { getFunctionName } = await import("convex/server");
  return {
    useAuthedQuery: (query: FunctionReference<"query">, args: unknown) => {
      if (args === "skip") return undefined;
      const name = getFunctionName(query);
      if (name === "quotes:listForProject") return quotesFixture;
      if (name === "quotes:revisionStateForProject") return revisionStateFixture;
      // projectLocksRead.snapshotEntries/currentEntries (InlineQuoteDrift) —
      // every fixture below sets `snapshotId: null`, so that component
      // already bails out before subscribing to these; returning undefined
      // for anything else keeps the mock total.
      return undefined;
    },
  };
});

const sendMock = vi.fn();
vi.mock("@/hooks/use-quote-writes", () => ({
  useQuoteWrites: () => ({
    send: sendMock,
    recall: vi.fn(),
    newVersion: vi.fn(),
    markAccepted: vi.fn(),
    markDeclined: vi.fn(),
    deleteRecalled: vi.fn(),
    setLabel: vi.fn(),
  }),
}));

vi.mock("@/server/finance-documents", () => ({
  generateQuoteArtifact: vi.fn(async () => {}),
}));

vi.mock("@/lib/use-permissions", () => ({
  useCanDo: () => true,
  useIsOwner: () => true,
  useIsViewer: () => false,
}));

vi.mock("@/hooks/use-clients", () => ({
  useClientContacts: () => [],
}));

vi.mock("@/hooks/use-document-dates-config", () => ({
  useDocumentDatesConfig: () => ({ isLoading: false, quoteValidityDays: 30, paymentTermsDays: 14, timezone: undefined }),
}));

vi.mock("@/hooks/use-native-project-writes", () => ({
  useNativeProjectStatus: () => ({ updateStatus: vi.fn() }),
}));

import { ProjectQuoteRail } from "@/components/projects/project-quote-rail";

const V1 = { id: "pv1", number: 1 };
const V2 = { id: "pv2", number: 2 };

const baseProps = {
  projectId: "p1",
  orgId: "org1",
  projectNumber: "RVLT-2026-0001",
  clientId: "c1",
  projectStatus: "QUOTING",
  subtotal: 100,
  taxAmount: 10,
  total: 110,
};

beforeEach(() => {
  vi.clearAllMocks();
  sendMock.mockResolvedValue({ id: "qnew", version: 3, validUntil: 4102444800000, offerStatusChange: null });
});

describe("ProjectQuoteRail — no versionContext (Overview's QuoteCard/QuoteManagerDialog embed)", () => {
  it("keeps the pre-follow-up 'Send quote vN' header exactly as it was", async () => {
    quotesFixture = [];
    revisionStateFixture = { revision: 1, liveRevision: 1, hasAcceptedQuote: false, draftQuoteId: null, liveQuote: null };
    render(<ProjectQuoteRail {...baseProps} />);
    await waitFor(() => expect(screen.getByRole("button", { name: /send quote v1/i })).toBeTruthy());
    // Never the version-aware label when there's no version context at all.
    expect(screen.queryByText(/send v\d+.s quote/i)).toBeNull();
  });
});

describe("ProjectQuoteRail — viewing the LIVE version via versionContext.viewing: null", () => {
  it("behaves identically to versionContext being omitted", async () => {
    quotesFixture = [];
    revisionStateFixture = { revision: 1, liveRevision: 1, hasAcceptedQuote: false, draftQuoteId: null, liveQuote: null };
    render(<ProjectQuoteRail {...baseProps} versionContext={{ versions: [V1], viewing: null }} />);
    await waitFor(() => expect(screen.getByRole("button", { name: /send quote v1/i })).toBeTruthy());
  });
});

describe("ProjectQuoteRail — viewing a non-live version (#1233 UI follow-up)", () => {
  it("offers \"Send v{N}'s quote\", version-labelled so it's never ambiguous with the quote-revision counter, and targets that version on send", async () => {
    quotesFixture = [];
    revisionStateFixture = { revision: 1, liveRevision: 1, hasAcceptedQuote: false, draftQuoteId: null, liveQuote: null };
    const user = userEvent.setup();
    render(<ProjectQuoteRail {...baseProps} versionContext={{ versions: [V1, V2], viewing: V2 }} />);

    // The live-only header verbs must NOT appear while viewing non-live.
    expect(screen.queryByRole("button", { name: /send quote v/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /create quote v/i })).toBeNull();

    const sendBtn = await screen.findByRole("button", { name: /send v2.s quote/i });
    await user.click(sendBtn);

    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByRole("heading", { name: /send v2.s quote/i })).toBeTruthy();
    // #987 — the sanctioned preview path always renders the LIVE project;
    // offering it here would silently preview the WRONG version's figures
    // under a "preview" label, so it must be absent, not just re-pointed.
    expect(within(dialog).queryByRole("link", { name: /preview draft/i })).toBeNull();
    // No new render/regeneration path either — the pre-send "Summary" figures
    // are omitted rather than shown under the live project's own numbers.
    expect(within(dialog).queryByText("Summary")).toBeNull();

    await user.click(within(dialog).getByRole("button", { name: /^send v2.s quote$/i }));

    await waitFor(() => expect(sendMock).toHaveBeenCalledTimes(1));
    const [calledProjectId, , calledVersionId] = sendMock.mock.calls[0];
    expect(calledProjectId).toBe("p1");
    expect(calledVersionId).toBe("pv2");
  });

  it("offers no header Send button once the viewed version already has a non-draft quote (recall first, same as the live branch)", async () => {
    quotesFixture = [{ id: "q2", version: 2, effectiveStatus: "SENT", versionId: "pv2", sentAt: 2000 }];
    revisionStateFixture = { revision: 2, liveRevision: 1, hasAcceptedQuote: false, draftQuoteId: null, liveQuote: null };
    render(<ProjectQuoteRail {...baseProps} versionContext={{ versions: [V1, V2], viewing: V2 }} />);
    await waitFor(() => expect(screen.getByText("SENT")).toBeTruthy());
    expect(screen.queryByRole("button", { name: /send v2.s quote/i })).toBeNull();
  });

  it("still offers Send when the viewed version's only prior quote was recalled back to DRAFT", async () => {
    quotesFixture = [{ id: "q2", version: 2, effectiveStatus: "DRAFT", versionId: "pv2", sentAt: 900 }];
    revisionStateFixture = { revision: 2, liveRevision: 1, hasAcceptedQuote: false, draftQuoteId: null, liveQuote: null };
    render(<ProjectQuoteRail {...baseProps} versionContext={{ versions: [V1, V2], viewing: V2 }} />);
    await waitFor(() => expect(screen.getByRole("button", { name: /send v2.s quote/i })).toBeTruthy());
  });
});

describe("ProjectQuoteRail — multiple simultaneously-SENT quotes across versions (D19)", () => {
  it("surfaces a banner and tags each row with its own project version — nothing hidden", async () => {
    quotesFixture = [
      { id: "q1", version: 1, effectiveStatus: "SENT", versionId: "pv1", sentAt: 1000 },
      { id: "q2", version: 2, effectiveStatus: "SENT", versionId: "pv2", sentAt: 2000 },
    ];
    revisionStateFixture = {
      revision: 2,
      liveRevision: 1,
      hasAcceptedQuote: false,
      draftQuoteId: null,
      liveQuote: { id: "q1", version: 1, status: "SENT", sentAt: 1000, validUntil: null, snapshotId: null },
    };
    render(<ProjectQuoteRail {...baseProps} versionContext={{ versions: [V1, V2], viewing: null }} />);

    await waitFor(() => expect(screen.getByText(/2 quotes are currently with the client at once/i)).toBeTruthy());
    // Both rows render (project-scoped list, not version-scoped — R-3.1, no
    // new query) and each carries its OWN project-version tag.
    expect(screen.getByText("for project version 1")).toBeTruthy();
    expect(screen.getByText("for project version 2")).toBeTruthy();
  });

  it("shows no banner and no version tags in the common single-quote, single-version case", async () => {
    quotesFixture = [{ id: "q1", version: 1, effectiveStatus: "SENT", versionId: "pv1", sentAt: 1000 }];
    revisionStateFixture = {
      revision: 1,
      liveRevision: 1,
      hasAcceptedQuote: false,
      draftQuoteId: null,
      liveQuote: { id: "q1", version: 1, status: "SENT", sentAt: 1000, validUntil: null, snapshotId: null },
    };
    render(<ProjectQuoteRail {...baseProps} />);
    await waitFor(() => expect(screen.getByText("SENT")).toBeTruthy());
    expect(screen.queryByText(/quotes are currently with the client at once/i)).toBeNull();
    expect(screen.queryByText(/for project version/i)).toBeNull();
  });
});
