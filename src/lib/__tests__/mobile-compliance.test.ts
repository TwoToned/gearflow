import { describe, it, expect } from "vitest";
import { readFileSync, globSync } from "node:fs";
import path from "node:path";

/**
 * Static guards for DESIGN.md §15 (Mobile Rules).
 *
 * These exist because each rule below was violated in shipped code and only
 * surfaced when the app was driven at 375px — typecheck, lint and `next build`
 * all pass on every one of them. A full Playwright pass would catch them too,
 * but needs a database and a Convex deployment; these run in the existing CI.
 *
 * When a rule legitimately doesn't apply, add the file to that rule's allowlist
 * with a reason rather than loosening the pattern.
 */

const SRC = path.resolve(__dirname, "../..");

function sourceFiles(): string[] {
  return globSync("**/*.tsx", {
    cwd: SRC,
    exclude: (p) => p.includes("__tests__") || p.includes("generated"),
  }).map((p) => path.join(SRC, p));
}

function read(file: string) {
  return { rel: path.relative(SRC, file), text: readFileSync(file, "utf8") };
}

/** Every `className="..."` / `className={"..."}` string literal in a file. */
function classStrings(text: string): string[] {
  const out: string[] = [];
  const re = /class[Nn]ame\s*=\s*\{?\s*[`"']([^`"']*)[`"']/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) out.push(m[1]);
  // Also catch cn("...", "...") arguments, which is how conditional classes are built.
  const cnRe = /cn\(([\s\S]*?)\)/g;
  while ((m = cnRe.exec(text))) {
    const inner = m[1];
    const strRe = /[`"']([^`"']*)[`"']/g;
    let s: RegExpExecArray | null;
    while ((s = strRe.exec(inner))) out.push(s[1]);
  }
  return out;
}

describe("DESIGN.md §15 — max 2 columns on mobile", () => {
  // Grids that are genuinely N-across by nature, verified legible at 375px.
  const ALLOWED = new Map<string, string>([
    ["app/(app)/availability/page.tsx", "month calendar — 7 days is the correct rendering"],
    ["components/bookings/booking-calendar.tsx", "month calendar"],
    ["components/ui/range-calendar.tsx", "month calendar"],
    ["components/admin/icon-picker.tsx", "icon swatch grid, not content columns"],
    ["components/ui/photo-grid-input.tsx", "thumbnail grid, not content columns"],
    ["app/warehouse/display/[token]/page.tsx", "fixed-size warehouse kiosk display, never a phone"],
  ]);

  it("has no unprefixed grid-cols-3 or wider outside the allowlist", () => {
    const violations: string[] = [];

    for (const file of sourceFiles()) {
      const { rel, text } = read(file);
      if (ALLOWED.has(rel)) continue;

      for (const cls of classStrings(text)) {
        for (const token of cls.split(/\s+/)) {
          // A breakpoint-prefixed token (sm:grid-cols-3) only applies above that
          // breakpoint, so it can never affect a phone.
          if (token.includes(":")) continue;
          const m = /^grid-cols-(\d+)$/.exec(token);
          if (m && Number(m[1]) >= 3) violations.push(`${rel} → "${token}"`);
        }
      }
    }

    expect(violations).toEqual([]);
  });
});

describe("DESIGN.md §15 — hover-reveal controls stay reachable on touch", () => {
  // Tailwind gates `hover:` behind `@media (hover: hover)`. A control that is
  // `opacity-0` until `group-hover:` is therefore invisible AND untappable on a
  // phone unless it also un-hides under `pointer-coarse:`.
  const ALLOWED = new Map<string, string>([
    [
      "app/(app)/settings/test-and-tag/profiles/page.tsx",
      "decorative 2px accent bar, not an interactive control",
    ],
    [
      "app/(app)/availability/page.tsx",
      "decorative 3px left accent bar on the agenda row, not an interactive control",
    ],
  ]);

  it("pairs every group-hover:opacity-100 with pointer-coarse:opacity-100", () => {
    const violations: string[] = [];

    for (const file of sourceFiles()) {
      const { rel, text } = read(file);
      if (ALLOWED.has(rel)) continue;

      for (const cls of classStrings(text)) {
        const revealsOnHover = /group-hover(\/[\w-]+)?:opacity-100/.test(cls);
        if (!revealsOnHover) continue;
        // Only an UNPREFIXED opacity-0 hides the control on a phone. `md:opacity-0`
        // is already mobile-safe — the control is simply visible below `md`.
        const hiddenOnMobile = cls.split(/\s+/).includes("opacity-0");
        if (!hiddenOnMobile) continue;
        if (cls.includes("pointer-coarse:opacity-100")) continue;
        violations.push(`${rel} → "${cls.slice(0, 90)}"`);
      }
    }

    expect(violations).toEqual([]);
  });
});

describe("DESIGN.md §15 — 44px minimum tap target", () => {
  const ALLOWED = new Map<string, string>([
    [
      "components/projects/equipment-rows.tsx",
      // The row's action cluster lives in a w-32 (128px) table cell; three 44px
      // buttons would be 132px and spill onto the Total column. §15's real answer
      // here is "no inline icon buttons in mobile card mode" — this table needs a
      // card layout, which is a redesign, not a sizing fix.
      "w-32 action cell; needs the §15 card treatment, not bigger buttons",
    ],
  ]);

  it("has no icon Button shrunk below 44px without restoring it at a breakpoint", () => {
    const violations: string[] = [];

    for (const file of sourceFiles()) {
      const { rel, text } = read(file);
      if (ALLOWED.has(rel)) continue;

      // Each <Button ... size="icon" ...> opening tag. `[^>]` already spans
      // newlines, so no dotAll flag (which would need an es2018 target).
      const btnRe = /<Button\b[^>]*?size="icon"[^>]*?>/g;
      let m: RegExpExecArray | null;
      while ((m = btnRe.exec(text))) {
        const tag = m[0];
        const clsMatch = /class[Nn]ame\s*=\s*\{?\s*[`"']([^`"']*)[`"']/.exec(tag);
        if (!clsMatch) continue; // no override — inherits size-11 (44px)

        // DESIGN.md §15 sanctions `.touch-target`, which restores a 44px hit box
        // on coarse pointers without changing the button's visual density.
        if (clsMatch[1].split(/\s+/).includes("touch-target")) continue;

        for (const token of clsMatch[1].split(/\s+/)) {
          if (token.includes(":")) continue; // breakpoint-scoped, desktop-only
          const sz = /^(?:size|h)-(\d+)$/.exec(token);
          // Tailwind spacing: 11 = 2.75rem = 44px. Anything smaller is a violation.
          if (sz && Number(sz[1]) < 11) {
            violations.push(`${rel} → size="icon" with "${token}"`);
          }
        }
      }
    }

    expect(violations).toEqual([]);
  });
});
