import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Size guard for the job page (UX Phase 7): a composition shell at or under
 * 800 lines, so Phases 9 and 10 can merge into it. Tab bodies live in
 * `components/projects/job-tab-slots.tsx` and `components/projects/overview/`,
 * the header in `components/projects/job-header.tsx`. No ratchet, no skip.
 */
const LIMIT = 800;

describe("job page size", () => {
  it(`stays at or under ${LIMIT} lines`, () => {
    const lines = readFileSync(join(__dirname, "..", "page.tsx"), "utf8").split("\n").length;
    expect(lines, `page.tsx is ${lines} lines; move the logic into a component under components/projects/`).toBeLessThanOrEqual(LIMIT);
  });
});
