// @vitest-environment node
//
// D2 (#1106)'s anti-rot requirement: every `data-tour-anchor` named in
// `onboarding-tour.ts` must exist, verbatim, on a real element somewhere in
// the source tree. A moved/renamed anchor becomes a red test here instead of
// a silently stale coaching tip pointing at nothing.
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { TOUR_ANCHOR_NAMES } from "@/lib/onboarding-tour";

const SRC_ROOT = join(__dirname, "..", "..");

function collectSourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      collectSourceFiles(full, out);
    } else if (/\.(tsx?|jsx?)$/.test(entry.name) && !entry.name.endsWith(".test.tsx") && !entry.name.endsWith(".test.ts")) {
      out.push(full);
    }
  }
  return out;
}

describe("onboarding tour anchors", () => {
  it("every anchor named in onboarding-tour.ts exists as a data-tour-anchor in the source tree", () => {
    const files = collectSourceFiles(SRC_ROOT);
    const haystack = files.map((f) => readFileSync(f, "utf8")).join("\n");

    expect(TOUR_ANCHOR_NAMES.length).toBeGreaterThan(0);
    for (const anchor of TOUR_ANCHOR_NAMES) {
      const needle = `data-tour-anchor="${anchor}"`;
      expect(haystack.includes(needle), `Missing data-tour-anchor="${anchor}" anywhere in src/ — the coaching tip for it has no real anchor left.`).toBe(true);
    }
  });

  it("has no duplicate anchor names (each milestone owns exactly one anchor)", () => {
    const unique = new Set(TOUR_ANCHOR_NAMES);
    expect(unique.size).toBe(TOUR_ANCHOR_NAMES.length);
  });
});
