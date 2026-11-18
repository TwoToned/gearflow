import { beforeEach, describe, expect, it } from "vitest";
import { clearScanMemory, rememberScanChoice, takeRememberedScanChoice } from "../warehouse-scan-memory";

beforeEach(() => clearScanMemory());

describe("scan sheet memory (D10): job-scoped, in memory", () => {
  it("answers exactly n scans of that line, then the sheet asks again", () => {
    rememberScanChoice("p1", "L1", { kind: "with", accessoryIds: ["a"] }, 2);
    expect(takeRememberedScanChoice("p1", "L1")).toEqual({ kind: "with", accessoryIds: ["a"] });
    expect(takeRememberedScanChoice("p1", "L1")).toEqual({ kind: "with", accessoryIds: ["a"] });
    expect(takeRememberedScanChoice("p1", "L1")).toBeNull();
  });
  it("is scoped to the job and the line", () => {
    rememberScanChoice("p1", "L1", { kind: "without" }, 3);
    expect(takeRememberedScanChoice("p2", "L1")).toBeNull();
    expect(takeRememberedScanChoice("p1", "L2")).toBeNull();
    expect(takeRememberedScanChoice("p1", "L1")).toEqual({ kind: "without" });
  });
  it("a count of 0 forgets, and nothing is written to localStorage", () => {
    rememberScanChoice("p1", "L1", { kind: "without" }, 3);
    rememberScanChoice("p1", "L1", { kind: "without" }, 0);
    expect(takeRememberedScanChoice("p1", "L1")).toBeNull();
    rememberScanChoice("p1", "L1", { kind: "without" }, 3);
    expect(globalThis.localStorage?.length ?? 0).toBe(0);
  });
});
