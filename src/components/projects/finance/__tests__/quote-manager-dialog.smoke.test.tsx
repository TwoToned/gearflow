// @vitest-environment jsdom
import React from "react";
import { describe, it, expect, vi, beforeAll } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

beforeAll(() => {
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.setPointerCapture ??= () => {};
  Element.prototype.releasePointerCapture ??= () => {};
  Element.prototype.scrollIntoView ??= () => {};
});

// `ProjectQuoteRail` self-queries via `useAuthedQuery` — no Convex provider
// exists in this render, so every call is mocked to the "still loading" shape
// it already handles. This proves the Dialog-in-Dialog composition
// (invoices manager modal work) mounts and unmounts without throwing, the
// same class of regression `send-quote-dialog.smoke.test.tsx` covers for its
// own contact picker.
vi.mock("@/hooks/use-authed-query", () => ({
  useAuthedQuery: vi.fn(() => undefined),
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

// Cuts the transitive `@/server/finance-documents` → `@/lib/prisma` import
// chain — a unit test shouldn't need the generated Prisma client just to
// render a component that only calls this on a button click.
vi.mock("@/server/finance-documents", () => ({
  generateQuoteArtifact: vi.fn(),
  generateInvoiceArtifact: vi.fn(),
}));

// `useCanDo`/`useIsOwner` ultimately read RBAC out of Prisma (permissions
// live there, never Convex) — cuts that chain too, same reasoning as above.
vi.mock("@/lib/use-permissions", () => ({
  useCanDo: vi.fn(() => true),
  useIsOwner: vi.fn(() => true),
  useIsViewer: vi.fn(() => false),
}));

import { QuoteManagerDialog } from "@/components/projects/finance/quote-manager-dialog";

describe("QuoteManagerDialog smoke", () => {
  const baseProps = {
    open: true,
    onOpenChange: vi.fn(),
    projectId: "p1",
    orgId: "org1",
    projectNumber: "RVLT-2026-0001",
    clientId: "c1",
    projectStatus: "QUOTING",
    subtotal: 100,
    taxAmount: 10,
    total: 110,
  };

  it("renders the dialog and the embedded quote rail without throwing", async () => {
    render(<QuoteManagerDialog {...baseProps} />);
    expect(screen.getByText("Quotes — RVLT-2026-0001")).toBeTruthy();
    await waitFor(() => expect(screen.getByText("Loading quotes…")).toBeTruthy());
  });

  it("mounts nothing when closed (mount-on-open, no stale state)", () => {
    render(<QuoteManagerDialog {...baseProps} open={false} />);
    expect(screen.queryByText("Loading quotes…")).toBeNull();
  });
});
