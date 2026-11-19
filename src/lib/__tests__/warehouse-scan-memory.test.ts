import { describe, expect, it } from "vitest";
import { rememberScanChoice, takeRememberedScanChoice } from "../warehouse-scan-memory";

// Each test uses its own project id: the memory is module state keyed by job.
describe("scan sheet memory (D10): job-scoped, in memory", () => {
  it("answers exactly n scans of that line, then the sheet asks again", () => {
    rememberScanChoice("pA", "L1", { kind: "with", accessoryIds: ["a"] }, 2);
    expect(takeRememberedScanChoice("pA", "L1")).toEqual({ kind: "with", accessoryIds: ["a"] });
    expect(takeRememberedScanChoice("pA", "L1")).toEqual({ kind: "with", accessoryIds: ["a"] });
    expect(takeRememberedScanChoice("pA", "L1")).toBeNull();
  });
  it("is scoped to the job and the line", () => {
    rememberScanChoice("pB", "L1", { kind: "without" }, 3);
    expect(takeRememberedScanChoice("pB-other", "L1")).toBeNull();
    expect(takeRememberedScanChoice("pB", "L2")).toBeNull();
    expect(takeRememberedScanChoice("pB", "L1")).toEqual({ kind: "without" });
  });
  it("a count of 0 forgets, and nothing is written to localStorage", () => {
    rememberScanChoice("pC", "L1", { kind: "without" }, 3);
    rememberScanChoice("pC", "L1", { kind: "without" }, 0);
    expect(takeRememberedScanChoice("pC", "L1")).toBeNull();
    rememberScanChoice("pC", "L1", { kind: "without" }, 3);
    expect(globalThis.localStorage?.length ?? 0).toBe(0);
  });
});
