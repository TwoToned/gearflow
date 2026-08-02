// @vitest-environment jsdom
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const recall = vi.fn().mockResolvedValue({ id: "q2", version: 2, restoredQuoteId: null });

vi.mock("@/hooks/use-quote-writes", () => ({
  useQuoteWrites: vi.fn(() => ({ recall })),
}));

import { RecallToEditDialog } from "@/components/projects/finance/recall-to-edit-dialog";

/**
 * #1080/#1100 (Phase 5) — the recall-to-edit confirm dialog. Opens for real
 * (not just the closed-trigger render — CLAUDE.md) and asserts all three
 * actions are keyboard-reachable in the non-protected case, and that a
 * protected/ACCEPTED revision never even offers the recall button (it must
 * never reach `recallNative` — the server-side gate is belt-and-braces, the
 * UI shouldn't dangle a button that can only error).
 */
describe("RecallToEditDialog smoke", () => {
  const onOpenChange = vi.fn();
  const onCreateNextVersion = vi.fn();

  beforeEach(() => {
    recall.mockClear();
    onOpenChange.mockClear();
    onCreateNextVersion.mockClear();
  });

  const liveQuote = { id: "q2", version: 2, sentAt: Date.parse("2026-07-19"), protected: false };

  it("opens and offers all three actions when the live revision is a plain SENT quote", async () => {
    render(
      <RecallToEditDialog
        open
        onOpenChange={onOpenChange}
        liveQuote={liveQuote}
        nextVersion={3}
        onCreateNextVersion={onCreateNextVersion}
      />,
    );

    await waitFor(() => expect(screen.getByRole("heading", { name: /Edit v2\?/ })).toBeTruthy());
    expect(screen.getByText(/PDF they.re holding will no longer match v2/)).toBeTruthy();

    expect(screen.getByRole("button", { name: /cancel/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /create v3 instead/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /recall v2 and edit/i })).toBeTruthy();
  });

  it("confirming recall calls the existing recallNative-backed hook and closes", async () => {
    const user = userEvent.setup();
    render(
      <RecallToEditDialog
        open
        onOpenChange={onOpenChange}
        liveQuote={liveQuote}
        nextVersion={3}
        onCreateNextVersion={onCreateNextVersion}
      />,
    );

    await user.click(await screen.findByRole("button", { name: /recall v2 and edit/i }));
    await waitFor(() => expect(recall).toHaveBeenCalledWith("q2", { reason: expect.any(String) }));
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
  });

  it("'Create v(N+1) instead' calls the caller's handler and closes without touching recall", async () => {
    const user = userEvent.setup();
    render(
      <RecallToEditDialog
        open
        onOpenChange={onOpenChange}
        liveQuote={liveQuote}
        nextVersion={3}
        onCreateNextVersion={onCreateNextVersion}
      />,
    );

    await user.click(await screen.findByRole("button", { name: /create v3 instead/i }));
    expect(onCreateNextVersion).toHaveBeenCalled();
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(recall).not.toHaveBeenCalled();
  });

  it("a protected revision surfaces the un-protect explanation and never offers Recall", async () => {
    render(
      <RecallToEditDialog
        open
        onOpenChange={onOpenChange}
        liveQuote={{ ...liveQuote, protected: true }}
        nextVersion={3}
        onCreateNextVersion={onCreateNextVersion}
      />,
    );

    await waitFor(() => expect(screen.getByRole("heading", { name: /v2 is protected/ })).toBeTruthy());
    expect(screen.getByText(/An owner must unprotect it before it can be edited/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /recall v2 and edit/i })).toBeNull();
    expect(screen.getByRole("button", { name: /create v3 instead/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /cancel/i })).toBeTruthy();

    expect(recall).not.toHaveBeenCalled();
  });

  it("renders nothing when there is no live quote to act on", () => {
    const { container } = render(
      <RecallToEditDialog
        open
        onOpenChange={onOpenChange}
        liveQuote={null}
        nextVersion={3}
        onCreateNextVersion={onCreateNextVersion}
      />,
    );
    expect(container.textContent).toBe("");
  });
});
