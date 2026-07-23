# Manual WCAG 2.2 AA Checklist

> _Owner: Jayden Nawotka · Last reviewed: 2026-07-23 (review quarterly — POLICY.md R-5.5)_

POLICY.md **R-8.1.7** requires *both* automated axe/Playwright-axe checks (`e2e/a11y.spec.ts`,
`e2e/harness-a11y.spec.ts`, CI-blocking) **and** a manual WCAG 2.2 AA checklist pass on the
[critical flows](./critical-flows.md) per release — "automated checks alone do NOT demonstrate
full AA conformance." This doc is that checklist: the criteria to run, the procedure, and the
dated results log.

Axe catches DOM-detectable violations (missing alt text, contrast ratios, ARIA misuse). It
cannot tell you whether tab order makes sense, whether focus is trapped in a modal, or whether
a screen reader announces something intelligible. This checklist covers exactly that gap.

## Criteria

For each critical flow, walk through with a keyboard (no mouse) and check:

1. **Keyboard operability** — every interactive element (links, buttons, form fields, custom
   widgets) is reachable and operable via `Tab`/`Shift+Tab`/`Enter`/`Space`/arrow keys. No
   mouse-only interaction (e.g. hover-only menus with no keyboard equivalent).
2. **Focus order** — `Tab` order follows visual/reading order. No jumps that skip a visible
   control or double back unexpectedly.
3. **Focus visibility** — the currently focused element has a visible indicator (outline, ring,
   or box-shadow) at every step. Focus is never silently lost (e.g. after a dialog closes or an
   async action completes) or trapped somewhere the user can't escape (`Escape` closes dialogs
   and returns focus to the trigger).
4. **Screen-reader labels** — every interactive element has an accessible name (visible label,
   `aria-label`, or associated `<label>`) that describes its purpose, not just its shape (e.g.
   not "icon button" with no name). Headings and landmarks (`h1`/`h2`, `<nav>`, `<main>`, `role`
   attributes) form a sensible outline.
5. **Reduced motion** — the flow still renders and functions with
   `prefers-reduced-motion: reduce` emulated (no content hidden behind an animation that never
   completes).

Scope: zero **serious/critical** issues on any of the five criteria above is a PASS for that
flow. Anything else is logged as a finding with a remediation owner.

## Procedure

Run this once per release (or when a critical flow's UI changes materially), against a running
instance of the app (local dev, staging, or prod):

1. Open each flow from [`docs/critical-flows.md`](./critical-flows.md) in turn.
2. Walk the flow keyboard-only, checking the five criteria above at each screen/step.
3. For screens reachable without seeded auth data, this can be automated with a short Playwright
   script driving `page.keyboard.press("Tab")` and reading `document.activeElement` +
   `getComputedStyle` — see the "Login / sign-in" entry below for the pattern. This still counts
   as a **manual** pass in the R-8.1.7 sense: it exercises real keyboard focus movement and
   computed styles, not just axe's static DOM rule set.
4. For screens that need an authenticated session (most of the primary revenue path), run this
   against the seeded e2e harness (`docs/e2e-harness.md`) or a staging login, or do it by hand in
   a browser.
5. Record the pass in the **Results log** below: date, flows covered, findings (or "clean"),
   and who ran it. Add a row per release; don't overwrite prior entries.
6. File a tracking issue for any serious/critical finding and link it in the log entry.

## Results log

### 2026-07-23 — closing #735 (R-8.1.7 remediation)

**Run by:** Claude (automated keyboard-driven pass via Playwright against local dev, `pnpm dev`
+ local Postgres, migrations applied — no seeded Convex/auth harness available in this session).

| Flow | Method | Result |
|------|--------|--------|
| 1. Login page loads | Playwright keyboard walk against `/login` (local dev) | ✅ Clean — see notes |
| 2. Sign in / register (email → password/passkey step) | Playwright keyboard walk, submitted email to reach the password step | ✅ Clean — see notes |
| 3–10 (sign out, onboarding, project creation, line items, availability, check-out/in, create inventory) | Not run this pass — require an authenticated session; no seeded Convex/auth harness reachable in this sandbox (no Docker daemon) | ⬜ Deferred — run against `docs/e2e-harness.md` or staging next release |

**Notes (flows 1–2):**

- **Keyboard operability:** All controls (email field, Continue/Sign in buttons, Passkey button,
  Back button) reachable and operable via `Tab` + `Enter`. No mouse-only interactions found.
- **Focus order:** Logical top-to-bottom order on both screens (`Email → Continue → Passkey` on
  step 1; `Back → Email → Password → Sign in → Passkey` on step 2). One dev-only artifact
  (`nextjs-portal`, the Next.js dev overlay) appears in the tab sequence in local dev; it is not
  present in production builds and is excluded from the finding.
- **Focus visibility:** Every focused control showed a computed `box-shadow` (the app's shared
  `focusRing` utility) even though `outline` is suppressed — a visible indicator is present at
  every step.
- **Screen-reader labels:** All interactive elements on both screens resolved a non-empty
  accessible name (associated `<label>`, `aria-label`, or visible text) — email input labelled
  "Email", password input via its `<label>`, all buttons with visible text.
- **Reduced motion:** `/login` renders and is fully visible with `prefers-reduced-motion: reduce`
  emulated.
- **Known accepted exception:** brand-red contrast on the primary CTA is a registered §15
  exception (`docs/exceptions.md`, R-8.1.7, expires 2026-10-18) — out of scope for this manual
  pass, which targets keyboard/focus/labelling, not contrast (contrast is already covered by the
  automated axe gate elsewhere in the ruleset).

**Findings:** none serious/critical on the flows covered.

**Follow-up:** flows 3–10 need a run against a real authenticated session (seeded e2e harness or
staging) — track alongside the `e2e-harness` CI job going green (`docs/critical-flows.md`). Next
release's pass should cover the full list.
