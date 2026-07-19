#!/usr/bin/env node
/**
 * Client-boundary justification gate (POLICY.md R-8.1.1). A route root
 * (a page.tsx / layout.tsx under src/app) that opts the whole route into the client
 * with `"use client"` must carry a justification comment (`use-client: <reason>`) on the
 * line right after the directive — server-first is the default, so a client route
 * root is a decision that must be explained. New unjustified client route roots fail CI.
 *
 * Usage: node scripts/check-client-routes.mjs
 */
import { readFileSync } from "node:fs";
import { execSync } from "node:child_process";

const files = execSync("find src/app -name page.tsx -o -name layout.tsx", {
  encoding: "utf8",
})
  .trim()
  .split("\n")
  .filter(Boolean);

const offenders = [];
for (const f of files) {
  const lines = readFileSync(f, "utf8").split("\n");
  const i = lines.findIndex((l) => /^\s*["']use client["'];?\s*$/.test(l));
  if (i === -1 || i > 3) continue; // server component — nothing to justify
  const next = `${lines[i + 1] ?? ""}${lines[i + 2] ?? ""}`;
  if (!next.includes("use-client:")) offenders.push(f);
}

if (offenders.length) {
  console.error(
    `[check-client-routes] FAIL: ${offenders.length} client route root(s) without a ` +
      `justification comment (R-8.1.1). Add \`// use-client: <reason>\` right after the ` +
      `"use client" directive, or push the interactivity into a leaf client component so ` +
      `the route root can stay a server component:\n` +
      offenders.map((f) => `  ${f}`).join("\n"),
  );
  process.exit(1);
}
console.log(
  `[check-client-routes] OK: every client route root under src/app is justified ` +
    `(${files.length} route roots scanned).`,
);
