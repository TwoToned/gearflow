import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
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

/**
 * Every .tsx under src/, excluding tests and generated code.
 *
 * Hand-rolled rather than `fs.globSync`, which only exists on Node 22+ — CI runs
 * Node 20, where it is `undefined` and every rule below throws.
 */
function sourceFiles(dir: string = SRC): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "__tests__" || entry.name === "generated") continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...sourceFiles(full));
    else if (entry.name.endsWith(".tsx")) out.push(full);
  }
  return out;
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

describe("UX unification §5/§13 — row primitives on a phone", () => {
  const ui = (name: string) => readFileSync(path.join(SRC, "components/ui", name), "utf8");

  it("the row ⋯ is always rendered, 40px on a phone (D39), with a 44px hit box on touch", () => {
    const menu = ui("action-menu.tsx");
    expect(menu).toContain('"size-10"');
    expect(menu).toContain("touch-target");
    // never hover-gated: it must not be hidden until hover
    expect(menu).not.toMatch(/\bhidden\b[^"]*group-hover/);
  });

  it("stage chips are tap-sized and scroll sideways rather than wrap", () => {
    const stage = ui("stage-filter.tsx");
    expect(stage).toContain("min-h-11");
    expect(stage).toContain("overflow-x-auto");
  });

  it("phone sheet items are 48px and the sheet respects the safe area", () => {
    const sheet = ui("bottom-sheet.tsx");
    expect(sheet).toContain("min-h-12");
    expect(sheet).toContain("env(safe-area-inset-bottom)");
  });

  it("the phone row's checkbox is 22px", () => {
    expect(ui("line-row.tsx")).toContain("[&>span]:size-[22px]");
  });
});

describe("UX Phase 7 — the job Overview's text links are 44px tap targets on a phone", () => {
  const src = (rel: string) => readFileSync(path.join(SRC, rel), "utf8");

  it("`.tap-area` grows the hit box to at least 44×44px below md, without moving the line", () => {
    const css = src("app/globals.css");
    expect(css).toMatch(/\.tap-area::after\s*\{[^}]*width:\s*max\(100%,\s*44px\)[^}]*height:\s*max\(100%,\s*44px\)/);
  });

  it("every Overview text link and button carries it (PM +, Logistics ›, and n more ›, see what changed ›, directions)", () => {
    expect(src("components/projects/overview/overview-parts.tsx")).toMatch(/const LINK = "tap-area /);
  });

  it("the cancelled notice's Delete job… carries it", () => {
    expect(src("components/projects/job-header.tsx")).toMatch(/"tap-area text-t-out"/);
  });
});

describe("UX Phase 11 — Home's rows and header words are 44px tap targets on a phone", () => {
  const src = (rel: string) => readFileSync(path.join(SRC, rel), "utf8");
  const HOME = "components/dashboard";

  it("the header's quiet words (View all ›, the setup panel's Dismiss) use the shared tap-area", () => {
    expect(src(`${HOME}/widget-chrome.tsx`)).toMatch(/HEADER_ACTION_TAP = "tap-area"/);
    expect(src(`${HOME}/dashboard-card.tsx`)).toMatch(/cn\(HEADER_ACTION_TAP,[^)]*View all|HEADER_ACTION_TAP, "whitespace-nowrap/);
    expect(src(`${HOME}/setup-panel.tsx`)).toMatch(/cn\(HEADER_ACTION_TAP,/);
  });

  it("every Home row link is at least 44px tall (setup rows, Needs attention lines, task / floor / upcoming rows)", () => {
    expect(src(`${HOME}/setup-panel.tsx`)).toMatch(/className=\{cn\("flex min-h-11 /);
    expect(src(`${HOME}/widgets/needs-attention-widget.tsx`)).toMatch(/"group flex min-h-11 /);
    for (const w of ["my-tasks-widget", "on-the-floor-now-widget", "upcoming-projects-widget"]) {
      expect(src(`${HOME}/widgets/${w}.tsx`), w).toMatch(/min-h-\[52px\]/);
    }
  });

  it("the My tasks tick is a 44px button around its 18px circle", () => {
    expect(src(`${HOME}/widgets/my-tasks-widget.tsx`)).toMatch(/flex size-11 shrink-0 items-center justify-center rounded-full/);
  });
});
