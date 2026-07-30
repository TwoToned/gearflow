import { describe, it, expect, vi } from "vitest";

import {
  quoteRowFlags,
  standardQuoteRowActions,
  ownerOnlyQuoteRowActions,
} from "@/components/projects/project-quote-rail";

/**
 * #1038 — unit coverage for the action-list logic behind the row's overflow
 * menu. This is the part that actually changed: which action shows up for
 * which revision state/permission combo. The presentational half (menu vs.
 * button wall) is covered by row-actions-menu.smoke.test.tsx.
 */
function noopHandlers() {
  return {
    onAccept: vi.fn(),
    onUnaccept: vi.fn(),
    onDecline: vi.fn(),
    onRecall: vi.fn(),
    onDeleteDraft: vi.fn(),
  };
}

function keys(actions: { key: string }[]) {
  return actions.map((a) => a.key);
}

describe("quoteRowFlags", () => {
  it("flags a never-sent draft", () => {
    const flags = quoteRowFlags({ id: "q1", version: 1, effectiveStatus: "DRAFT" });
    expect(flags).toMatchObject({ isSent: false, isAccepted: false, isHeldByClient: false, isNeverSentDraft: true, isRecalledDraft: false });
  });

  it("flags a recalled draft (has send history) distinctly from a never-sent draft", () => {
    const flags = quoteRowFlags({ id: "q1", version: 1, effectiveStatus: "DRAFT", sentAt: 100 });
    expect(flags).toMatchObject({ isNeverSentDraft: false, isRecalledDraft: true });
  });

  it("treats EXPIRED as held-by-client but not sent", () => {
    const flags = quoteRowFlags({ id: "q1", version: 1, effectiveStatus: "EXPIRED" });
    expect(flags).toMatchObject({ isSent: false, isHeldByClient: true });
  });
});

describe("standardQuoteRowActions", () => {
  it("offers Mark accepted (only) on a SENT, unprotected revision", () => {
    const flags = quoteRowFlags({ id: "q1", version: 2, effectiveStatus: "SENT", sentAt: 1 });
    const actions = standardQuoteRowActions(flags, noopHandlers());
    expect(keys(actions)).toEqual(["accept", "decline", "recall"]);
  });

  it("hides Recall (but keeps Decline) once the revision is protected", () => {
    const flags = quoteRowFlags({ id: "q1", version: 2, effectiveStatus: "SENT", sentAt: 1, protected: true });
    const actions = standardQuoteRowActions(flags, noopHandlers());
    expect(keys(actions)).toEqual(["accept", "decline"]);
  });

  it("offers Unapprove on an ACCEPTED revision, not Mark accepted again", () => {
    const flags = quoteRowFlags({ id: "q1", version: 2, effectiveStatus: "ACCEPTED", sentAt: 1 });
    const actions = standardQuoteRowActions(flags, noopHandlers());
    expect(keys(actions)).toEqual(["unaccept"]);
  });

  it("offers only Delete draft on a never-sent draft", () => {
    const flags = quoteRowFlags({ id: "q1", version: 1, effectiveStatus: "DRAFT" });
    const actions = standardQuoteRowActions(flags, noopHandlers());
    expect(keys(actions)).toEqual(["delete-draft"]);
    expect(actions[0].destructive).toBe(true);
  });

  it("offers nothing on a SUPERSEDED revision", () => {
    const flags = quoteRowFlags({ id: "q1", version: 1, effectiveStatus: "SUPERSEDED", sentAt: 1 });
    expect(standardQuoteRowActions(flags, noopHandlers())).toEqual([]);
  });
});

describe("ownerOnlyQuoteRowActions", () => {
  const handlers = () => ({
    onCorrect: vi.fn(),
    onDeleteRecalled: vi.fn(),
    onToggleProtect: vi.fn(),
    protectPending: false,
  });

  it("offers Correct date and Protect on a SENT, unprotected revision", () => {
    const flags = quoteRowFlags({ id: "q1", version: 2, effectiveStatus: "SENT", sentAt: 1 });
    expect(keys(ownerOnlyQuoteRowActions(flags, handlers()))).toEqual(["correct", "protect"]);
  });

  it("hides Correct date but still offers Unprotect once protected", () => {
    const flags = quoteRowFlags({ id: "q1", version: 2, effectiveStatus: "SENT", sentAt: 1, protected: true });
    const actions = ownerOnlyQuoteRowActions(flags, handlers());
    expect(keys(actions)).toEqual(["protect"]);
    expect(actions[0].label).toBe("Unprotect");
  });

  it("offers Delete permanently only on a recalled (send-history) draft that isn't protected", () => {
    const recalled = quoteRowFlags({ id: "q1", version: 1, effectiveStatus: "DRAFT", sentAt: 1 });
    expect(keys(ownerOnlyQuoteRowActions(recalled, handlers()))).toEqual(["delete-recalled"]);

    const neverSent = quoteRowFlags({ id: "q1", version: 1, effectiveStatus: "DRAFT" });
    expect(ownerOnlyQuoteRowActions(neverSent, handlers())).toEqual([]);

    const protectedRecalled = quoteRowFlags({ id: "q1", version: 1, effectiveStatus: "DRAFT", sentAt: 1, protected: true });
    expect(ownerOnlyQuoteRowActions(protectedRecalled, handlers())).toEqual([]);
  });
});
