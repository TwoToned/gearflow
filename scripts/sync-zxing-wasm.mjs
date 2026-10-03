#!/usr/bin/env node
/**
 * Copy the ZXing-C++ reader `.wasm` out of node_modules into `public/wasm/`, so the
 * in-app camera scanner loads its decoder from our own origin.
 *
 * Why self-host at all: `zxing-wasm` defaults to fetching the binary from the
 * jsDelivr CDN at first decode. A warehouse on flaky wifi, an org behind a
 * restrictive egress proxy, or a future `script-src`/`connect-src` CSP would each
 * turn that into a scanner that opens the camera and then never decodes anything —
 * the exact silent-failure class this feature exists to kill. Same-origin also
 * means the service worker can cache it.
 *
 * The copy is COMMITTED (like `convex/_generated/`) so `pnpm dev` works with no
 * build step, and `--check` is the CI gate that proves it still matches the
 * installed package — a `pnpm update zxing-wasm` that forgets to re-run this
 * would otherwise ship a decoder binary from a different version than the JS glue
 * expecting it, which fails at instantiate time in the browser only.
 *
 * Usage:
 *   node scripts/sync-zxing-wasm.mjs           # write public/wasm/zxing_reader.wasm
 *   node scripts/sync-zxing-wasm.mjs --check   # exit 1 if it is missing or stale
 */
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const DEST = join(repoRoot, "public", "wasm", "zxing_reader.wasm");

const require = createRequire(import.meta.url);
/**
 * Locate the package root by climbing from a resolved entry point, rather than
 * hardcoding a node_modules path (pnpm's store layout is not a flat
 * `node_modules/zxing-wasm`) or resolving `zxing-wasm/package.json` (not in the
 * package's `exports` map, so Node refuses it). The binary ships at
 * `dist/reader/`, beside the bundles — not next to whichever of the cjs/es
 * entries happens to resolve here.
 */
function findWasm() {
  let dir = dirname(require.resolve("zxing-wasm/reader"));
  for (let up = 0; up < 6; up++) {
    const candidate = join(dir, "dist", "reader", "zxing_reader.wasm");
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

const SOURCE = findWasm();
if (!SOURCE) {
  console.error("[zxing-wasm] Source binary not found under the installed zxing-wasm package. Run `pnpm install` first.");
  process.exit(1);
}

const source = readFileSync(SOURCE);
const sha = (buf) => createHash("sha256").update(buf).digest("hex");
const check = process.argv.includes("--check");

if (check) {
  if (!existsSync(DEST)) {
    console.error("[zxing-wasm] FAIL: public/wasm/zxing_reader.wasm is missing. Run `pnpm run wasm:sync`.");
    process.exit(1);
  }
  if (sha(readFileSync(DEST)) !== sha(source)) {
    console.error("[zxing-wasm] FAIL: public/wasm/zxing_reader.wasm is stale. Run `pnpm run wasm:sync` and commit.");
    process.exit(1);
  }
  console.log(`[zxing-wasm] OK: public/wasm/zxing_reader.wasm matches the installed package (sha256 ${sha(source).slice(0, 12)}…).`);
  process.exit(0);
}

mkdirSync(dirname(DEST), { recursive: true });
writeFileSync(DEST, source);
console.log(`[zxing-wasm] Wrote public/wasm/zxing_reader.wasm (${(source.length / 1024).toFixed(0)} KiB, sha256 ${sha(source).slice(0, 12)}…).`);
