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

/** Every string literal in a chunk of source. Skips `${...}` interpolations. */
function stringLiterals(src: string): string[] {
  const out: string[] = [];
  const re = /(["'`])((?:\\.|(?!\1)[^\\])*)\1/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) out.push(m[2].replace(/\$\{[^}]*\}/g, " "));
  return out;
}

/**
 * Every class string in a file, including ones built through `cn(...)`,
 * ternaries and template literals — the codebase's dominant idioms.
 *
 * Known limitation: both arms of a ternary are extracted, so a genuinely
 * runtime-guarded `cond ? "grid-cols-2" : "grid-cols-3"` would be reported.
 * No such pattern exists today; if one appears, allowlist the file.
 */
function classStrings(text: string): string[] {
  const out: string[] = [];
  const re = /class[Nn]ame\s*=\s*/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const rest = text.slice(m.index + m[0].length);
    if (rest[0] === "{") {
      // Balanced-brace scan so `cn(a, b && "x")` and nested calls are captured whole.
      let depth = 0;
      let end = 0;
      for (let i = 0; i < rest.length; i++) {
        if (rest[i] === "{") depth++;
        else if (rest[i] === "}" && --depth === 0) {
          end = i;
          break;
        }
      }
      out.push(...stringLiterals(rest.slice(1, end)));
    } else {
      out.push(...stringLiterals(rest.slice(0, rest.indexOf(">") + 1)).slice(0, 1));
    }
  }
  return out;
}

/**
 * The full opening tag of every `<TagName ...>` in a file.
 *
 * A regex like `/<Button[^>]*>/` cannot do this: JSX props routinely contain
 * `>` inside `onClick={() => ...}`, which truncates the match before the
 * className is ever seen. Walk the tag instead, tracking brace and string
 * depth, and stop at the first `>` that is genuinely at depth zero.
 */
function openingTags(text: string, tagName: string): string[] {
  const out: string[] = [];
  const re = new RegExp(`<${tagName}\\b`, "g");
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    let depth = 0;
    let quote: string | null = null;
    for (let i = m.index; i < text.length; i++) {
      const c = text[i];
      if (quote) {
        if (c === "\\") i++;
        else if (c === quote) quote = null;
        continue;
      }
      if (c === '"' || c === "'" || c === "`") quote = c;
      else if (c === "{") depth++;
      else if (c === "}") depth--;
      else if (c === ">" && depth === 0) {
        out.push(text.slice(m.index, i + 1));
        break;
      }
    }
  }
  return out;
}

/**
 * The scanners must have teeth. An earlier version of this file used
 * `/<Button[^>]*>/` and `className="..."`, which silently matched nothing for
 * the codebase's two dominant idioms — an inline `onClick={() => ...}` (whose
 * `>` truncated the tag) and `className={cn(...)}`. The guard passed because it
 * was blind, not because the code was clean. These cases lock that shut.
 */
describe("compliance scanners see through the codebase's real idioms", () => {
  it("reads a Button tag past an inline arrow-function prop", () => {
    const src = `<Button size="icon" onClick={() => go(a > b)} className="size-7" />`;
    const [tag] = openingTags(src, "Button");
    expect(tag).toContain('className="size-7"');
    expect(classStrings(tag).join(" ")).toContain("size-7");
  });

  it("reads classes out of cn(), ternaries and template literals", () => {
    const src = `<Button size="icon" className={cn("size-8", open && "bg-elev", \`ring-\${n}\`)} />`;
    const [tag] = openingTags(src, "Button");
    const classes = classStrings(tag).join(" ").split(/\s+/);
    expect(classes).toContain("size-8");
    expect(classes).toContain("bg-elev");
  });

  it("actually finds the icon Buttons it claims to police", () => {
    // If this drops to 0, the scanner has gone blind again and every other
    // assertion in this file is vacuously true.
    const found = sourceFiles()
      .map((f) => openingTags(read(f).text, "Button").filter((t) => /size\s*=\s*"icon"/.test(t)))
      .reduce((n, tags) => n + tags.length, 0);
    expect(found).toBeGreaterThan(40);
  });

  it("counts a bare sub-44px icon Button as a violation", () => {
    const classes = classStrings(`<Button size="icon" className={cn("size-8")} />`);
    expect(classes.join(" ").split(/\s+/)).toContain("size-8");
  });
});

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
        const tokens = cls.split(/\s+/);
        // The three ways a control gets revealed on hover, and the token that
        // hides it by default. `opacity-0` is the common one; `hidden` and
        // `invisible` strand a control on touch just as completely.
        const reveals: [RegExp, string, string][] = [
          [/group-hover(\/[\w-]+)?:opacity-100/, "opacity-0", "pointer-coarse:opacity-100"],
          [/group-hover(\/[\w-]+)?:(flex|block|inline|inline-flex|grid)/, "hidden", "pointer-coarse:"],
          [/group-hover(\/[\w-]+)?:visible/, "invisible", "pointer-coarse:visible"],
        ];

        for (const [revealRe, hider, restore] of reveals) {
          if (!revealRe.test(cls)) continue;
          // Only an UNPREFIXED hider hides the control on a phone. `md:opacity-0`
          // is already mobile-safe — the control is simply visible below `md`.
          if (!tokens.includes(hider)) continue;
          if (cls.includes(restore)) continue;
          violations.push(`${rel} → "${cls.slice(0, 90)}"`);
        }
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

      for (const tag of openingTags(text, "Button")) {
        if (!/size\s*=\s*"icon"/.test(tag)) continue;

        const classes = classStrings(tag).join(" ").split(/\s+/).filter(Boolean);
        if (classes.length === 0) continue; // no override — inherits size-11 (44px)

        // DESIGN.md §15 sanctions `.touch-target`, which restores a 44px hit box
        // on coarse pointers without changing the button's visual density.
        if (classes.includes("touch-target")) continue;

        for (const token of classes) {
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
