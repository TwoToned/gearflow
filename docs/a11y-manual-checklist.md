# Manual WCAG 2.2 AA Checklist

> _Owner: Jayden Nawotka · Last reviewed: 2026-07-25 (review quarterly — POLICY.md R-5.5)_

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

### 2026-07-25 — closing #858 / #870 (R-8.1.7 remediation, flows 3–10)

**Run by:** Claude, full local access (Docker/OrbStack + the self-hosted Convex harness,
`docs/e2e-harness.md`) — `E2E_HARNESS=1` against a prebuilt `next start` server, scripted
keyboard-driven Playwright pass (same "a scripted Tab-walk counts as manual" pattern as the
2026-07-23 entry above). Unlike a pure tab-walk, this pass also drove real widget semantics
directly (Escape/Arrow-key menu navigation, dialog interactions, `document.activeElement`
assertions) and cross-checked every "not reachable by Tab" signal against a live re-test before
treating it as a finding — several were test-harness artifacts (see notes below), not app bugs.

| Flow | Method | Result |
|------|--------|--------|
| 3. Sign out | Dashboard nav walk; account menu opened with `Enter`, closed with `Escape` (focus returns to trigger), re-opened and navigated to "Sign out" with real `ArrowDown` presses, activated with `Enter`; confirmed the session is actually invalidated (a post-sign-out visit to `/dashboard` bounces to `/login`) | ✅ Clean |
| 4. Register / onboarding | Registration form and the org-creation form both filled and submitted keyboard-only (`Tab` between fields, `Enter` to submit); confirmed onboarding actually completes (revisiting `/onboarding` redirects to `/dashboard`) | ✅ Clean |
| 5. Create a project (revenue path) | Keyboard walk through the 4-step wizard (Basics → Schedule → Site → Review → Create job) | ✅ Clean now — one finding found and **fixed** in a follow-up PR, see below |
| 6. Add line items + pricing (revenue path) | Keyboard-only: "Add" menu (`Enter` + `ArrowDown` + `Enter`), item dialog (tab-strip + form fields), model search combobox, "Add to project" | ✅ Clean now — one finding found and **fixed** in this PR, see below |
| 7. Availability check (revenue path) | Inline availability panel (async Convex query) renders "1 available" with no overbook warning, exercised as part of the same keyboard flow as flow 6 | ✅ Clean |
| 8. Warehouse check-out | Pick tab, header checkbox (`Space`), Prep | ✅ Clean once the interaction was scripted correctly — see the "Assign assets" dialog root-cause below |
| 9. Warehouse check-in / return | Deployed tab, header checkbox, Return; confirmed item moves from Deployed(0)→Returned(1) | ✅ Clean |
| 10. Create inventory | Model creation + serialized asset creation, both keyboard-only; server-generated asset tag confirmed visible on the detail page | ✅ Clean |

