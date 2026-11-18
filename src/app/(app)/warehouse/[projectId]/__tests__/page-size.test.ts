import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Size guard for the warehouse job page (spec §13 acceptance criterion): a thin composition shell under
 * 800 lines. Handlers live in `components/warehouse/job/use-*` hooks and dialogs. No ratchet, no skip.
 */
const LIMIT = 800;

describe("warehouse job page size", () => {
  it(`stays at or under ${LIMIT} lines`, () => {
    const lines = readFileSync(join(__dirname, "..", "page.tsx"), "utf8").split("\n").length;
    expect(lines, `page.tsx is ${lines} lines; move the logic into a hook or component under components/warehouse/job/`).toBeLessThanOrEqual(LIMIT);
  });
});
