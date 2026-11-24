// @vitest-environment node
//
// Guard (UX Phase 14, D42): `locations.lastMovementAt` is only true if EVERY write that sets,
// changes or clears the `locationId` of an asset, bulk asset or kit records the move through
// convex/lib/locationMovement.ts. A static check by design, in the style of
// stockBackedQtyGuard.test.ts: it DISCOVERS location writes in convex/** and fails when one is not
// in the enumerated set below or does not reach the helper, so a new write path cannot skip it.
//
// What counts as a location write: an `ctx.db.patch/replace` whose call mentions `locationId`, a
// destructure that drops `locationId` before a `replace`, an insert into assets / bulkAssets / kits,
// and the generic patch/replace mutations listed in GENERIC_WRITERS (they apply a caller-supplied
// set/patch that may carry `locationId`). Not counted: deletes, and a job's own `locationId`
// (a venue, not a stock location: projects / projectVersions / warehouseDashboardTokens).
import { readdirSync, readFileSync, statSync } from "node:fs";
import { resolve, relative } from "node:path";
import { describe, expect, test } from "vitest";

const CONVEX = resolve(__dirname);
const HELPER_FILE = "lib/locationMovement.ts";
const STAMP = /stampLocationMovement\(|\.record\(|patchKitStatusAt\(|releaseKitToLocation\(|assignAssetToKit\(/;

/** Every non-test source file under convex/ except generated code and the helper itself. */
function sourceFiles(dir = CONVEX): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = resolve(dir, name);
    if (statSync(p).isDirectory()) return name === "_generated" ? [] : sourceFiles(p);
    const rel = relative(CONVEX, p);
    return /\.ts$/.test(name) && !/\.test\.ts$/.test(name) && rel !== HELPER_FILE ? [rel] : [];
  });
}

const TOP_LEVEL_FN = /^(export )?(async )?function \w+|^(export )?const \w+ = (mutation|query|internalMutation)\(/;

/** The text of the top-level function enclosing line `index` (0-based). */
function enclosingFunction(lines: string[], index: number): { name: string; body: string } {
  let start = index;
  while (start > 0 && !TOP_LEVEL_FN.test(lines[start])) start--;
  let end = index;
  while (end < lines.length - 1 && !/^\}\)?;?$/.test(lines[end])) end++;
  return { name: lines[start].trim().slice(0, 80), body: lines.slice(start, end + 1).join("\n") };
}

const DB_WRITE_START = /ctx\.db\.(patch|replace)\(/;
// A destructure that drops locationId (before a replace), or an insert into a stock table.
const LOCATION_WRITE_LINE = /locationId: _\w*,.*\.\.\.rest|ctx\.db\.insert\("(assets|bulkAssets|kits)"/;

/** A patch/replace statement (which may span lines, up to its closing `);`) that mentions locationId. */
function patchMentionsLocation(lines: string[], i: number): boolean {
  if (!DB_WRITE_START.test(lines[i])) return false;
  for (let j = i; j < Math.min(lines.length, i + 12); j++) {
    if (/locationId/.test(lines[j])) return true;
    if (/\);/.test(lines[j])) return false;
  }
  return false;
}

/** Discovered location writes per file: how many, and every one must reach the helper. */
const EXPECTED_DISCOVERED: Record<string, number> = {
  "assetAccessoriesWrites.ts": 1,
  "assetWrites.ts": 2, // createNative, createManyNative inserts (update/bulk are GENERIC_WRITERS)
  "assets.ts": 3, // create, createMany, createIfMissing inserts
  "bulkAssets.ts": 2, // create, createIfMissing inserts
  "bulkAssetsWrites.ts": 1, // createNative insert
  "kitWrites.ts": 1, // createNative insert
  "kits.ts": 4, // create + createIfMissing inserts, assignAssetToKit patch + replace
  "lib/fulfillment.ts": 2, // setAssetStatus patch + replace
  "projectWrites.ts": 1, // free-after-cancel kit patch
  "warehouseOps.ts": 7, // asset + accessory check-out patches, setAssetsStatus (patch + clear), patchKitStatusAt, releaseKitToLocation (patch + clear)
};

/** Mutations that apply a caller-supplied set/patch/merge to an asset, bulk asset or kit (may carry locationId). */
const GENERIC_WRITERS: [file: string, fn: string][] = [
  ["assetWrites.ts", "updateNative"],
  ["assetWrites.ts", "bulkUpdateNative"],
  ["assets.ts", "update"],
  ["assets.ts", "patchAsset"],
  ["assets.ts", "bulkUpdate"],
  ["bulkAssets.ts", "update"],
  ["bulkAssets.ts", "patchBulkAsset"],
  ["bulkAssetsWrites.ts", "updateNative"],
  ["kits.ts", "update"],
  ["kitWrites.ts", "updateNative"],
];

describe("every write that changes a stock row's locationId records the move", () => {
  const found = sourceFiles().flatMap((rel) => {
    const lines = readFileSync(resolve(CONVEX, rel), "utf8").split("\n");
    return lines.flatMap((line, i) => {
      const code = !/^\s*(\/\/|\*)/.test(line);
      return code && (LOCATION_WRITE_LINE.test(line) || patchMentionsLocation(lines, i)) ? [{ rel, i, ...enclosingFunction(lines, i) }] : [];
    });
  });

  test("each discovered write sits in a function that reaches the helper", () => {
    const missing = found.filter((f) => !STAMP.test(f.body)).map((f) => `${f.rel}:${f.i + 1} (${f.name})`);
    expect(missing, "location writes that do not stamp lastMovementAt").toEqual([]);
  });

  test("the discovered set is exactly the enumerated one (a new site must be reviewed and added)", () => {
    const counts: Record<string, number> = {};
    for (const f of found) counts[f.rel] = (counts[f.rel] ?? 0) + 1;
    expect(counts).toEqual(EXPECTED_DISCOVERED);
  });

  test.each(GENERIC_WRITERS)("%s %s (generic patch/replace) stamps the move", (file, fn) => {
    const lines = readFileSync(resolve(CONVEX, file), "utf8").split("\n");
    const start = lines.findIndex((l) => new RegExp(`^export const ${fn} = mutation\\(`).test(l));
    expect(start, `${file} has no mutation ${fn}`).toBeGreaterThanOrEqual(0);
    expect(enclosingFunction(lines, start + 1).body).toMatch(STAMP);
  });

  test("the helper stamps through one write site only", () => {
    const src = readFileSync(resolve(CONVEX, HELPER_FILE), "utf8");
    expect(src.match(/lastMovementAt/g)?.length).toBeGreaterThan(0);
    // No other module writes the field directly.
    const writers = sourceFiles().filter((rel) => /lastMovementAt\s*:/.test(readFileSync(resolve(CONVEX, rel), "utf8")) && rel !== "schema.ts");
    expect(writers).toEqual([]);
  });
});
