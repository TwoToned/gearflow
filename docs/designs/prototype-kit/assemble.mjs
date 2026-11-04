#!/usr/bin/env node
// Assemble a clickable prototype from the kit: shell.html + style.html + core.js + <page>-body.html + <page>-page.js
// Usage: node docs/designs/prototype-kit/assemble.mjs <dir>/<name> "<title>" "<crumb>" [jobs|assets|none]
// Writes <dir>/<name>-prototype.html. Example:
//   node docs/designs/prototype-kit/assemble.mjs docs/designs/prototype-kit/examples/jobs "Jobs · RVLT Flow" Jobs jobs
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const kit = dirname(fileURLToPath(import.meta.url));
const [target, title = "Prototype", crumb = "Page", nav = "none"] = process.argv.slice(2);
if (!target) { console.error("usage: assemble.mjs <dir>/<name> <title> <crumb> [jobs|assets|none]"); process.exit(1); }
const SCAN = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 7V5a2 2 0 0 1 2-2h2M17 3h2a2 2 0 0 1 2 2v2M21 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2M7 12h10"/></svg>';
const read = (p) => readFileSync(p, "utf8");
const body = read(`${target}-body.html`).replaceAll("${ICON_SCAN}", SCAN);
const js = read(join(kit, "core.js")) + "\n" + read(`${target}-page.js`);
// Replacement callbacks, so `$&` / `$'` sequences inside the JS and CSS are inserted verbatim.
const out = read(join(kit, "shell.html"))
  .replace("__TITLE__", () => title)
  .replace("__STYLE__", () => read(join(kit, "style.html")))
  .replaceAll("__CRUMB__", () => crumb)
  .replace("__BODY__", () => body)
  .replace("__JS__", () => js)
  .replace("__NAVJOBS__", () => (nav === "jobs" ? "on" : ""))
  .replace("__NAVASSETS__", () => (nav === "assets" ? "on" : ""));
writeFileSync(`${target}-prototype.html`, out);
console.log(`${target}-prototype.html ${out.length} bytes`);
