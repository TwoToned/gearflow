import { describe, it, expect, vi } from "vitest";

import {
  quoteRowFlags,
  standardQuoteRowActions,
  ownerOnlyQuoteRowActions,
  chaseSummary,
} from "@/components/projects/project-quote-rail";

/**
 * #1038 — unit coverage for the action-list logic behind the row's overflow
 * menu. This is the part that actually changed: which action shows up for
 * which revision state/permission combo. The presentational half (menu vs.
 * button wall) is covered by row-actions-menu.smoke.test.tsx.
 *
 * #1230: Unapprove (`unacceptNative`), Correct date (`correctQuoteNative`)
 * and Protect/Unprotect are deleted along with the whole protect/unprotect
 * mechanism — `QuoteRevisionDoc` no longer carries a `protected` field, and
 * neither action cluster branches on it anymore. Recall survives, ungated
 * by any protect check.
 *
 * #1231 (Project Versioning v2, Phase 5): "Delete draft" is also gone —
 * `deleteDraftNative` was deleted in #1229 Phase 3, superseded by
 * `versions.deleteNative`; deleting a version is now exclusively a Versions
 * panel verb (design §5.1, "one control to switch, one place to manage"),
 * not a per-quote-row action here.
 */
function noopHandlers() {
  return {
    onAccept: vi.fn(),
    onDecline: vi.fn(),
    onRecall: vi.fn(),
    onEditLabel: vi.fn(),
    onChase: vi.fn(),
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
  it("offers Mark accepted, Chase, Declined and Recall on a SENT revision", () => {
    const flags = quoteRowFlags({ id: "q1", version: 2, effectiveStatus: "SENT", sentAt: 1 });
    const actions = standardQuoteRowActions(flags, noopHandlers());
    expect(keys(actions)).toEqual(["rename", "accept", "chase", "decline", "recall"]);
  });

  it("offers Chase, Declined and Recall (no Mark accepted) on an EXPIRED revision", () => {
    const flags = quoteRowFlags({ id: "q1", version: 2, effectiveStatus: "EXPIRED", sentAt: 1 });
    const actions = standardQuoteRowActions(flags, noopHandlers());
    expect(keys(actions)).toEqual(["rename", "chase", "decline", "recall"]);
  });

  it("offers only Rename version on an ACCEPTED revision — no Unapprove (#1230 — unacceptNative deleted)", () => {
    const flags = quoteRowFlags({ id: "q1", version: 2, effectiveStatus: "ACCEPTED", sentAt: 1 });
    const actions = standardQuoteRowActions(flags, noopHandlers());
    expect(keys(actions)).toEqual(["rename"]);
  });

  it("offers only Rename on a never-sent draft — Delete draft is gone (#1231, superseded by the Versions panel)", () => {
    const flags = quoteRowFlags({ id: "q1", version: 1, effectiveStatus: "DRAFT" });
    const actions = standardQuoteRowActions(flags, noopHandlers());
    expect(keys(actions)).toEqual(["rename"]);
  });

  it("offers only Rename version on a SUPERSEDED revision (#1097 — rename is unconditional)", () => {
    const flags = quoteRowFlags({ id: "q1", version: 1, effectiveStatus: "SUPERSEDED", sentAt: 1 });
    expect(keys(standardQuoteRowActions(flags, noopHandlers()))).toEqual(["rename"]);
  });
});

describe("chaseSummary", () => {
  const NOW = new Date("2026-09-17T00:00:00Z").getTime();
  const pricing = { subtotal: 1000, taxAmount: 100, total: 1100 };

  it("includes the sent date and days remaining for a still-valid quote", () => {
    const sentAt = new Date("2026-09-10T00:00:00Z").getTime();
    const validUntil = new Date("2026-09-24T00:00:00Z").getTime();
    const text = chaseSummary("P-1042", { version: 3, sentAt, publishedAt: undefined, validUntil }, pricing, NOW);
    expect(text).toContain("Quote — P-1042 v3");
    expect(text).toContain("Subtotal:");
    expect(text).toContain("Total:");
    expect(text).toContain("Sent:");
    expect(text).toMatch(/Valid until:.*\(7 days left\)/);
  });

  it("reports an expired quote as expired, not as days-left", () => {
    const validUntil = new Date("2026-09-10T00:00:00Z").getTime();
    const text = chaseSummary("P-1042", { version: 3, sentAt: undefined, publishedAt: undefined, validUntil }, pricing, NOW);
    expect(text).toMatch(/Expired:.*\(7 days ago\)/);
    expect(text).not.toContain("Valid until:");
  });

  it("omits a line whose value is null rather than printing a blank", () => {
    const text = chaseSummary("P-1042", { version: 1, sentAt: undefined, publishedAt: undefined, validUntil: undefined }, { subtotal: null, taxAmount: null, total: null }, NOW);
    expect(text).toBe("Quote — P-1042 v1");
  });
});

describe("ownerOnlyQuoteRowActions", () => {
  const handlers = () => ({ onDeleteRecalled: vi.fn() });

  it("offers nothing on a SENT revision — Correct date/Protect are deleted (#1230)", () => {
    const flags = quoteRowFlags({ id: "q1", version: 2, effectiveStatus: "SENT", sentAt: 1 });
    expect(keys(ownerOnlyQuoteRowActions(flags, handlers()))).toEqual([]);
  });

  it("offers Delete permanently only on a recalled (send-history) draft", () => {
    const recalled = quoteRowFlags({ id: "q1", version: 1, effectiveStatus: "DRAFT", sentAt: 1 });
    expect(keys(ownerOnlyQuoteRowActions(recalled, handlers()))).toEqual(["delete-recalled"]);

    const neverSent = quoteRowFlags({ id: "q1", version: 1, effectiveStatus: "DRAFT" });
    expect(ownerOnlyQuoteRowActions(neverSent, handlers())).toEqual([]);
  });
});