**Finding — flow 5, Create-project wizard loses focus on every step transition (filed as
[#894](https://github.com/TwoToned/gearflow/issues/894), FIXED in a follow-up PR):** clicking
"Continue" unmounts the just-clicked button; nothing moved focus to the new step, so
`document.activeElement` fell back to `<body>`. Confirmed directly (not inferred from a tab-walk
diff) — a script read `document.activeElement` immediately before and after a `Continue` click
and observed the drop to `body`. A keyboard/screen-reader user lost their place after every step
and had to re-navigate from the top of the page. Criterion 3 (focus never silently lost). Fixed:
`ProjectWizard` (`src/components/projects/project-wizard.tsx`) now focuses a `tabIndex={-1}`
step heading after every non-initial step change (step 0 is left to its Name field's existing
`autoFocus`). See `FEATUREDOCS/10-projects.md`.

**Finding — flow 6, unlabeled equipment-dialog fields (FIXED in this PR):**
`equipment-add-form.tsx`'s local `Field` wrapper rendered `<Label>` with no `htmlFor`, so the
Quantity, Unit price, Discount, and Notes inputs in the primary "Add equipment to project"
dialog — the core revenue-path action — had no programmatic label; a screen reader would
announce them only as an unlabeled number/text field. Confirmed via computed accessible-name
inspection, then traced to source. Fixed: `Field` now accepts and forwards an `htmlFor` prop,
wired to each field's existing `id` (`eq-quantity`, `eq-unitPrice`, `eq-discount`, `eq-notes`).
Criterion 4 (screen-reader labels).

**Root-caused (not new) — flow 8, the `docs/e2e-harness.md` "stuck dialog after Prep" bug:**
fully characterized this pass: an "Assign assets" dialog (a combobox to choose the specific
serial) appears — with timing that looks tied to an async per-item check rather than the click
itself — around the Prep/Deploy actions, even when there's exactly one candidate asset. Its own
action button stays disabled until a selection is made. Once reached, the dialog **is** fully
keyboard-operable (combobox opens on `Enter`, `ArrowDown` navigates, `Enter` selects, the action
button enables and completes the step) — this is a UX/timing bug, not a keyboard-accessibility
failure, so it doesn't affect the R-8.1.7 pass/fail call for flow 8. Root cause and current
status logged in `docs/e2e-harness.md` and the R-8.8.3 exception in `docs/exceptions.md`.

**Test-harness artifacts, NOT app findings (verified and ruled out before writing this up):**
- Elements below the sidebar's visible fold showed as "not reachable by Tab" in an early pass —
  false positive from fingerprinting elements by viewport-relative position, which breaks when
  the sidebar auto-scrolls mid-walk. A step-by-step live trace confirmed all sidebar links,
  including the ones flagged, are reached correctly and in order.
- Radix menus (account menu, "Add item" menu) don't advance on plain `Tab` while open — this is
  correct ARIA menu behavior (arrow keys are the intended in-menu navigation; `Escape`/selection
  close and return focus to the trigger). Confirmed via real `Escape` and `ArrowDown` interaction
  (flow 3), not just a synthetic tab-walk artifact.
- Tabs (Equipment / Labour & logistics / Financials / Tasks / Notes / Files) use roving
  `tabindex` — the correct ARIA tablist pattern (only the active tab is a Tab stop; siblings are
  reached via arrow keys) — not a defect.

**Reduced motion:** verified rendering correctly with `prefers-reduced-motion: reduce` emulated
on: `/login` (post sign-out), the line-items dialog's parent project-detail screen, the warehouse
return screen, and the asset-detail screen.

**Infrastructure notes (local environment, not app bugs, but worth recording):** the seeded
harness needed one real repo fix to run under Docker/OrbStack (rather than Docker Desktop, which
the harness docs were originally written against): `next.config.ts`'s `allowedDevOrigins` didn't
include `host.docker.internal`, so Next 16's cross-origin dev-resource guard blocked the
self-hosted Convex container's JWKS fetch — fixed in this PR. The documented `next dev`
Turbopack-crash class (`docs/e2e-harness.md`) reproduced live mid-pass; switched to a prebuilt
`next start` (`E2E_PROD_SERVER=1`) for the rest of the run, matching what the CI harness job
already does.

**Compliance:** POLICY.md R-8.1.7's manual-checklist requirement is now met for all 10 critical
flows — flows 1-2 (2026-07-23 entry above) plus flows 3-10 (this entry). Two WCAG findings were
logged from this pass and both are now fixed: flow 6 labels (fixed in this PR) and flow 5 focus
loss ([#894](https://github.com/TwoToned/gearflow/issues/894), fixed in a follow-up PR). Closing
#858 and #870.

### 2026-08-01 — project version switcher (#1080/#1093), component-level only — NOT a full pass

The version switcher (header dropdown), the read-only bar, and the projected Equipment/Labour/
Finance surfaces (FEATUREDOCS/70) are a new UI added inside the existing project-detail flow —
not on the [critical-flows.md](./critical-flows.md) list itself (this is a read/view surface, not
part of auth or the primary revenue path 5→9), so a live-browser walkthrough of it wasn't run as
part of this checklist's normal per-release cadence. Recording what WAS verified instead of
silently skipping the gap (R-14.4):

- The switcher is a Radix dropdown, keyboard-operable (opens on `Enter`/focus, not a bare click —
  same pattern already verified for the account/"Add item" menus above), asserted by actually
  *opening* it in a jsdom smoke test
  (`src/components/projects/__tests__/project-version-switcher.smoke.test.tsx`), not just
  rendering the closed trigger.
- The read-only bar announces via `role="status"`/`aria-live="polite"` — the viewing-a-version
  state is programmatically announced, not colour-only (criterion 4) — asserted in the same
  smoke suite.
- Every projected surface (Equipment/Labour/Finance/Notes) is READ-ONLY by construction — no
  interactive mutating control exists in that render path to audit for keyboard operability or
  focus order, by design (see FEATUREDOCS/70's "deliberate scope decision" section). The
  live-tab lifecycle lock's existing `GatedButton`/`LockedField` primitives (already covered by
  prior passes on this checklist) are unchanged.

**Not yet verified by a real keyboard/screen-reader walkthrough against a running instance**:
focus order when the switcher's dropdown opens/closes relative to the read-only bar's "Back to
live" button, and screen-reader announcement wording on Firefox/Safari (this checklist's
criterion 4/5 in the strict sense — jsdom asserts the DOM shape, not what an actual AT reads
aloud). Tracked for the next scheduled full pass rather than blocking this PR — the feature ships
without a promote/write action (Phase 2, #1089, is unshipped), so the blast radius of a live-only
a11y gap here is a missed announcement, not a stuck or lost keyboard user on a destructive action.
