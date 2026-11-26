// @vitest-environment node
//
// The guard for maintenance audit rows (UX Phase 14, 14b-3 review): every snapshot SHAPE a maintenance write leaves in
// an activity row's `details` must be classified for money. `MAINTENANCE_MONEY_SHAPES` lists the ones that carry a
// money key per field; the rest are known to carry none. A writer that adds a new `details: { <shape>` fails here
// until it is classified, so the next shape cannot leak labour or a part price to a caller without job cost.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { MAINTENANCE_MONEY_SHAPES } from "./lib/activityPay";

/** `details` shapes known to hold no money (an undo marker, an archive flag, a delete's title, a create's link and hold ids). */
const NO_MONEY_SHAPES = new Set(["undoOf", "archived", "deleted", "kind"]);

const dir = __dirname;
const writerFiles = [
  ...readdirSync(dir).filter((f) => /^maintenance.*\.ts$/.test(f) && !f.endsWith(".test.ts")).map((f) => join(dir, f)),
  ...readdirSync(join(dir, "lib")).filter((f) => /^maintenance.*\.ts$/.test(f) && !f.endsWith(".test.ts")).map((f) => join(dir, "lib", f)),
  join(dir, "lib", "fieldEditUndo.ts"),
];

/** The first key of every `details: { ... }` literal (a leading `...spread` is skipped). */
function detailShapes(source: string): string[] {
  const out: string[] = [];
  for (const m of source.matchAll(/details:\s*\{\s*(?:\.\.\.[\w.]+,\s*)?(\w+)/g)) out.push(m[1]);
  return out;
}

describe("maintenance audit-detail shapes", () => {
  test("every shape a maintenance writer leaves is a listed money shape or a known no-money one", () => {
    const unknown: string[] = [];
    for (const file of writerFiles) {
      for (const shape of detailShapes(readFileSync(file, "utf8"))) {
        if (!(shape in MAINTENANCE_MONEY_SHAPES) && !NO_MONEY_SHAPES.has(shape)) unknown.push(`${file.split("/convex/")[1]}: ${shape}`);
      }
    }
    expect(unknown, `Unclassified audit-detail shape(s): ${unknown.join(", ")}. Add them to MAINTENANCE_MONEY_SHAPES (lib/activityPay.ts) or NO_MONEY_SHAPES above.`).toEqual([]);
  });

  test("the scan really finds the money shapes (it cannot pass by matching nothing)", () => {
    const found = new Set(writerFiles.flatMap((f) => detailShapes(readFileSync(f, "utf8"))));
    for (const shape of ["partOp", "lifecycle"]) expect(found.has(shape)).toBe(true);
    expect(found.has("fieldEdit") || readFileSync(join(dir, "lib", "fieldEditUndo.ts"), "utf8").includes("{ ...a.extraDetails, fieldEdit }")).toBe(true);
  });
});
