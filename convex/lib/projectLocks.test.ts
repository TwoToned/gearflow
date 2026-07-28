// @vitest-environment node
import { describe, test, expect } from "vitest";
import {
  lockTierForStatus,
  isConfirmedOrLater,
  crossesIntoSnapshotStatus,
  isForwardStatusMove,
  isRevertOutOfHardLock,
  shouldDefaultToZero,
  lifecycleAuditMetadata,
  resolveLockTier,
  type LockTier,
} from "./projectLocks";

describe("lockTierForStatus", () => {
  test.each([
    ["ENQUIRY", "OPEN"],
    ["QUOTING", "OPEN"],
    ["QUOTED", "OPEN"],
    ["CONFIRMED", "FINANCE_LOCKED"],
    ["PREPPING", "FINANCE_LOCKED"],
    ["CHECKED_OUT", "FINANCE_LOCKED"],
    ["ON_SITE", "JUSTIFY"],
    ["RETURNED", "JUSTIFY"],
    ["COMPLETED", "HARD_LOCKED"],
    ["INVOICED", "HARD_LOCKED"],
    ["CANCELLED", "OPEN"],
  ] as const)("%s -> %s", (status, tier) => {
    expect(lockTierForStatus(status)).toBe(tier);
  });

  test("null/undefined status reads OPEN", () => {
    expect(lockTierForStatus(null)).toBe("OPEN");
    expect(lockTierForStatus(undefined)).toBe("OPEN");
  });

  test("isConfirmedOrLater mirrors the tier boundary", () => {
    expect(isConfirmedOrLater("QUOTED")).toBe(false);
    expect(isConfirmedOrLater("CONFIRMED")).toBe(true);
    expect(isConfirmedOrLater("COMPLETED")).toBe(true);
    expect(isConfirmedOrLater("CANCELLED")).toBe(false);
  });
});

// #988 (Phase C) — the quote-send lock folds into the SAME tier resolver.
// Full truth table across every status × every quote state, since this is the
// safety-critical function every gate site relies on.
describe("resolveLockTier", () => {
  const ALL_STATUSES = [
    "ENQUIRY", "QUOTING", "QUOTED",
    "CONFIRMED", "PREPPING", "CHECKED_OUT",
    "ON_SITE", "RETURNED",
    "COMPLETED", "INVOICED",
    "CANCELLED",
  ] as const;
  const STATUSLESS = [null, undefined] as const;
  const OPEN_KEEPING_QUOTE_STATES = [undefined, null, "DRAFT"] as const;
  const ESCALATING_QUOTE_STATES = ["SENT", "ACCEPTED", "DECLINED", "SUPERSEDED", "EXPIRED"] as const;
  const ALL_QUOTE_STATES = [...OPEN_KEEPING_QUOTE_STATES, ...ESCALATING_QUOTE_STATES] as const;

  describe("status alone already resolves a non-OPEN tier — quote state never overrides it", () => {
    const NON_OPEN_STATUSES = ALL_STATUSES.filter((s) => lockTierForStatus(s) !== "OPEN");

    test.each(NON_OPEN_STATUSES)("%s", (status) => {
      const expectedTier = lockTierForStatus(status);
      for (const quoteState of ALL_QUOTE_STATES) {
        expect(resolveLockTier({ status, quoteState })).toEqual({ tier: expectedTier, reason: "STATUS" });
      }
      // Omitting quoteState entirely resolves identically.
      expect(resolveLockTier({ status })).toEqual({ tier: expectedTier, reason: "STATUS" });
    });
  });

  describe("status alone resolves OPEN (ENQUIRY/QUOTING/QUOTED/CANCELLED) — quote state decides", () => {
    const OPEN_STATUSES = ALL_STATUSES.filter((s) => lockTierForStatus(s) === "OPEN");

    test.each(OPEN_STATUSES)("%s + no quote / DRAFT quote stays OPEN", (status) => {
      for (const quoteState of OPEN_KEEPING_QUOTE_STATES) {
        expect(resolveLockTier({ status, quoteState })).toEqual({ tier: "OPEN", reason: "STATUS" });
      }
    });

    test.each(OPEN_STATUSES)("%s + a quote that's gone out (SENT/ACCEPTED/DECLINED/SUPERSEDED/EXPIRED) escalates to FINANCE_LOCKED", (status) => {
      for (const quoteState of ESCALATING_QUOTE_STATES) {
        expect(resolveLockTier({ status, quoteState })).toEqual({ tier: "FINANCE_LOCKED", reason: "QUOTE_SENT" });
      }
    });

    test.each(STATUSLESS)("null/undefined status behaves exactly like an OPEN status", (status) => {
      for (const quoteState of OPEN_KEEPING_QUOTE_STATES) {
        expect(resolveLockTier({ status, quoteState })).toEqual({ tier: "OPEN", reason: "STATUS" });
      }
      for (const quoteState of ESCALATING_QUOTE_STATES) {
        expect(resolveLockTier({ status, quoteState })).toEqual({ tier: "FINANCE_LOCKED", reason: "QUOTE_SENT" });
      }
    });
  });

  test("monotonicity property: no (status, quoteState) pair EVER resolves to a lower tier than status alone", () => {
    // A simple total order sufficient for this property: OPEN is the floor,
    // everything else is at or above it, and HARD_LOCKED is the ceiling.
    // Quote state, per the rule above, can only move OPEN -> FINANCE_LOCKED —
    // it never touches (let alone lowers) any already-locked status tier.
    const rank: Record<LockTier, number> = { OPEN: 0, FINANCE_LOCKED: 1, JUSTIFY: 1, HARD_LOCKED: 2 };
    for (const status of [...ALL_STATUSES, ...STATUSLESS]) {
      const floor = rank[lockTierForStatus(status)];
      for (const quoteState of ALL_QUOTE_STATES) {
        const { tier } = resolveLockTier({ status, quoteState });
        expect(rank[tier]).toBeGreaterThanOrEqual(floor);
      }
    }
  });

  test("a SENT quote on an already-HARD_LOCKED project softens nothing (still HARD_LOCKED, reason STATUS)", () => {
    expect(resolveLockTier({ status: "COMPLETED", quoteState: "SENT" })).toEqual({ tier: "HARD_LOCKED", reason: "STATUS" });
  });
});

