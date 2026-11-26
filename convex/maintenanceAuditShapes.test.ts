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
const NO_MONEY_SHAPES = new Set([
  "undoOf", "archived", "deleted", "kind",
  // The flat, non-money fields of a create / Undo row (`details: { kind, assetCount, status, linkIds, held, released, ... }`).
  "assetCount", "serverSavedAt", "status", "linkIds", "held", "released", "restored",
]);

const dir = __dirname;
const writerFiles = [
  ...readdirSync(dir).filter((f) => /^maintenance.*\.ts$/.test(f) && !f.endsWith(".test.ts")).map((f) => join(dir, f)),
  ...readdirSync(join(dir, "lib")).filter((f) => /^maintenance.*\.ts$/.test(f) && !f.endsWith(".test.ts")).map((f) => join(dir, "lib", f)),
  join(dir, "lib", "fieldEditUndo.ts"),
];

/** The body of the `{ ... }` literal whose `{` is at `open` (string- and nesting-aware), without the outer braces. */
function literalBody(source: string, open: number): string {
  let end = source.length;
  walk(source, open, (_c, i, depth) => {
    if (depth !== 0) return false;
    end = i;
    return true;
  });
  return source.slice(open + 1, end);
}

/** The index of the quote that closes the string literal opening at `i` (a backslash escapes the next character). */
function stringEnd(s: string, i: number): number {
  for (let j = i + 1; j < s.length; j++) {
    if (s[j] === "\\") j++;
    else if (s[j] === s[i]) return j;
  }
  return s.length;
}

/**
 * Visits every character OUTSIDE a string literal from `from`, with the nesting depth AFTER it (an opening bracket
 * counts itself, a closing one has already left). `visit` returns true to stop.
 */
function walk(s: string, from: number, visit: (c: string, i: number, depth: number) => boolean): void {
  let depth = 0;
  for (let i = from; i < s.length; i++) {
    const c = s[i];
    if (c === '"' || c === "'" || c === "`") i = stringEnd(s, i);
    else {
      depth += "{([".includes(c) ? 1 : "})]".includes(c) ? -1 : 0;
      if (visit(c, i, depth)) return;
    }
  }
}

/** The top-level items of a literal body, split on commas that sit outside every nesting and string. */
function topLevelItems(body: string): string[] {
  const items: string[] = [];
  let start = 0;
  walk(body, 0, (c, i, depth) => {
    if (c === "," && depth === 0) {
      items.push(body.slice(start, i));
      start = i + 1;
    }
    return false;
  });
  items.push(body.slice(start));
  return items.map((s) => s.trim()).filter(Boolean);
}

/** EVERY key of every `details: { ... }` literal (a `...spread` item is skipped, a shorthand key counts). */
export function detailShapes(source: string): string[] {
  const out: string[] = [];
  for (const m of source.matchAll(/details:\s*\{/g)) {
    for (const item of topLevelItems(literalBody(source, m.index! + m[0].length - 1))) {
      const key = /^(\w+)/.exec(item)?.[1];
      if (key && !item.startsWith("...")) out.push(key);
    }
  }
  return out;
}

describe("detailShapes reads EVERY key, not just the first", () => {
  test("a second-position key, a spread, a shorthand and nested braces/strings are all handled", () => {
    expect(detailShapes("x({ details: { undoOf: a.id, newShape: { cost: 1, s: 'a,b}' } }, other: 1 })")).toEqual(["undoOf", "newShape"]);
    expect(detailShapes("details: { ...a.extra, fieldEdit }")).toEqual(["fieldEdit"]);
    expect(detailShapes("details: { a: f(1, 2), b: [1, 2], `c`: 3 }")).toEqual(["a", "b"]);
    expect(detailShapes("no details here")).toEqual([]);
  });
});

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

  test("no key listed as money-free is itself money-shaped (a cost / price / labour field belongs in MAINTENANCE_MONEY_SHAPES)", () => {
    expect([...NO_MONEY_SHAPES].filter((k) => /cost|price|labour|amount|total/i.test(k))).toEqual([]);
  });

  test("the scan really finds the money shapes (it cannot pass by matching nothing)", () => {
    const found = new Set(writerFiles.flatMap((f) => detailShapes(readFileSync(f, "utf8"))));
    for (const shape of ["partOp", "lifecycle"]) expect(found.has(shape)).toBe(true);
    expect(found.has("fieldEdit") || readFileSync(join(dir, "lib", "fieldEditUndo.ts"), "utf8").includes("{ ...a.extraDetails, fieldEdit }")).toBe(true);
  });
});
