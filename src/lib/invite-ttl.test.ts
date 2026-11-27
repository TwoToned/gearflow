import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { INVITE_TTL_MS } from "@/lib/invite-ttl";

const SRC = join(process.cwd(), "src");

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((e) => {
    const full = join(dir, e);
    if (statSync(full).isDirectory()) return e === "generated" ? [] : walk(full);
    return /\.(ts|tsx)$/.test(e) && !/\.test\.tsx?$/.test(e) ? [full] : [];
  });
}

describe("the invitation lifetime has ONE definition (R-3.1)", () => {
  it("is seven days", () => {
    expect(INVITE_TTL_MS).toBe(7 * 24 * 60 * 60 * 1000);
  });

  it("no other module spells the 7-day literal; every invite writer imports the constant", () => {
    const literal = /7\s*\*\s*24\s*\*\s*60\s*\*\s*60\s*\*\s*1000/;
    const offenders = walk(SRC).filter((f) => !f.endsWith("lib/invite-ttl.ts") && literal.test(readFileSync(f, "utf8")));
    expect(offenders.map((f) => f.slice(SRC.length + 1))).toEqual([]);
    for (const rel of ["server/settings.ts", "server/site-admin.ts", "lib/team-writes.ts"]) {
      expect(readFileSync(join(SRC, rel), "utf8"), rel).toContain('@/lib/invite-ttl');
    }
  });
});
