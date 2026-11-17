import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { PHONE_MAX, TABLET_MAX, PHONE_MEDIA_QUERY } from "@/lib/breakpoints";

const ROOT = join(__dirname, "..", "..", "..");

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (name === "generated" || name === "node_modules") continue;
    if (statSync(p).isDirectory()) sourceFiles(p, out);
    else if (/\.(ts|tsx|css)$/.test(name) && !/\.test\./.test(name)) out.push(p);
  }
  return out;
}

describe("D67/D68 — one set of breakpoints", () => {
  it("phone is max-width 859px and the tablet rail applies at <= 1023px", () => {
    expect(PHONE_MAX).toBe(859);
    expect(TABLET_MAX).toBe(1023);
    expect(PHONE_MEDIA_QUERY).toBe("(max-width: 859px)");
  });

  it("globals.css moves Tailwind's md breakpoint to PHONE_MAX + 1", () => {
    const css = readFileSync(join(ROOT, "src/app/globals.css"), "utf8");
    expect(css).toContain(`--breakpoint-md: ${PHONE_MAX + 1}px;`);
  });

  it("no hard-coded 767/768 media query or width check survives in src", () => {
    const offenders: string[] = [];
    for (const f of sourceFiles(join(ROOT, "src"))) {
      const text = readFileSync(f, "utf8");
      if (/max-width:\s*76[78]px|width\s*[<>]=?\s*76[78]\b|innerWidth\s*[<>]=?\s*76[78]\b/.test(text)) offenders.push(f);
    }
    expect(offenders).toEqual([]);
  });

  it("useIsMobile reads the shared constant", () => {
    const hook = readFileSync(join(ROOT, "src/hooks/use-mobile.ts"), "utf8");
    expect(hook).toContain("PHONE_MEDIA_QUERY");
    expect(hook).not.toMatch(/\b768\b/);
  });
});