describe("crossesIntoSnapshotStatus", () => {
  test("forward advance into CONFIRMED snapshots", () => {
    expect(crossesIntoSnapshotStatus("QUOTED", "CONFIRMED")).toBe(true);
  });
  test("forward advance into COMPLETED snapshots", () => {
    expect(crossesIntoSnapshotStatus("RETURNED", "COMPLETED")).toBe(true);
  });
  test("a revert-then-re-advance re-crossing into CONFIRMED ALSO snapshots (versioned, never overwritten)", () => {
    expect(crossesIntoSnapshotStatus("ON_SITE", "CONFIRMED")).toBe(true);
  });
  test("no-op status set does not snapshot", () => {
    expect(crossesIntoSnapshotStatus("CONFIRMED", "CONFIRMED")).toBe(false);
  });
  test("a move that lands elsewhere does not snapshot", () => {
    expect(crossesIntoSnapshotStatus("QUOTED", "PREPPING")).toBe(false);
    expect(crossesIntoSnapshotStatus("CONFIRMED", "CANCELLED")).toBe(false);
  });
});

describe("isForwardStatusMove", () => {
  test("later pipeline status is forward", () => {
    expect(isForwardStatusMove("QUOTED", "CONFIRMED")).toBe(true);
  });
  test("earlier pipeline status is not forward", () => {
    expect(isForwardStatusMove("ON_SITE", "CONFIRMED")).toBe(false);
  });
  test("CANCELLED is off-pipeline — never forward either direction", () => {
    expect(isForwardStatusMove("CONFIRMED", "CANCELLED")).toBe(false);
    expect(isForwardStatusMove("CANCELLED", "CONFIRMED")).toBe(false);
  });
});

describe("isRevertOutOfHardLock", () => {
  test("COMPLETED -> INVOICED stays HARD_LOCKED, not a revert", () => {
    expect(isRevertOutOfHardLock("COMPLETED", "INVOICED")).toBe(false);
  });
  test("COMPLETED -> ON_SITE reverts out of the hard lock", () => {
    expect(isRevertOutOfHardLock("COMPLETED", "ON_SITE")).toBe(true);
  });
  test("INVOICED -> RETURNED reverts out of the hard lock", () => {
    expect(isRevertOutOfHardLock("INVOICED", "RETURNED")).toBe(true);
  });
  test("a move that never enters HARD_LOCKED is not a revert", () => {
    expect(isRevertOutOfHardLock("CONFIRMED", "QUOTED")).toBe(false);
  });
});

describe("shouldDefaultToZero", () => {
  test("OPEN tier never defaults to zero", () => {
    expect(shouldDefaultToZero("OPEN", null)).toBe(false);
  });
  test("a locked tier with no open session defaults to zero", () => {
    expect(shouldDefaultToZero("FINANCE_LOCKED", null)).toBe(true);
    expect(shouldDefaultToZero("JUSTIFY", null)).toBe(true);
    expect(shouldDefaultToZero("HARD_LOCKED", null)).toBe(true);
  });
  test("any open session (either scope) suspends the zero-default — PM is deliberately pricing", () => {
    const financialSession = { scope: "FINANCIAL" } as never;
    const fullSession = { scope: "FULL" } as never;
    expect(shouldDefaultToZero("FINANCE_LOCKED", financialSession)).toBe(false);
    expect(shouldDefaultToZero("HARD_LOCKED", fullSession)).toBe(false);
  });
});

describe("lifecycleAuditMetadata", () => {
  test("no justification, no session -> undefined (nothing to audit)", () => {
    expect(lifecycleAuditMetadata({ tier: "OPEN", openSession: null })).toBeUndefined();
  });
  test("a justification is recorded with its tier", () => {
    expect(lifecycleAuditMetadata({ tier: "JUSTIFY", openSession: null }, "  swapped the LED wall  ")).toEqual({
      justification: "swapped the LED wall",
      lockTier: "JUSTIFY",
    });
  });
  test("an open session tags the write with its id, even with no justification", () => {
    const session = { id: "sess_1" } as never;
    expect(lifecycleAuditMetadata({ tier: "FINANCE_LOCKED", openSession: session })).toEqual({
      unlockSessionId: "sess_1",
    });
  });
});
