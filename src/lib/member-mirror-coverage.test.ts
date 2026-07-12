import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * Mirror-coverage gate (docs/designs/convex-native-read-layer.md §3.3.4, §8).
 *
 * Membership writes are scattered across many files. If a NEW write
 * site is added without routing through the mirror helper, the Convex RBAC mirror
 * silently drifts from Prisma — a stale-permission read leak once enforcement is
 * live. This test fails CI if any file writes `member` in Prisma but
 * doesn't import `member-mirror`, so the bypass can't land unnoticed.
 */

const SRC_DIR = join(process.cwd(), "src");

// Prisma writes to the auth-affecting tables. `findUnique/findFirst/count/findMany`
// are reads and intentionally excluded.
const WRITE_RE =
  /\b(?:prisma|tx)\.member\.(?:create|update|delete|createMany|updateMany|deleteMany|upsert)\b/;

// Files that legitimately contain a write pattern but are NOT mirror call sites.
// Keep this list tiny and justified — every entry is a deliberate exception.
const ALLOWLIST = new Set<string>([
  // The mirror module + its tests obviously don't import themselves.
  "lib/member-mirror.ts",
]);

// Directories to skip: generated code (Prisma client model files contain method
// signatures like `member.create` that match the write regex but aren't call sites).
const SKIP_DIRS = new Set(["generated"]);

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (SKIP_DIRS.has(entry)) continue;
      out.push(...walk(full));
    } else if (/\.(ts|tsx)$/.test(entry) && !/\.test\.tsx?$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

describe("member mirror coverage", () => {
  const files = walk(SRC_DIR);

  it("found source files to scan", () => {
    expect(files.length).toBeGreaterThan(100);
  });

  it("every member write site imports the mirror helper", () => {
    const offenders: string[] = [];
    for (const file of files) {
      const rel = file.slice(SRC_DIR.length + 1);
      if (ALLOWLIST.has(rel)) continue;
      const src = readFileSync(file, "utf8");
      if (WRITE_RE.test(src) && !src.includes("member-mirror")) {
        offenders.push(rel);
      }
    }
    expect(
      offenders,
      `These files write member rows but do not import @/lib/member-mirror — ` +
        `route the write through the mirror (or add to ALLOWLIST with justification):\n` +
        offenders.join("\n"),
    ).toEqual([]);
  });

  it("the restrictive org-facing paths use strict (Convex-first) ordering", () => {
    // §3.3.4: revoke/demote/permission-removal must mirror with { strict: true }.
    const mustBeStrict = [
      "server/org-members.ts",
      "server/settings.ts",
      "server/user-profile.ts",
    ];
    for (const rel of mustBeStrict) {
      const src = readFileSync(join(SRC_DIR, rel), "utf8");
      expect(src.includes("{ strict: true }"), `${rel} must use strict ordering`).toBe(
        true,
      );
    }
  });
});
