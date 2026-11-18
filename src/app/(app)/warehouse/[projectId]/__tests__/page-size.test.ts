import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Size guard for the warehouse job page (Phase 3 target: a thin shell under 800 lines, handlers in
 * `components/warehouse/job/use-*` hooks). The ceiling is a RATCHET: it may only be lowered. It starts at the
 * size after the old tabs/rail were deleted, because the `handle*Selected` bodies have not moved into hooks yet.
 */
const TARGET = 800;
const CEILING = 2600;

describe("warehouse job page size", () => {
  const lines = readFileSync(join(__dirname, "..", "page.tsx"), "utf8").split("\n").length;

  it("never grows past the ratchet ceiling", () => {
    expect(lines, `page.tsx is ${lines} lines; lower CEILING when you shrink it, never raise it`).toBeLessThanOrEqual(CEILING);
  });

  it.skip(`reaches the ${TARGET}-line target (enable once the handlers move into hooks)`, () => {
    expect(lines).toBeLessThanOrEqual(TARGET);
  });
});
