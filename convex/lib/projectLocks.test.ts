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
