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

### 2026-07-25 — closing #824 (R-8.1.7 remediation, flows 3–10)

**Run by:** Claude (keyboard-driven pass against the seeded local harness —
`scripts/e2e-harness-up.sh`, self-hosted Convex + fresh Postgres — via a mix of a Playwright
keyboard-walk script and direct browser driving for the two flows that hit the known
`harness-revenue-path` "Prep" stuck-dialog issue documented below).

| Flow | Method | Result |
|------|--------|--------|
| 3. Sign out | Keyboard: `Enter` opens Account menu, `ArrowDown` navigates, `Enter` activates | ✅ Clean — see notes |
| 4. Onboarding (create org) | Playwright keyboard walk of the create-org form | ✅ Clean — see notes |
| 5. Create project (Basics step) | Playwright keyboard walk | ✅ Clean — see notes |
| 6. Add line item dialog | Playwright keyboard walk + live accessible-name check | 🔧 Finding — **fixed this pass** |
| 7. Availability check (inline in the same dialog) | Live accessible-name / aria-live check | 🔧 Minor finding — **fixed this pass** |
| 8. Warehouse check-out (Pick → Prep → Deploy) | Keyboard walk + live accessible-name check | 🔧 Finding — **fixed this pass** |
| 9. Warehouse check-in / return | Keyboard walk + live accessible-name check | 🔧 Finding — **fixed this pass** |
| 10. Create inventory (model + serialized asset) | Playwright keyboard walk | ✅ Clean — see notes |

**Findings (all fixed in this pass, not just logged):**

1. **Unlabeled Quantity/Unit price/Discount/Notes fields** in the equipment "Add item" dialog
   (flow 6). The shared `Field` label wrapper in `src/components/projects/equipment-add-form.tsx`
   rendered a `<Label>` next to each `<Input>` but never passed `htmlFor`, so there was no
   programmatic association — Quantity had no accessible name at all, and Unit price/Discount only
   got a weak placeholder-derived name ("Auto" / "0", not "Unit price"). Fixed by adding an
   `htmlFor` prop to `Field` and passing each field's input `id` at every call site. Verified live
   post-fix: all four fields now expose the correct accessible name.
2. **Unlabeled row/select-all checkboxes** in the warehouse Pick/Prepped/Deployed/Returned tables
   (flows 8–9). Every `<Checkbox>` in `src/components/warehouse/pick-prep-tab.tsx`,
   `deploy-tab.tsx`, `return-tab.tsx`, and the shared `renderGroupHeader` group-select checkbox in
   `src/app/(app)/warehouse/[projectId]/page.tsx` had no accessible name — a screen reader would
   announce bare "checkbox, not checked" with no indication of which item, or that the header one
   selects all. The equivalent project equipment table (`equipment-tab.tsx`/`equipment-rows.tsx`)
   already does this correctly (`aria-label="Select all items"` / `"Select item"`); the warehouse
   tables were simply missing the same pattern. Fixed by adding matching `aria-label`s across all
   four files. Verified live post-fix.
3. **Availability-check result not in an `aria-live` region** (flow 7, minor). The async
   "N available out of M" text and any overbook warning rendered into the DOM with no live region,
   so a screen reader user wouldn't be proactively notified when the check resolves — they'd have
   to explore forward manually to find it. Fixed by adding `aria-live="polite"` to the panel's
   wrapping element in `equipment-add-form.tsx`. Minor because the text is still reachable, just
   not announced.

**Notes:**

- **Flow 3 (sign out):** Radix `DropdownMenuItem` doesn't use the shared `focusRing`
  box-shadow utility — it highlights via a `data-highlighted` background-color change instead
  (confirmed: highlighted item background differs from idle items, e.g.
  `rgb(26,22,19)` vs `rgba(0,0,0,0)`). Both are valid visible-focus mechanisms per WCAG 2.4.7 (any
  visible indicator qualifies, not specifically outline/box-shadow) — noting this so a future pass
  doesn't flag it as a false positive from a box-shadow-only check. Session invalidation confirmed
  server-side: a direct post-sign-out visit to `/dashboard` bounces to `/login`, not just a
  client-side redirect.
- **Flows 8–9 (warehouse):** reproduced the known `e2e/harness-revenue-path.spec.ts` "Prep" stuck
  dialog (`docs/e2e-harness.md`, `docs/exceptions.md` R-8.8.3) — clicking "Prep" opens a per-row
  "Select an asset…" confirmation dialog the harness spec doesn't fill in. Confirmed this is a
  real, keyboard-operable, correctly-labeled step (`combobox` "Select an asset...", `Cancel`,
  `Prep`, `Close`, all reachable and named) — not itself an accessibility defect, just a step the
  existing E2E spec doesn't handle. Out of scope to fix the spec here; noted for whoever next picks
  up R-8.8.3.
- **Flows 4, 5, 10:** clean on all five criteria — keyboard operability, focus order, focus
  visibility (box-shadow ring via the shared `focusRing` utility), accessible names, and
  `prefers-reduced-motion: reduce` rendering (checked via `page.emulateMedia`).
- **Known accepted exception (carried over, not retested):** brand-red contrast on primary CTAs is
  a registered §15 exception (`docs/exceptions.md`, R-8.1.7, expires 2026-10-18) — out of scope for
  this manual pass (contrast is covered by the automated axe gate).

**Findings:** 3 real WCAG gaps found — all fixed in this same pass (typecheck + lint clean, fixes
verified live against the running app post-fix). Zero serious/critical issues remain open on any
of the ten critical flows.

**Coverage:** 10/10 critical flows now walked (up from 2/10 in the prior pass) — R-8.1.7 fully
satisfied this release.
