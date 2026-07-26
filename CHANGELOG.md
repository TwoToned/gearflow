# Changelog

All notable changes to RVLT Flow will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **#948** — Clients can now have multiple contacts (name/role/email/phone/notes,
  one exclusive primary), fully optional. Projects can select a specific contact
  (defaults to the client's primary) that PDFs, WooCommerce matching, and search
  now resolve through. Legacy single-contact fields stay live as a fallback during
  the migration window.
- **#949** — Crew roles now carry a charge rate alongside their existing cost
  rate. Services with crew assigned auto-price from the role's charge rate (with
  a per-service override), and show margin (charge − cost) to manager+ users on
  the service card, the services summary tile, and the project P&L panel. New
  `/crew/settings` admin page for managing roles (previously undocumented but
  referenced route with no implementation).
- **#945** — Recurring preventative maintenance: model-wide service schedules
  on a fixed calendar cadence (interval + anchor date), a daily generation cron,
  and a `/maintenance/due` worklist for checking off serialised units or bulk
  quantity sessions. Schedule due-ness never affects availability — a hard,
  regression-tested invariant.
- **#946** — Sub-hires can now link to a supplier order (FK, same-supplier
  enforced), with a "create order from sub-hire" prefill action, order header
  editing and item CRUD (previously read-only), computed order totals, and
  quoted-vs-invoiced reconciliation. Supplier detail pages show de-duplicated
  spend rollups across linked and unlinked sub-hires/orders.
- **#790** — Org-level document settings (footer text, terms & conditions, quote
  validity days) on a new "Documents" card at `/settings/branding`. Quotes now show
  a T&Cs block (omitted when unset) and a real computed "valid until" date instead
  of a static "valid for 30 days" blurb.

### Fixed

- **#790** — The quote layout no longer shows a "/day" (or other rental-period)
  suffix next to prices. Audited discount/item-notes/group-notes rendering on the
  quote end-to-end and confirmed they already flow correctly through the new
  pipeline (regression-tested in `document-composer.test.ts`).

- **#790** — Project documents (quote, invoice, pull slip, delivery docket, return sheet)
  longer than one page silently dropped their tail: since no stored `DocumentTemplate` could
  be created anymore, every document fell through to the legacy single-page builders, which
  had no pagination. Replaced with one fixed-layout pipeline (`document-layouts.ts` →
  `document-composer.ts`, a net-new purpose-built pagination engine) that paginates every
  doc type by default — atomic table rows, repeated headers, no tail-drop. See
  `docs/designs/pdf-system-redesign.md` and FEATUREDOCS/13.

### Removed

- **#790** — Deleted the PDF customization engine (~8,300 LOC): dual render pipelines,
  the 13-type section/block model, `{token}` resolution, visibility conditions, stored
  per-org document/brand templates, and the dormant Convex `documentTemplates`/
  `brandTemplates`/`sectionPresets` tables + CRUD. No template designer of any kind exists
  or is planned. `/settings/documents` (read-only template list) and its nav entry are
  gone; the project page's document dropdown no longer has a per-type custom-template
  submenu. Org-level branding (`/settings/branding`) is unaffected.

### Fixed

- **R-8.1.7** (#894) — The "Create a project" wizard (`/projects/new`) silently lost keyboard
  focus on every step transition: clicking Continue/Back unmounts the just-clicked button, and
  with no explicit target the browser fell back to `document.body`, forcing keyboard/screen-reader
  users to re-Tab from the top of the page after every step. `ProjectWizard`
  (`src/components/projects/project-wizard.tsx`) now focuses a `tabIndex={-1}` step heading after
  every non-initial step change; step 0 keeps its existing `autoFocus` on the Name field instead
  (which already re-fires correctly since the step content remounts).

- **R-5.3** (#900, tracked under #905) — Fixed `scripts/check-docs-npm-npx.mjs`'s detection
  logic itself, the actual root cause of this rule's 4th recurrence (#731, #820, #856 only ever
  fixed scope/diff-vs-full-repo). `BAD`'s `npm run` branch required a non-whitespace char with
  zero separator right after "npm run", which real prose never satisfies — the check silently
  never matched a single `npm run`/`npm install`/`npm test`/`npm ci` instruction; now
  `/\bnpm (run|install|ci|test|start|exec)\b|\bnpx\s/`. `ALLOW` was tested against the whole
  line, so any line that happened to mention "pnpm" anywhere whitelisted an unrelated npm
  command elsewhere on that same line; now a per-match ±40-char proximity window. Fixing the
  `npm run` branch made `\bnpx\b` newly match "npx" inside filenames like this script's own
  `check-docs-npm-npx.mjs` — narrowed to `\bnpx\s` (a real invocation always has a trailing
  space; a filename substring doesn't). Added `CHANGELOG.md` to `EXCLUDE` alongside
  `docs/audits/`/`docs/designs/archive/` — changelog entries are dated historical record, not
  live instructions, and the fixed `npm run` detection now matches historical entries like this
  changelog's own record of a since-deleted migration script. Corrected the 6 live violations
  the broken detection had let through: `docs/efficiency-billing-session-prompt.md`,
  `docs/designs/rvlt-flow-rebrand-migration.md`, `docs/designs/rvlt-polish-sweep.md` (×2),
  `docs/designs/ux-ui-redesign.md`, `NEWFEATURES/10-user-customisation.md`, and
  `FEATUREDOCS/19-mobile-pwa.md` now use `pnpm`/`pnpm exec`/`pnpm add`. Also reworded
  `CLAUDE.md`'s "never `npx convex`" line (redundant repeated `npx convex` mention pushed the
  second occurrence out of the `never`/`pnpm` proximity window) and `FEATUREDOCS/13-pdfs.md`'s
  reference to a deleted one-time migration script (dropped the redundant `npm run` invocation
  alongside the already-given `.ts` path). Mirrored the `npm run`/`npm install`/etc. coverage
  and the `CHANGELOG.md` exclusion into `scripts/quarterly-sweep.sh` §5's belt-and-braces grep
  for consistency with the CI gate.

- **R-2.4** (#851, tracked under #865) — `build-image.yml` now also tags the released Docker
  image `v${package.json version}` (alongside the existing `:latest`/`:${sha}` tags), so a
  running deployment can be traced to a SemVer version without a manual SHA→CHANGELOG lookup.

- **R-2.5** (#852, tracked under #865) — Closed Dependabot PR #608 (`typescript` 6.0.3 →
  7.0.2), open 7 days past the 3-day trunk-based budget and failing CI on the major bump
  alone. Recorded a dated §15 exception in `docs/exceptions.md` rather than merging broken
  code or leaving it silently stale.

- **R-2.8** (#853, tracked under #865) — Added a non-blocking PR-size advisory:
  `scripts/pr-size-check.mjs` (wired into the CI `hygiene` job) computes changed LOC against
  the merge-base, excluding R-0.5 exclusions, and posts/updates a soft PR comment when a PR
  exceeds the T-2 400-LOC SHOULD-level target. No retroactive action was needed for #850
  itself.

- **R-3.1** (#854, tracked under #866) — `src/app/(admin)/admin/users/page.tsx`'s Site Admin
  badge now uses the shared `isSiteAdminRole()` helper (`src/lib/admin-role.ts`) instead of a
  4th inline `role === "admin"` comparison, closing the recurrence #817's fix missed.

- **R-9.8** — Bumped `.collect-ratchet-full-baseline` 667 → 669: PR #887 added two new
  `.collect()` calls in `convex/roi.ts` (project-group/line-item rollup), both narrowed by
  `withIndex("by_projectId", ...)` and additionally bounded by the surrounding
  `ROLLUP_READ_BUDGET`/`PROJECT_SCAN_CAP` guards — not the R-9.8 org-wide/whole-table hazard
  shape, but the full-count ratchet (`scripts/collect-ratchet.mjs`) still counts every
  `.collect()` and the baseline wasn't bumped when #887 merged, breaking CI on `main` for
  every subsequent PR.

- Closed the POLICY.md §5 R-5.3 finding (#856, tracked under #868): stale non-pnpm CLI
  invocations (Convex, Prisma, tsx, shadcn) in `docs/convex-backup-restore-runbook.md`,
  `docs/efficiency-billing-session-prompt.md`, `docs/convex-observability-runbook.md`,
  `docs/convex-search-decision.md`, `DESIGN.md`, `docs/designs/ux-ui-redesign.md`, and
  `NEWFEATURES/10-user-customisation.md` now use `pnpm exec`/`pnpm dlx`, matching the repo's
  pnpm-only convention. `scripts/check-docs-npm-npx.mjs` now scans every tracked `*.md` file on
  every run instead of only newly-changed diff lines — the diff-scoped check structurally
  couldn't see pre-existing contradictions, which is why this exact rule recurred across three
  audit rounds (#731, #820, #856). Excludes `docs/audits/` and `docs/designs/archive/` (frozen
  historical records that quote past commands, not live instructions) and `.hermes/` (agent
  planning scratch) alongside the existing `.agents`/`.claude`/`node_modules` exclusions.
  `scripts/quarterly-sweep.sh` §5's grep mirrors the same exclusions and its message now
  reflects that CI is full-repo, not diff-scoped.

- Closed the two POLICY.md §9B remediation-verification findings (#830, #831), tracked under
  #841:
  - **R-9.6** — `convex/lib/errorReporting.ts`'s outbound POST to PostHog now carries the same
    explicit 10s `AbortController` timeout `invokeCronRoute`'s fetch already had, closing the
    one remaining unbounded call in the cron-failure reporting path. Both Resend SDK send paths
    (`src/lib/email.ts`, `convex/emailActions.ts`) — which have no timeout option of their
    own — are now wrapped in a `withTimeout()` helper (`src/lib/fetch-with-timeout.ts` /
    `convex/lib/promiseTimeout.ts`) that bounds how long the caller waits.
  - **R-9.12** — `convex/emailActions.ts`'s `deliver` (the second, Convex-scheduled Resend send
    path) now reports T-P4 vendor-cost usage via a new `convex/lib/vendorUsage.ts` helper, so
    spend routed through it is no longer invisible to the tracked `vendor_usage` metric. The
    "reviewed monthly with a named owner" clause, which had no operative mechanism, is now
    explicitly covered by the dated §15 exception in `docs/exceptions.md` (R-9.12) alongside
    80%-threshold alerting, rather than left as unstated intent.

## [0.25.4] - 2026-07-23

### Fixed

- Closed all three POLICY.md §3 DRY/modularity audit findings (#817, #818, #819):
  - The client-side site-admin nav/badge checks in `user-nav.tsx` and
    `account/page.tsx` (3 inline `role === "admin"` comparisons) now go through
    a shared, client-safe `isSiteAdminRole()` helper (`src/lib/admin-role.ts`),
    also adopted by the server-side `admin-auth.ts` guard (R-3.1).
  - Added a complexity ratchet (`scripts/complexity-ratchet.mjs`, wired into
    the CI `hygiene` job) so the warn-only `complexity` ESLint rule can no
    longer silently regress — the violation count is now blocking on any
    increase over the committed baseline, mirroring the existing
    any-ratchet/knip-ratchet/collect-ratchet pattern (R-3.6).
  - Added `docs/glossary.md` documenting core domain terms and the one
    intentional alias (`client` vs WooCommerce's `customer_*` payload fields)
    (R-3.10).

## [0.25.3] - 2026-07-23

### Fixed

- Closed all four POLICY.md §8.6 Forms & Validation audit findings (#773, #745,
  #746, #747, #748):
  - Business constraints (string length caps, numeric min/max bounds, array
    length caps) are now re-enforced at the Convex boundary for every
    browser-direct write mutation, not just checked by the client Zod schema —
    a caller with a valid session could previously invoke a mutation directly
    and skip them entirely. Added `convex/lib/fieldGuards.ts` (generalising
    the existing money-field guard pattern) and wired mirrored bounds into
    asset, kit, crew, category, check-item, client, model, maintenance,
    line-item, project, project-service, and supplier write files.
  - Schema variants that re-declared a base schema's fields (e.g. an
    update/patch form of a create schema) now derive via `.omit()`/`.pick()`/
    `.partial()` instead, across 12 validation files.
  - Added a `withValidatedBody()` wrapper (`src/lib/api-validation.ts`) that
    makes an API route's JSON-body schema a required part of its function
    signature — an unvalidated route is now a missing wrapper call, not a
    discipline lapse. Applied it to every route that reads a JSON body,
    including the document-template preview endpoint, which previously had no
    validation at all.

## [0.25.2] - 2026-07-23

### Fixed

- Collapsed the 6 independent `User.role === "admin"` (site-admin) checks into one
  shared guard, `src/lib/admin-auth.ts` (POLICY.md R-8.4.2 / R-8.4.4, #742, #743):
  `requireSiteAdmin()`, `requireSiteAdminApi()`, and `isSiteAdmin()` are now the only
  place that queries `User.role` for site-admin authorization. `src/server/site-admin.ts`,
  `src/server/invitations.ts` (`checkIsSiteAdmin()`), and `src/app/(admin)/layout.tsx`
  all delegate to it instead of re-implementing the check. No behavior change.
- Extracted `shouldUseSecureCookies()` (`src/lib/cookie-security.ts`) out of
  `src/lib/auth.ts` and added a unit test asserting the Secure-cookie gating logic
  in both http (dev) and https (prod) modes, closing the last gap in R-8.4.5 (#744) —
  the existing `e2e/harness-cookie-flags.spec.ts` integration test already covered
  HttpOnly/SameSite but couldn't exercise Secure locally (no https harness).

## [0.25.1] - 2026-07-23

### Fixed

- Fixed all 19 of the repo's circular-dependency violations — POLICY.md R-3.5 now
  reports zero (#730, #766):
  - Extracted `equipment-row-types.ts`, `model-category-join.ts`, and `actor-types.ts`
    so the equipment-tab components, the categories/models Convex reads, and the
    ActorContext auth seam no longer import each other in a loop.
  - Extracted `convex-service-signer.ts` — a separate, minimal Better Auth instance
    (jwt plugin only) that mints the Convex SERVICE token, so `convex-auth.ts` no
    longer needs the full `auth.ts` instance (whose hooks mirror data into Convex,
    which needs the service token — the original bootstrap cycle).
  - Extracted `org-settings-types.ts` so `org-settings-read.ts` no longer imports
    `server/settings.ts` for the `OrgSettings`/`OrgBranding`/`TestTagSettings` shapes
    while `server/settings.ts` imports real functions back from it.
  - No behavior change in any of the above.
- Stale npm-based instructions in `FEATUREDOCS/36-testing.md` and
  `convex/README.md` replaced with `pnpm`/`pnpm exec convex` (R-5.3, #731).
- 68 FEATUREDOCS/docs files were missing an `Owner`/`Last reviewed` header (R-5.5,
  #732) — added, matching the existing README/CLAUDE.md/ARCHITECTURE.md convention.

### Changed

- Import-cycle CI check is now a ratchet (`depcruise-ratchet.mjs` / `.depcruise-baseline`),
  matching the existing Knip dead-code ratchet: the total circular-dependency count is
  blocking and may never increase, closing the gap where `--ignore-known` only caught
  genuinely new cycles. Baseline is 0.

### Added

- CI gate blocking new npm-based doc contradictions introduced in a PR diff
  (`scripts/check-docs-npm-npx.mjs`, wired into the `hygiene` CI job).
- Quarterly Sweep gate failing the workflow when a critical doc (architecture,
  onboarding, runbooks) hasn't been reviewed within the last quarter
  (`scripts/check-docs-review-cadence.mjs`, R-5.5 / T-14).

## [0.25.0] - 2026-07-18

### Changed

- **Adopt 3-part Semantic Versioning** (was a 4-part `0.24.17.0` scheme, which is not
  valid SemVer). This release starts the 3-part sequence at `0.25.0` (R-2.4).

### Added

- Adopted the Codebase Management & Hygiene Policy (`POLICY.md`, WEB profile) as the
  governing standard; wired it into `CLAUDE.md`.
- Baseline compliance audit at `docs/audits/2026-07-18-hygiene-policy-baseline-audit.md`.
- Required root files: `.editorconfig`, `SECURITY.md`, `CONTRIBUTING.md` (declares naming
  conventions). Exception register at `docs/exceptions.md`.
- README governance section: policy profile, docs map, and budget registry (R-0.4).
- ESLint gates (warn-level) for complexity, file/function length, `no-explicit-any`, and
  naming conventions (R-3.6/R-3.7/R-8.2.2/R-3.9).
- Dependabot configuration for npm + GitHub Actions (R-6.5).
- CI hygiene job: advisory Knip dead-code scan (R-4.2) and gitleaks secret scan (R-7.3),
  plus a **blocking** `pnpm audit` high-severity gate (R-6.6).
- Advisory bundle-size budget via size-limit (R-8.1.5 / T-8).
- Security headers: HSTS and a report-only Content-Security-Policy (R-8.11.2).
- PII data inventory at `docs/pii-inventory.md` (R-8.12.1).
- E2E: critical-flows list (`docs/critical-flows.md`) and a first login smoke spec (R-8.8.3).
- Tracked `pnpm-workspace.yaml` (previously gitignored) so dependency overrides ship
  reproducibly.

### Fixed

- Resolved all high-severity dependency advisories via pnpm overrides (serialize-javascript,
  hono, ws) — `pnpm audit --audit-level high` is clean (R-6.6).
- Corrected `npm`/`npx` commands to `pnpm`/`pnpm exec` across README, `CLAUDE.md`, and
  `playwright.config.ts` (repo is pnpm-only) (R-5.3/R-5.8).

## [0.24.17.0] - 2026-07-17

### Changed

- Docs: repo-wide documentation tidy-up ahead of a planned audit. FEATUREDOCS,
  CLAUDE.md, ARCHITECTURE.md, README.md, and PROMPT.md corrected to match the
  post-Convex-migration architecture — stale `src/server/*.ts` paths updated to
  their current `convex/*.ts`/`*Writes.ts` locations, wrong facts fixed (Prisma
  version, PDF engine, dead React Query/Leaflet claims, a never-built PR-preview
  section), and 13 fully-shipped design docs archived to `docs/designs/archive/`.
  No behavior change — one stale code comment corrected
  (`src/components/projects/equipment-tab.tsx`), everything else is docs/config.

### Removed

- Dead pre-Coolify pm2 deploy config (`ecosystem.config.js`/`.cjs`), an unused
  `nixpacks.toml`, a superseded scratch spec (`KITEXPANSION.MD`), and 3 abandoned
  design docs that were never built and are superseded by later decisions.

## [0.24.16.0] - 2026-07-17

### Changed

- Performance: the project overbooking check no longer scans a model's entire booking history across every project ever created — it now only looks at projects whose dates actually overlap the one you're viewing. This was the single largest driver of backend load this month (77% of it) despite the app having just 2 active users.
- Performance: the asset, project, kit, crew, client, and supplier list/table pages no longer pull the entire org's records into the browser to filter/sort/paginate locally. Filtering, sorting, and paging now happen on the server, so opening any of these tables — and any edit anywhere in the org — no longer re-sends the whole table to every open tab.
- Performance: the equipment tab no longer opens two extra live connections per line item on a project (previously used for showing who's editing a row and any review flags on it) — that data now comes from two shared connections for the whole tab instead.
- Reliability: fixed a bug where selecting a Status, Condition, Location, Category, Type, Department, or Active/Archived filter chip on the Kits, Crew, Client, or Supplier tables would error out instead of filtering, introduced by the pagination work above and caught before release.
- Security: fixed a narrow information leak where sorting the crew list by an unsupported field could reveal the relative ordering of a crew member's private calendar-feed link token, even though the token's value was already hidden from the response.

### Removed

- Deleted an unused check-history query with no live callers, left over from an earlier refactor.

## [0.24.15.0] - 2026-07-12

### Changed

- Mobile: the sub-hire order dialog’s item lists now render as cards on phones (edit / move / remove per item, plus per-item placement). This completes the sweep — every operator-facing list table in the app now becomes cards on a phone instead of a cut-off, horizontally-scrolling table.

## [0.24.14.0] - 2026-07-12

### Changed

- Mobile: the project crew panel now renders as cards on phones — select crew, change an assignment status, and use the row actions inline, all without a cramped horizontal-scroll table.

## [0.24.13.0] - 2026-07-12

### Changed

- Mobile: the crew-member detail page (project assignments, availability blocks, time entries) now renders as cards on phones, with each row’s actions intact.

## [0.24.12.0] - 2026-07-12

### Changed

- Mobile: more surfaces render as cards — a test-and-tag asset's test history, the warehouse close-out exceptions list, and the sub-hire order item breakdown.

## [0.24.11.0] - 2026-07-12

### Changed

- Mobile: more tables render as cards — the model ROI "where it earned" list, the public auditor compliance report, and the model/kit checklist editors (reorder arrows stay desktop-only; the remove action carries over to mobile).

## [0.24.10.0] - 2026-07-12

### Changed

- Mobile: the settings list tables (check-item library, service templates, test-and-tag profiles) now render as cards on phones, with their edit/delete row actions intact.

## [0.24.9.0] - 2026-07-12

### Changed

- Mobile: more list tables now render as cards on phones — asset model detail (serialized + bulk units, with their row actions), kit detail (items, bulk, assignments, scan history), and the project templates list. Loading and empty states show correctly on mobile too.

## [0.24.8.0] - 2026-07-12

### Changed

- Mobile: detail-page sub-tables now render as cards on phones instead of a cramped, cut-off table. First wave: client, supplier, location, and asset (maintenance history) detail pages, plus asset-category detail (models + kits). Adds a shared `MobileCardList` so the rest of the app's list tables can follow the same pattern.

## [0.24.7.0] - 2026-07-12

### Fixed

- Mobile: selecting or deselecting an item in a project list (equipment, crew, tasks, services) no longer makes the whole page jump. The bulk-action bar now pins above the bottom nav as an overlay instead of pushing the list up and down each time the selection changes.

## [0.24.6.0] - 2026-07-12

### Changed

- Mobile: equipment cards now use one uniform size. Group / sub-hire / kit container cards are no longer larger than plain line-item cards — they stay set apart by their icon, heavier edge, bolder weight and qty·total summary, so a long list reads evenly.

## [0.24.5.0] - 2026-07-12

### Changed

- Mobile: the project equipment cards now have a clearer visual hierarchy. Groups, sub-hire groups and kits render as distinct "container" cards (heavier edge, a small type icon, bolder title and a qty·total summary), while plain line items are a size step down and grouped items tuck in under their container. Kit contents stay recessed. Makes a big equipment list far easier to scan on a phone.

## [0.24.4.0] - 2026-07-12

### Changed

- Mobile: the project equipment tab now renders line items, groups and categories as cards (below 768px) instead of a horizontally-scrolling frozen-column table. Tapping a card selects it (like the warehouse scan cards); edit, move and delete live behind the row's kebab. Collaboration lock chips, review markers, comment threads and the per-unit assets indicator all carry over to the cards. Desktop is unchanged. The frozen "sticky column" on the equipment table has been removed; desktop selected rows show the full-row highlight again.

## [0.24.3.0] - 2026-07-12

### Changed

- Mobile: the project equipment line-item table now keeps the item name pinned on the left while the quantity, unit price, cost and total columns scroll sideways with smart wrapping — instead of hiding those columns and cramming the name into a narrow column. Selected rows show a red left-edge bar (so the frozen column reads cleanly); desktop is unchanged. The warehouse pull sheet’s frozen-column treatment is likewise scoped to mobile, leaving desktop as a plain table.

## [0.24.2.0] - 2026-07-12

### Fixed

- Mobile: tab bars (project and warehouse detail) and the job/warehouse lifecycle steppers now scroll sideways instead of running off-screen or colliding. The stepper keeps the current stage centered so you can always see where a job is, and both scroll regions are keyboard-accessible.

## [0.24.1.0] - 2026-07-12

### Added

- Mobile-friendly data tables. The warehouse **pull sheet** now keeps the item name pinned on the left while the quantity, asset-tag and location columns scroll sideways, with smart wrapping so long names, notes and badges never overlap or get cut off. New reusable building blocks — frozen-column tables, a Cards/Table view switch, and Compact/Comfortable/Relaxed row density — that the rest of the mobile redesign builds on. Table preferences are now remembered per user, so shared warehouse devices no longer carry one person's view over to the next.

### Fixed

- "Reset to default" on a list now also clears the saved view, instead of leaving you pinned to it.

## [0.24.0.0] - 2026-07-12

### Changed

- Group and kit revenue is now split **per item**, each weighted by its own best signal: its set
  price, then its usual hire rate, then its replacement cost. So a group can mix a priced item, a
  rate-only item and a cost-only item and split fairly — instead of one rate-less item forcing the
  whole group onto cost, or one rated item leaving the others at $0. Where an item has only a
  replacement cost, that cost is converted to a rate-equivalent (using your own fleet's average
  rate-to-cost, or ~1.5%/day of value) so it sits sensibly beside a rated item rather than dwarfing
  it. A fully-rated group still splits purely by rate; an all-cost group purely by cost.
- An item priced at exactly **$0** is now treated as a freebie — it takes no share of a group or
  kit's revenue and doesn't count toward ROI. An item with **no price set** ("—") is unchanged: it
  still earns via its rate or replacement cost.

  Existing projects update to the new split on next save, or all at once via
  `pnpm convex:backfill:revenue-allocation`.

### Changed

- Equipment tab assets are now shown by a compact **tick-circle icon** on each line that has
  assigned serials, instead of inline tags and expandable per-unit rows — keeps the table calm.
  Hover the icon to see the serials (own-stock **and bulk**, with fulfillment status); click it to
  reassign a unit to another same-model line or view its movement history.


## [0.23.5.2] - 2026-07-12

### Fixed

- Equipment tab now shows the asset tags for **multi-quantity serialised lines** (e.g. 3× a mic
  scanned to three specific serials). These lines keep their serials on per-unit records rather than
  the line itself, and those asset records weren't being loaded — so the tags rendered blank while
  single-quantity items and accessories showed fine.

## [0.23.5.1] - 2026-07-11

### Changed

- Bulk actions on projects (delete / move / edit / status across equipment, services,
  crew, and tasks) now run as a **single backend operation** instead of one call per
  selected row. Removing or editing 50 items is now one round-trip, not 50 — so large
  selections land in roughly constant time rather than getting slower the more you pick.

## [0.23.5.0] - 2026-07-11

### Added

- **See which serialised assets are on a job.** The project Equipment tab now shows the specific
  asset tag on each line — inline for single-quantity lines, and multi-quantity lines expand into
  one row per physical unit with a fulfillment status badge (Assigned / Prepped / Deployed /
  Returned). Kit-member serials show on their child rows too.
- **Reassign a unit to another line.** When a scanned asset auto-picked onto the wrong same-model
  line, a per-unit "Reassign" picker moves it to the right line (labelled by category/group) without
  re-scanning. Guarded to same model, same project, with capacity checks.
- **Per-unit movement history.** A history button on each unit shows that serial's recent
  check-out / check-in events — where it went, who scanned it, and when.

### Fixed

- Returned units are no longer deleted by a plain de-prep, so a job keeps the record of exactly
  which physical assets went out even after it's returned and closed.

## [0.23.4.0] - 2026-07-11

### Added

- **Bulk operations on projects.** Select multiple items on any of the four project surfaces and act
  on the whole selection at once, instead of repeating the same single-row action over and over.
  - **Equipment / line items:** row checkboxes with a select-all header, then bulk **delete**,
    **move to group/category**, and **edit** (set pricing type, discount as $ or %, notes, or the
    optional flag across the selection).
  - **Services:** per-card selection with bulk **set status** and **delete**.
  - **Crew:** a selection column with bulk **set status** and **remove** (respecting crew
    permissions).
  - **Tasks:** per-task selection with bulk **move to status**, **set priority**, and **delete**.

### Changed

- Bulk actions run as one batched server request instead of one round-trip per item, so removing or
  editing many rows lands in a single step (one totals recalc and one audit entry per action)
  instead of dragging through the list one call at a time.

## [0.23.3.0] - 2026-07-11

### Changed

- Group and kit ROI now splits by **purchase value** (replacement cost × quantity) whenever the
  items don't *all* have a hire rate. Previously, if one item in a group had a hire rate and the
  rest didn't, the rate-less items were credited **$0** and the single rated item took the whole
  group price. Now a set is split by hire rate only when every item has one; otherwise it falls to
  replacement cost, so nothing is left at zero. A fully-rated group still splits by hire rate.

  For fleets whose gear mostly has no hire rates set, this means group and kit revenue is divided by
  what each item is worth to replace — the same figure ROI divides by.

## [0.23.2.0] - 2026-07-11

### Fixed

- **Sub-hire items no longer jump out of their groups/categories.** Adding a new item to a sub-hire
  order used to reset every already-placed item back to the order default. Now a manual placement is
  remembered and survives the next add/edit.
- **Sub-hire revenue placed inside a project group is counted again.** A sub-hire dropped into a
  project group had its client charge silently dropped from the project financials (its cost was
  still counted, so margin looked too low). Its charge is now counted individually, matching how the
  same line bills when it's ungrouped.

### Added

- **Group-level discount on sub-hires.** The sub-hire group editor now has a Discount (%) field
  (off the client charge, with a live margin preview) — matching the equipment add/edit screen.
- **Consistent placement picker across the add screens.** The Own stock, Kit, and Custom "Add …"
  dialogs now show the same Category + Group box (Own stock gained a Group picker; Kit gained a
  Placement section).

### Changed

- **New project groups default to Uncategorized.** Creating a group no longer forces you to pick a
  category first — just type a title.
- **Faster sub-hire create/detail load.** Creating a sub-hire runs its supplier lookup and order-
  number reservation concurrently, and the detail load only fetches the current project's
  categories/groups instead of the whole org.

## [0.23.1.0] - 2026-07-11

### Changed

- A custom item priced inside a group is now treated as **part of the group's flat price**, not an
  extra added on top. Previously a $2,000 group with an $1,800 custom item and a couple of headsets
  was billed $3,800 and handed the headsets the full $2,000 of ROI. Now the group bills $2,000, the
  custom item's $1,800 comes off the ROI pool, and the headsets get their real ~$200. A group with
  **no** flat price (used purely as an organiser) still bills its custom items on their own line, so
  nothing disappears from an invoice.

  Existing projects with a priced custom item inside a group will see their total drop to the group
  price on next save (the on-top amount is removed).

## [0.23.0.0] - 2026-07-10

### Added

- Lists now render as cards on a phone instead of a squeezed table. Each column
  declares the slot it takes on a card (title, subtitle, badge, meta, actions),
  and empty values are dropped rather than shown as a dash.
- Mobile viewport projects for Playwright (iPhone 12, Pixel 5, iPad Mini), whose
  device profiles carry the coarse pointer that mobile styles depend on.
- A test that enforces the mobile rules in CI: max two columns, 44px tap targets,
  and hover-only controls that stay reachable on touch.

### Fixed

- The primary action on six list screens ("New job", "New model", "Export CSV")
  was cut off at the right edge of a phone and could not be tapped.
- Controls that only appeared on hover — edit menus, the drag handle, the avatar
  editor, notification dismiss — were invisible and untappable on any touch
  device, because a phone has no hover.
- Buttons, filter chips, pagination and row menus now meet the 44px minimum tap
  target on a phone while keeping their compact size on desktop.
- Bulk assets no longer lose the "Available" figure on a card when the quantity
  is unset.
- Three-column strips and form rows now fold to two columns or fewer on a phone.
- Two tables clipped their columns instead of scrolling, putting content past the
  screen edge out of reach entirely.
- Long names on a card are no longer truncated by the status badges beside them.

## [0.22.0.0] - 2026-07-10

### Added

- **Fleet ROI report** (`Assets → Fleet ROI`). Every model ranked by what it has earned against
  what it cost to own, sortable by revenue, payback, or revenue per unit, and filterable by date
  window and by whether booked-but-uninvoiced work counts. Models with real capital and no revenue
  get their own "idle capital" figure — the number that tells you what to sell.
- **ROI tab on every model.** Total revenue attributed, fleet replacement cost, a progress bar to
  break-even, revenue per unit, and the list of projects that produced it.
- **Revenue allocation for gear inside kits and bundles.** Until now, gear booked inside a
  fixed-price kit or a priced group earned nothing on paper — the whole price sat on the parent
  line, and the models inside it reported $0 forever. A kit's or bundle's price is now split across
  the gear inside it, so per-model ROI is answerable for equipment that never ships on its own.
  Accessories take a share too.
- **Revenue allocation panel on kit detail.** Choose how a kit's price divides across the models
  inside it. Opens on a suggestion weighted by replacement cost, so the usual answer is just "Save".
  Change a kit's contents and the panel tells you the split is out of date — bookings quietly fall
  back to cost weighting rather than misattributing anything, and are never blocked.

### Changed

- Project revenue is attributed after the project discount, not before, so a discounted job credits
  its gear with what the client actually paid.
- Sub-hired gear no longer inflates the ROI of the equipment booked alongside it, and is never
  credited to a model you own.
- Quotes never count as revenue. Only completed and invoiced projects do, unless you explicitly ask
  to include booked work.

## [0.21.0.2] - 2026-07-10

### Fixed

- `SidebarMenuButton` would crash the sidebar, and render an empty menu item, if given a
  `tooltip`. Both faults sat in a branch no caller reached, so nothing surfaced them.

## [0.21.0.1] - 2026-07-10

### Fixed

- The ROI tab on a model page crashed on open. The "how revenue is attributed" tooltip was missing
  its provider, and nested a button inside the tooltip's own button.


## [0.21.0.0] - 2026-07-10

### Added

- **Webhooks.** Subscribe an HTTPS endpoint and RVLT Flow POSTs you a signed event when something happens, so an agent can react instead of polling. Four events: `project.status_changed`, `line_item.added`, `warehouse.checked_out`, `maintenance.created`. Deliveries are signed (HMAC-SHA256 over the timestamp and body, so they can't be replayed), retried with exponential backoff, logged for debugging, and auto-disabled if an endpoint stays dead. Manage subscriptions through the API like any other operation. Secrets rotate with a grace window during which both the old and new secret verify.
- **Batch availability.** `check_availability_batch` answers for up to 100 models in one call instead of one call per model.
- **Project line items now include their category name**, so grouping a project's gear by category takes one call.
- `list_operations` now supports `offset` for paging — with 537+ operations, everything past the first page was previously unreachable — and reports `total`, `offset` and `hasMore`.
- MCP tool names work as aliases everywhere: `describe_operation` and `call_operation` accept `search_assets` as readily as `assets.getAssets`, and each operation reports its `mcpTool`.
- REST `whoami` now returns `operationsAvailable`, matching the MCP tool.

### Fixed

- `list_operations` described the wrong operation count (it said 508 while the endpoint returned 537). Both now agree.
- `global_search` needs a query of at least 2 characters; the docs now say so, and an empty result means "no match", not an error.

### Security

- The webhook endpoint URL is checked against a strict SSRF policy: private, loopback, link-local, CGNAT and NAT64 addresses are refused across IPv4 and IPv6, redirects are not followed, and the hostname is resolved at delivery time so a name pointing at an internal address is also refused.

## [0.20.1.0] - 2026-07-09

### Added

- **The API now tells agents the exact shape of every request.** `describe_operation` returns real JSON Schema for each parameter — field names, types, allowed values, and which are required — generated from the same validation rules the operation enforces. Previously 93 operations described their input only as a TypeScript type name, so an agent had to guess. Nearly all of them are writes.
- **`primaryDateRange` on projects.** A project has six date fields (event, rental, load-in/out), most of them empty, and no obvious primary. Every project now carries one resolved `{ start, end, source }`, in the list response, so answering "what's coming up?" takes a single call instead of one per project. `source` says which pair the answer came from.
- **OpenAPI 3.1 at `/api/v1/openapi.json`.** The whole surface, generated from the same registry the API runs on, for SDK generation and request-validation tooling.
- The MCP server now advertises `tools.listChanged`, so a client holding a cached tool list from before a deploy can tell it is out of date. If you only see two tools, reconnect.

### Changed

- Agent docs at `/llms.txt` now document the project date fields and which one to use for availability, how to read parameter schemas, and the reconnect fix for stale MCP tool lists.

## [0.20.0.0] - 2026-07-09

### Added

- **The API and MCP server now cover everything the app can do.** All 537 operations — every read and every write the web UI performs — are callable by an API key. Each one runs the same guarded code the UI runs, so role permissions, overbooking prevention, validation and the audit log all still apply.
- **New REST endpoints:** `GET /api/v1/operations` discovers what your key can call, `GET /api/v1/operations/{name}` returns an operation's exact arguments, and `POST /api/v1/ops/{name}` invokes it.
- **The MCP server now exposes 27 tools.** Around 22 named tools cover the common flows — `list_projects`, `get_project`, `search_assets`, `check_availability`, `global_search`, `list_kits` and more — so an agent can answer "show me the projects" directly. `list_operations`, `describe_operation` and `call_operation` reach everything else without flooding the agent's context.
- Irreversible operations (delete, remove, archive, revoke) and stock-affecting ones (check-out, check-in, adding line items) now refuse to run unless you pass `confirm: true` and an idempotency key, so an agent cannot delete a project or pull gear on a half-considered first call.
- Agent docs at `/llms.txt` now describe the full surface: the discovery loop, the confirmation rails, idempotency rules, and every error code with its recovery action.

### Fixed

- **Cross-organisation data leak.** Three Convex queries (`projectLineItems.listByProject`, `projectGroups.listByProject`, and the equipment-tab bundle) returned rows for any project id without checking which organisation owned it. Anyone who could guess a project id from another organisation could read its booked gear, equipment groups, categories and sub-hires. All three now filter by organisation. This affected the web app as well as the API.
- **API keys could grant themselves more power than they had.** A key allowed to manage organisation settings could mint a new key with unlimited scopes. A key can now only create keys with scopes it already holds.
- **Retrying a write could apply it twice, or silently skip it.** The idempotency ledger now reserves the key before the write rather than after, refuses a key reused for a different operation, and replays a recorded failure instead of re-running work that may have partially applied.
- API errors no longer echo raw internal error text when reporting a permission or not-found failure.
- Oversized id lists are rejected with a clear message instead of failing as a retryable server error.

## [0.19.8.1] - 2026-07-07

### Fixed
- Tall pop-ups and forms now scroll instead of running off the screen. Any dialog or side sheet whose content is taller than the window now caps at the viewport height and scrolls inside itself, so you no longer have to zoom out to reach the buttons at the bottom. Uses dynamic viewport height so mobile browser bars don't clip the modal.

## [0.19.8.0] - 2026-07-04

### Fixed
- Prepping part of an untagged bulk line no longer drags the whole line into Prepped. Pick one of ten cables (or any bulk/quantity item with no asset tag) and only that one moves — the other nine stay in Pick, ready to prep as you pack them. The same fix covers serialised multi-quantity lines: assign an asset to one unit and just that unit advances.

### Added
- **Move gear back a stage, not just forward.** Every warehouse stage past Pick now has a "Move to …" button beside its forward action: send prepped gear back to Pick, deployed gear back to Prepped, returned gear back to Deployed, and de-prepped gear back to Returned. Partial selections move only the units you pick, and whole kits move as one. Fixes the dead-end where a mis-scan or wrong tap left gear stuck one stage too far along.

### Fixed
- Dropdowns, comboboxes and tag inputs inside dialogs are clickable again. Picking crew on a service, choosing models when adding equipment, creating a supplier in a sub-hire, and adding tags in any form now work — they were silently swallowing clicks because the picker popups rendered behind the dialog's pointer lock.
- Editing a service's date no longer turns a one-day service into a two-day span. Single-day service types keep their end date locked to the start date, and the date field stays consistent everywhere.
- Pages no longer bounce you back to the home page on a transient hiccup. A momentary database or auth-token blip now recovers in place instead of dropping you to the dashboard.

### Changed
- Searchable pickers (combobox + tag input) and the app's overlay primitives are unified on one UI library, so dialogs, menus, and popups layer correctly together.

### Changed
- **Equipment, asset, kit, project, supplier, location and category data now reads
  from the reactive Convex layer across the server surface** (warehouse, line items,
  sub-hires, the PDF/document pipeline, reports, CSV import/export, WooCommerce order
  ingest, and the warehouse display board). This is a behavior-preserving refactor —
  the same data, sourced from the always-fresh reactive mirror instead of cross-domain
  Postgres joins — continuing the Prisma→Convex migration. No user-facing behavior change.

### Added
- **Dual-write groundwork for the remaining sub-tables** so their reads can move to
  Convex next: project line-item units (the fulfillment source of truth), asset/model
  accessory links, supplier model rates, the Test & Tag domain (assets, records, sub
  records), asset scan logs, and check records now mirror to Convex on every write,
  each with an idempotent backfill script. Reads stay on Postgres until the backfills
  run in production.

### Fixed
- Hardened nullable-model handling on the asset registry, kit detail, and equipment-add
  views so a missing equipment model renders a placeholder instead of erroring.

## [0.19.5.0] - 2026-06-14

### Fixed
- **The last of the random "couldn't complete your request" crashes on detail
  pages are gone.** Opening or refreshing a warehouse project, asset, kit, or
  stocktake page directly could crash it: the live-data connection sent its first
  request before your login token had finished loading, so the server rejected it
  as unauthenticated. Every live page now waits for the token before it asks for
  data, and automatically reconnects the moment the token lands — so a cold load
  or refresh no longer races into an error. This completes the fix started in
  0.19.3.0 (which only covered a token dropping mid-session).

## [0.19.4.0] - 2026-06-14

### Added
- Prep dialog now lets you include or exclude each accessory per item. When you assign an asset tag to a handheld, its accessories (battery kit, mic clip, etc.) appear as checkboxes, ticked by default — untick one to leave it off that specific unit so it never packs or ships.

### Fixed
- Warehouse check-in: returning one of several identical deployed units (e.g. 1 of 4 SM58s) now returns only the one you ticked, not all of them.
- Warehouse prep: prepping one of several identical units now preps only that one. Serialised items reliably route to the asset picker even when the catalog mirror is missing the asset type.
- Accessories are now tracked per individual parent unit. Prep, deploy, and return for each handheld handle its own battery/clip independently — fixing "prep three handhelds, only the first battery set ticks" and dockets that showed one real accessory row plus blank placeholders. Depreping a unit also removes just that unit's accessories.

### Changed
- Accessory prep/deploy/return cascades reworked onto a per-parent-unit model: each parent unit carries its own accessory units, linked by a new `ProjectLineItemUnit.parentUnitAssetId` (Prisma + Convex schema).

## [0.19.3.0] - 2026-06-14

### Fixed
- **Random "couldn't complete your request" crashes on warehouse and project
  pages are fixed.** A brief hiccup while fetching your login token (a momentary
  server blip or cold start) would log you out of the live data connection, and
  every page that updates in real time would error out until you refreshed. The
  token fetch now retries through a transient blip instead of dropping the
  connection, so those pages stay live.
- **Server-side page loads survive a momentary data-layer blip.** The projects
  list and detail now retry a one-off transient read failure instead of failing
  the whole page.
- **Underlying errors are no longer hidden.** When the data layer rejects a
  request, the real reason is now reported instead of a generic "try again
  later", so future issues are diagnosable from the logs.

## [0.19.2.1] - 2026-06-14

### Fixed
- **Auto project-number preview no longer suggests an already-used code.** When
  the sequence counter lagged behind the real projects (codes entered manually,
  imported, or created before auto-numbering was switched on), the new-project
  autofill and the settings preview rendered a number that was already taken
  (e.g. `260601` when `260601`-`260603` already exist). The preview now skips
  past taken codes, matching what project creation actually allocates.

## [0.19.2.0] - 2026-06-06

### Added
- **CSV rate import.** Bulk-populate model rental rates from a spreadsheet
  instead of clicking through forms — the fix for the "hundreds of models, no
  rates" cold start. A new **Import Rates** button on the models catalog takes a
  CSV with an identifier column (name, model number, SKU, or id) plus any of
  `dailyRate` / `weeklyRate` / `monthlyRate`, matches each row to an existing
  model, and updates only the rates you supplied. It never creates models, so a
  rough name-and-price sheet can't spawn duplicates; rows that match nothing,
  match two models with the same name, or carry a bad/negative number are listed
  back to you instead of being silently dropped, and blank cells are left as-is.
  The **Export** button now includes the rate columns too, so the simplest
  workflow is export → fill in the rates → import.

## [0.19.1.0] - 2026-06-06

### Added
- **Bulk accessory check-in.** A new **Bulk Check-In** tab on the warehouse
  project page shows the total quantity of each accessory due back across the
  whole job ("100 clamps", "50 TrueCons") instead of returning them one parent
  at a time. Count the pile, type the quantity, pick a condition (Good / Damaged
  / Missing), and check it in with one action — the return is distributed back
  across the underlying line items automatically. Quantities are recomputed
  server-side from live stock, so over-returns are rejected and the existing
  per-parent Return flow is untouched.

## [0.19.0.1] - 2026-06-06

### Fixed
- **Database consistency cleanup (internal).** Reconciled a long-standing drift
  between the schema and the production database: the project-service "billable
  to client" flag is now correctly required at the database level (with any
  pre-existing blank values defaulted to "no"), and three internal `updatedAt`
  columns had stale defaults removed so future migrations stay clean. No
  user-facing behaviour change. Also added a regression test covering an
  accessory quantity override being picked up when the warehouse re-scans the
  parent asset.

## [0.19.0.0] - 2026-06-06

### Fixed
- **The app randomly going down for a minute or two, at no particular time.**
  The Discord bot used to run inside the web server, and a brief Discord network
  hiccup could crash the bot in a way that took the whole website down with it
  (a "502 Bad Gateway" with nothing in the app logs to explain it). The bot now
  runs as its own separate service, so a Discord glitch can only restart the bot,
  never the website. Discord errors are now caught and logged instead of crashing
  anything, and a safety net reports any other unexpected error instead of letting
  it silently take the server down.

### Changed
- **Discord bot runs as a separate process (`gearflow-discord-bot`).** No change
  to how you configure it (still all on the Discord settings page). The Start /
  Stop / Restart buttons and the status pill now coordinate with the separate
  process through the database. Operator guide added at
  `docs/operations/discord-bot.md`.

## [0.18.1.0] - 2026-06-06

### Fixed
- **The whole page sometimes going unclickable until you refresh.** Opening a
  menu or dialog and then navigating could leave the page in a frozen state
  where buttons and links stopped responding (a known UI-library/React 19 issue,
  much more frequent since menus landed on every list page). The app now detects
  and clears these orphaned locks automatically within about a second, so you no
  longer have to refresh to recover.

## [0.18.0.2] - 2026-06-06

### Fixed
- **Saved Views and project Task menu buttons did nothing.** The menu actions
  (Save current view, Update, Clear, apply a view; and a task's Edit / Move /
  Delete) were wired to the wrong event and never fired. They now work.

## [0.18.0.1] - 2026-06-06

### Fixed
- **Saved Views menu crash on list pages.** Opening the new "Views" menu on any
  list page (assets, projects, clients, etc.) threw a client-side exception and
  broke the page, because its heading was rendered outside a menu group. The
  heading is now grouped correctly and the menu opens normally.

## [0.18.0.0] - 2026-06-06

### Added
- **A home screen that's about your work.** The dashboard now greets you by name
  and leads with "Your projects" — the projects you manage — as status-coloured
  cards showing the client, equipment count, and a plain-English timing line
  ("Returns in 2d", "Overdue 3d", "Starts today"). A "Needs attention" row
  surfaces overdue returns, maintenance due, and pending crew offers at a glance
  (or tells you you're all caught up). Org stats, upcoming projects, and recent
  activity follow below.
## [0.17.0.0] - 2026-06-06

### Added
- **Auto-generated project codes.** Optionally set a project-number template in
  Settings → Project Defaults and new projects get their code automatically. The
  template supports date + counter tokens — e.g. `%YY%MM%INC` makes June 2026's
  first project `260601` and July's 8th `260708`. Choose when the counter resets
  (never / yearly / monthly / daily) and how many digits it uses, with a live
  preview of the next code. Leave the format blank to keep entering codes by hand.
## [0.16.0.0] - 2026-06-06

### Added
- **Project task lists.** Every project now has a **Tasks** tab — an Asana-style
  to-do list. Add tasks with a status (To do / In progress / Done), priority, due
  date, an optional checklist of sub-steps, and an assignee (an org member or a
  crew member). Overdue tasks are flagged, and each task tracks when it was
  completed. Reads/writes respect project permissions.
## [0.15.0.0] - 2026-06-06

### Added
- **Saved views on every list.** Save the current filters, sort, visible columns,
  and page size on any list page as a named view, then recall it in one click —
  e.g. "Overdue projects" or "Assets in maintenance". Star a view to make it your
  default for that list and it loads automatically next time. Views are personal
  to you and follow you across devices. Available on assets, models, clients, crew,
  locations, projects, suppliers, kits, maintenance, T&T registry, activity log,
  damage, timesheets, and stocktakes.
## [0.14.7.0] - 2026-06-06

### Fixed
- **Warehouse checkout — multi-tenant safety.** Checking out a scanned asset now
  verifies the asset belongs to your organization before flipping its status or
  location. Previously a checkout request carrying another organization's asset id
  could mutate that asset; it now fails cleanly with "Asset not found in this
  organization".
- **Warehouse checkout — accessories are Test & Tag gated.** Permanent accessories
  that travel with a parent asset are now blocked from deploying if their own Test
  & Tag is failed or overdue, the same as any other gear. Previously accessories
  could ship without a compliance check because they were materialised after the
  checkout's T&T pre-flight. The block is scoped to accessories actually being
  deployed, so an already-out accessory whose tag later lapses won't wrongly block
  a later partial deploy of the same line.

## [0.14.6.0] - 2026-06-05

### Fixed
- **Accessories expand per unit on packing slips.** When an item ships with an
  accessory and you pull, say, 10 of it, the accessory now lists 10 checkable
  lines (one per unit) instead of a single combined row — so the picker grabs and
  ticks one for each. An accessory is just an auto-added asset, so it now gets the
  same per-unit treatment a real asset row does, including when the item sits
  inside a project group.

## [0.14.5.0] - 2026-06-05

### Fixed
- **Accessories now appear on PDFs for grouped items.** When an item that carries
  an accessory lived inside a project group (e.g. an IMX6A Headset with a Micon
  adaptor under a "Wireless Michael" group), the accessory rendered everywhere in
  the app but was silently missing from generated documents — packing lists, quotes,
  dockets. It now renders indented under its item on every PDF, grouped or not.

## [0.14.4.0] - 2026-06-05

### Fixed
- **Pick slip now lists accessories under each unit.** On the printable pull
  sheet, an accessory that ships per unit (e.g. a Micon adaptor on each IMX6A)
  now shows beneath every unit row, so the picker sees exactly what to grab with
  each item, instead of one combined line.
- **Pick slip print pagination.** The table header now repeats on every printed
  page, rows no longer split across a page break, and an item plus its units and
  accessories stay together on one page.
- **Accessories now show in the Pick / Prep tab** of the warehouse view (they
  were only on Deploy/Return before).

## [0.14.3.0] - 2026-06-05

### Fixed
- **App-wide stability after data backfills.** After the v0.14.2.0 model-accessory
  backfill, the app intermittently froze for everyone for about a minute, then
  recovered on its own (the kit picker would come up empty, moving items stalled,
  prep felt slow). Root cause: the bulk insert left Postgres on stale query-planner
  statistics, so it occasionally chose a pathological plan for hot queries — and with
  no per-query timeout, one slow query held a database connection long enough to
  starve the whole pool. The fix refreshes statistics at deploy time instead of
  waiting hours for autovacuum to catch up.

### Changed
- **Database connections are now bounded so one slow query can't take the app down.**
  The runtime connection sets a `statement_timeout` (default 30s) plus pool-wait
  limits, so a single slow query fails on its own instead of stalling every other
  request. Tunable via `DB_STATEMENT_TIMEOUT_MS`, `DB_POOL_TIMEOUT_S`, and
  `DB_CONNECTION_LIMIT`; migrations are unaffected, so backfills are never cut off.

## [0.14.2.0] - 2026-06-05

### Fixed
- **Model accessories now show when you add gear by model.** Previously an
  accessory set on a *model* ("every IMX6A ships with a Micon adaptor") only
  appeared if you added that gear by scanning a specific asset tag — not when you
  added it by model + quantity, which is how most quotes are built. So the
  adaptor was missing from the project and every document. Now adding a line by
  model expands the model's accessories immediately (quantity scaled — "2x IMX6A"
  gets 2 adaptors), so they show on the project, the quote, and the docket.

### Changed
- **Existing jobs backfilled.** A one-time backfill adds model accessories onto
  your existing model lines on active (quote/confirmed, not-yet-prepped) projects,
  so current jobs get their accessories too — not just new ones. Finalized
  (invoiced/completed) and already-deployed lines are left untouched.

### Fixed
- **Accessories on multi-asset bookings now return with the right unit.**
  Previously, on a line booked with several of the same asset (each carrying its
  own attached accessory), returning one asset also marked its siblings'
  still-deployed accessories as returned — and a "damaged" return could send a
  sibling's cable to maintenance. Returns now follow the specific asset scanned.
- **Attached accessory quantities now scale with the booking.** Ten lights that
  each ship with a clamp now reserve ten clamps, not one — so pull sheets,
  availability, and the deploy/return screens show the real count. Returning one
  asset brings back its share; the accessory clears once every asset is back.
- **Re-scanning an already-returned asset no longer double-returns** its shared
  accessories, and two warehouse stations checking out the same booking at once
  no longer under-count its accessories.
- Attached accessories now also show on the deploy/return screens for
  multi-asset model lines, and hide correctly when the group is collapsed.

## [0.14.0.0] - 2026-06-05

### Added
- **Accessories now travel with their asset everywhere.** Permanently-attached
  accessories (cables, clamps, adaptors on a serialised asset) are wired
  end-to-end. Add the asset to a job and its accessories come with it as
  indented child lines. They show on the pick list and printable pull sheet —
  badged "Accessory", counted in pick progress — so warehouse staff actually
  pick them instead of leaving them on the shelf. They appear nested under the
  parent in the deploy and return tabs, and expand under the parent in the
  project equipment table.

### Fixed
- **Check-and-store returns now release the accessories too.** Returning an
  asset through the check-and-store workflow previously freed the parent but
  left its cables and clamps stuck "Checked Out"; the return now cascades to the
  attached accessories, and de-prep clears them from the deploy-staging board.

### Known limitations
- Multi-quantity / model-level lines that carry per-unit accessories are not yet
  fully handled — returning one unit can release accessories belonging to
  sibling units that are still out. Single-asset bookings (the common case) are
  correct. A follow-up tracks the multi-quantity fix.

## [0.13.0.1] - 2026-06-05

### Fixed
- **Discord bot login failed with "Used disallowed intents".** The client was
  requesting the privileged `GuildMembers` intent, which Discord rejects unless
  the "Server Members Intent" toggle is enabled in the Developer Portal. Dropped
  the intent — the only consumer was a single-ID `guild.members.fetch(id)` call,
  which falls back to a REST request and works without the intent. No Developer
  Portal change required; just restart and the bot connects clean.

## [0.13.0.0] - 2026-06-04

### Added
- **Model-level accessories.** Set a default accessory on a Model — "every
  asset of this model ships with N of this bulk asset" — and every asset of
  that model inherits it automatically. The new `ModelBulkAccessory` join
  table is unique on `(modelId, bulkAssetId)`, so duplicates are blocked at
  the DB layer. Bulk only at the model level (you can't pick "the" specific
  cable for every asset of a model); always SHIPS_WITH (DEDICATED at the
  model level would drain the whole shelf in one click). UI: "Accessories"
  section on the Model detail page; asset detail page shows inherited bulk
  rows tagged "from model".

### Changed
- Project expansion (`expandAccessoryChildren`) and warehouse scan-time
  expansion (`expandAccessoriesForAsset`) now union the asset's own bulk
  children with the asset's model's `bulkAccessories`, deduped by
  `bulkAssetId` so an asset-level row wins on conflict (different quantity,
  DEDICATED override). Idempotent — re-scans don't duplicate.
- `getModel` and `getAsset` include `model.bulkAccessories` so the UI can
  render the inherited rows and the asset's "(from model)" tag.
- Removing a model accessory after a project already expanded it does NOT
  retroactively delete the project line items — the template only governs
  *new* expansions.

## [0.12.0.0] - 2026-06-04

RVLT Flow now bridges Discord. Every project gets its own private channel,
crew can link their Discord accounts via email, and they can look up assets
and log faults from their phone without opening the app. The bot runs
in-process — there's nothing to deploy separately, no `.env` to manage. Admins
configure everything at **Settings → Discord**.

### Added
- **Discord integration.** Per-org config row, transactional outbox for events,
  per-project private channels created automatically when a project hits a
  configurable status (default: `CONFIRMED`) and archived to a separate
  category when it hits a terminal status (default: `COMPLETED, INVOICED,
  RETURNED, CANCELLED`). Crew get channel access as soon as they're assigned;
  late-linking crew get retroactive access on confirm.
- **`/link [email]` enrollment.** Crew run `/link` in Discord, get a magic
  link emailed to their RVLT Flow profile, and click to confirm. Anti-hijack
  hardened (the token binds the invoker's Discord ID at issue time), constant
  "if that email is on file" response (no enumeration oracle), durably
  rate-limited (3/hr per Discord user, 3/day per crew member).
- **`/asset code:TTP-042`.** Linked crew look up any asset by tag from
  Discord: current status, test-and-tag validity, and which project it's
  deployed on.
- **`/fault code:… description:… severity:MINOR|MAJOR hold:true`.** Crew log
  a DamageEvent from Discord. `hold` flips the asset to `IN_MAINTENANCE` (needs
  `maintenance:create`). Idempotent on the Discord interaction id — a retry
  never double-logs.
- **Admin Discord settings page** (`/settings/discord`). Discord bot token
  (encrypted at rest via AES-256-GCM keyed off `BETTER_AUTH_SECRET`),
  application id, guild id, project + archive categories, channel lifecycle
  rules (multi-select status arrays), welcome-on-create + fault-echo behaviour
  toggles, signing-secret rotation, linked-accounts roster (linked + pending
  in one table), recent activity.
- **One-click bring-up.** A **Deploy commands & start bot** button on the admin
  page pushes the slash command registry to Discord AND restarts the
  in-process bot so it picks up the latest credentials and config — no
  `pm2 restart gearflow` needed. Every config-changing save (toggle Enabled,
  save token, save settings) auto-restarts the bot for the same reason. A
  live "Bot running" / "Bot stopped" pill on the connection-health card
  surfaces gateway state. `startBot()` awaits the Discord `ClientReady`
  handshake (10s timeout) so the post-restart status read is accurate.

### Changed
- **Bot architecture: in-process, no separate service.** The bot lives inside
  the RVLT Flow Next.js server (booted by `instrumentation.ts`). Slash commands
  call services directly; the outbox poller reads the DB directly. Same
  service-layer invariants (`requireActorPermission`, transactional outbox,
  idempotent converge) as a separate service would have — but with one process,
  one call path, and no HMAC trust boundary to enforce. **Zero env vars** on
  the host for Discord.
- **`DamageEvent` records the true reporter.** New nullable
  `reportedByCrewMemberId` preserves who filed the fault when a non-User
  freelancer reports it from Discord, while `createdById` keeps a real User to
  satisfy the existing FK (`20260604130000_discord_fault_reporter` migration).
  A new unique `discordIdempotencyKey` makes retried fault POSTs safe.
- **Project + crew-assignment writes emit transactional Discord events.**
  `createProject`, `createAssignment`, `deleteAssignment`, `updateProject`, and
  `updateProjectStatus` wrap their Prisma calls in a `$transaction` and append
  a `DiscordOutbox` row inside it — a rolled-back mutation never leaks a
  channel-sync event. Orgs without an enabled integration emit nothing.

## [0.11.0.0] - 2026-06-04

### Added
- **Child Assets / Accessories.** Permanently attach accessories (cables,
  clamps, adaptors) to a parent serialised asset. They travel with the parent
  onto projects and through warehouse checkout/checkin, and render indented on
  pull sheets, delivery dockets, quotes, and invoices. New data model:
  `Asset.parentAssetId` self-relation, `AssetBulkChild` join table,
  `ProjectLineItem.childKind` (`KIT | ACCESSORY`). The structural `isKitChild`
  flag is reused so the ~40 existing totals/count filters exclude accessories
  with no migration.
- **Scan-time accessory travel.** When the warehouse assigns a specific asset
  to a model-level line at prep or deploy, that asset's accessories
  materialise as child lines automatically (idempotent — dedups by asset/bulk
  id, so re-scans don't duplicate). Accessories travel whether the office
  books a specific asset or the warehouse picks the unit later.
- **Accessory manager UI** on the asset detail page (connector-glyph list,
  Attach dialog) with a plain-language allocation explanation. An "Accessory
  of <parent>" badge appears on children's detail pages.
- **Scanner "scan the parent" prompts** in all three warehouse tabs (prep /
  deploy / return) when an accessory is scanned directly.

### Changed
- `removeLineItem` is now transactional and cascade-aware: accessory parents
  cascade-delete their children atomically; direct removal of a child line is
  blocked with a `childKind`-aware error message.
- `deleteAsset` refuses to delete a parent that still has accessories
  attached.
- PDF pipeline: an "accessory parent" (top-level line, no `kitId`, has
  `ACCESSORY` children) is recognised by both `gearflow-table` rendering and
  `section-renderer` height reservation, so accessories render indented and
  pagination doesn't tail-drop them.
- VERSION file reconciled with package.json after the 0.10.0.0 drift.

### Fixed
- Concurrent `addSerializedChildToAsset` calls attaching the same child to
  different parents now use a guarded update — the second attach throws
  instead of silently overwriting the first.
- `lookupAssetForScan` org-scopes the parent lookup (tenant isolation).
- A serialised accessory cannot be detached while it's deployed on a project
  (avoids a dangling project child line and a mis-stated shelf count).
- `addSerializedItemToKit` (single + batch) rejects an asset that's already an
  accessory of another asset — symmetric to the existing kit-to-accessory
  guard.
## [0.9.3.0] - 2026-06-04

The line-item Move action splits into two clearer choices.

### Changed
- **Line-item kebab "Move" → two actions: "Move to category" and
  "Move to group".** The combined picker that v0.9.1.0–0.9.2.1
  evolved (Uncategorized + per-category root + per-category-group
  entries in one dropdown) confused users every time — picking
  "Audio" looked equivalent to "Audio > PA System" but landed the
  item in a different place. Each row's kebab now offers an explicit
  category-only and group-only path:
    • *Move to category* — lists every category plus
      Uncategorized. The item lands as a standalone under the picked
      category (or in the truly uncategorised zone).
    • *Move to group* — lists every group, clustered by its
      category. The item lands inside the picked group and adopts
      its category.
  The `m` row shortcut binds to *Move to category* (the broader
  pick); *Move to group* needs the explicit kebab.
- Group-only dialog renders an explanatory empty state with a
  Close button when the project has zero groups, instead of an
  empty dropdown over a disabled Move button.

### Removed
- `move-line-item-dialog.tsx` — the combined picker. Replaced
  by `move-item-to-category-dialog.tsx` + `move-item-to-group-dialog.tsx`.

## [0.9.2.1] - 2026-06-04

### Fixed
- **Move-item dialog: pick a category as the destination.** The
  destination dropdown only listed `<category> > <group>` entries
  plus a single top-level "Uncategorized" option. Users wanting to
  drop an item under a category — but not into one of its groups —
  had no UI affordance, so they picked the only top-level option
  (Uncategorized), the server obediently moved the item to truly
  uncategorised, and it "disappeared" from where they expected.
  Each category now contributes a `<name> (no group)` entry
  alongside its child groups so category-root is a real destination.
  Server side unchanged — `moveLineItemToGroup` already accepted
  `{ categoryId, groupId: null }`.

## [0.9.2.0] - 2026-06-04

Project groups can now move between categories, and categories themselves
gain inline add actions for equipment, kits, and custom items. Fixes two
bugs reported against v0.9.1.0: structure-creation was stuck (a project
group was glued to whichever category it was born in), and there was no
inline path to drop a kit straight into a category without first making
a group inside it.

### Added
- **Move project groups across categories.** Group kebab gains a
  "Move to category" action with the same `ArrowRightLeft` icon as the
  line-item Move. Picks any category in the project, or types a new
  category name and presses Enter to create-and-place in one atomic
  step (matches the sub-hire group move S15 pattern). The `m` row
  shortcut binds to it.
- **Add actions on category rows.** Category kebab gains
  "Add Equipment", "Add Kit", and "Add Custom Item" entries — each
  opens the unified add dialog scoped to that category with no group
  pre-set, so the new item lands under the category as a
  standalone item. Sub-hire is intentionally omitted because sub-hire
  orders don't carry a categoryId at the order level (their groups do
  — use the toolbar Add).

### Changed
- Sub-hire group Move kebab icon switched from `Package` to
  `ArrowRightLeft` so the three rows (LineItem, SubHireGroup,
  ProjectGroup) all render Move with the same affordance.
- MoveLineItemDialog description now says "Choose a destination
  group or category" since Uncategorized is a valid pick.

### Fixed
- **Category sync on group placement.** `createCategoryAndPlaceGroup`
  was leaving line-item categoryIds stale when the new category was
  created via the project-group branch — the sub-hire branch had
  always synced its synthetic parents but the project-group branch
  skipped its own line items. PDFs and reports that filter by
  category would have shown items under their OLD category for any
  group moved through the create-by-name path. Both branches now
  call the same `projectLineItem.updateMany` so the placement is
  always consistent.

## [0.9.1.0] - 2026-06-04

Unified the project equipment "Add" surface. The four separate toolbar
buttons (Add Equipment / Add Kit / Custom Item / Sub-Hire) collapse into
one dialog that picks kind via a tab strip, and sub-hire creation now
lives inline alongside equipment, kits, and custom items instead of
bouncing to a separate window. The "New" button in the Sub-Hire Orders
panel is gone for the same reason. Add Group and Add Category now sit
next to each other in the toolbar so the structure-creation cluster
reads as one group instead of being split across a spacer.

### Added
- `SubHireAddForm` — inline form mirroring `EquipmentAddForm` /
  `KitAddForm` / `CustomItemAddForm`. Captures supplier, supplier
  reference, hire start/end, and notes. After `createSubHire` succeeds,
  the unified dialog closes and `SubHireOrderDialog` opens on the new
  order in manage view so the user can immediately add items.
- `UnifiedAddDialog` now renders one of four kinds inline: `own-stock`,
  `kit`, `custom`, or `sub-hire`. The `onOpenSubHire` bounce prop is
  removed.

### Changed
- Equipment toolbar reduced to three buttons: `Add` (unified, opens the
  add dialog at the last selected kind), `Add Group`, `Add Category`.
  The four-button add cluster is gone.
- Group-kebab `Add Equipment` and `Add Kit` actions still pre-set the
  unified dialog's kind so the per-group context is preserved.
- `Add Category` moved next to `Add Group` (was on the right of the
  spacer next to Show margin) so structure-creation buttons cluster.

### Removed
- Standalone "Sub-Hire" toolbar button — duplicate of the unified Add
  dialog's Sub-hire tab.
- "New" button at the top of the Sub-Hire Orders panel — same duplicate.
- The `onOpenSubHire` callback prop on `UnifiedAddDialog` and the
  bounce-to-other-dialog behaviour it implemented.

## [0.9.0.0] - 2026-06-04

Cross-type group/category unification for the project equipment tab.
Own-stock items, sub-hires, and custom items now live in the same
ordered list per category, share the same dialogs, and respond to
the same kebab actions and keyboard shortcuts.

### Added

- **Unified "Add" surface.** One dialog with a segmented switcher
  (Own stock / Kit / Sub-hire / Custom). Picking Own-stock, Kit, or
  Custom reshapes the body inline; Sub-hire bounces to the existing
  sub-hire order workflow. Four toolbar buttons and the two group
  kebab actions all open the same dialog with the right tab pre-set.
- **Sub-hire groups in the main table.** Sub-hire groups now render
  as first-class rows interleaved with project groups in each
  category, complete with handshake icon, "via Supplier" sub-line,
  and a "$N margin" tail. Orphan sub-hire groups (no
  `targetCategoryId`) surface in the Uncategorized zone instead of
  vanishing.
- **Cross-type drag-and-drop.** Reorder mixed lists within a
  category; drag a sub-hire group across categories or to the
  Uncategorized zone. Drop Matrix 8C rejects disallowed combinations
  (own-stock items onto sub-hire groups, group-into-group nesting)
  with a 2px red left-edge bar plus an explanatory toast.
- **Move dialog for sub-hire groups.** Kebab "Move to category"
  opens a category picker. Typing a new category name and pressing
  Enter creates the category at the end of the project's list AND
  places the sub-hire group inside it in a single atomic transaction.
- **Unified price-edit dialog.** One dialog covers both group kinds:
  project groups get a single Price input, sub-hire groups get
  Charge + Cost inputs with an auto-computed Margin per unit.
- **Show-margin column toggle.** "Show margin" toolbar button
  reveals an optional Cost column showing supplier cost on sub-hire
  rows. Preference persists per-user in localStorage; default OFF.
- **Per-row keyboard shortcuts.** Hovering a row and pressing `e`,
  `m`, or `d` triggers Edit / Move / Delete. Suppressed when focus
  is in an input, contentEditable element, or open dialog/menu.

### Changed

- Equipment-tab.tsx slimmed from 2148 LOC to 1393 LOC (-35%) by
  extracting 10 dialog and helper components into dedicated files.
  Same behavior — easier to navigate, easier to test.
- `getProjectCategories` now returns a `mixedGroups` array per
  category that interleaves project and sub-hire groups in
  CategorySlot order. Existing consumers (sub-hire order dialog,
  equipment add form) read only the unchanged `groups` field.

### Fixed

- **Concurrent reorder race.** Two simultaneous reorders of the same
  category previously hit `UNIQUE(projectCategoryId, sortOrder)`.
  `reorderMixedGroupsInCategory` now acquires a Postgres advisory
  lock keyed on the category id and runs a phase-1 negation pass
  before the upsert loop. Both reorders complete; last write wins on
  sortOrder.
- **Sub-hire group placement query.** Sub-hire group availability
  now threads `rentalStartDate`/`rentalEndDate` through to
  `checkKitAvailability` instead of always passing `new Date()`.

### Removed

- Standalone `AddEquipmentDialog` wrapper file — superseded by the
  unified add dialog.
- Inline `Set group price` dialog in equipment-tab — superseded by
  the unified `PriceEditDialog`.

## [0.8.2.0] - 2026-06-03

Quick-wins bundle: three TODOs knocked out plus follow-up polish from
an adversarial review pass.

### Added
- **Configurable days-per-month for billing.** The pricing optimiser
  treated a "month" as exactly 28 days. Orgs whose customers use 30 or
  calendar-month conventions can now set it in Settings → Project
  Defaults. Values are clamped to 20-31 in the form, and the server
  defensively re-validates on read so corrupt metadata can never
  produce a degenerate optimiser run.
- **Template builder settings for `call-sheet-info` and `day-header`.**
  The two section types rendered with hard-coded defaults; now the
  toggles (PM contact, client contact, venue details, schedule times,
  equipment summary, phases, crew count) are editable in the builder
  UI. Day-header toggles flow through to every per-day section the
  call-sheet pipeline injects.

### Changed
- The crew availability overlap query now backs onto a composite
  `(crewMemberId, startDate, endDate)` index so look-ups stay
  index-only once the assignment table grows past the point where the
  existing `(crewMemberId, startDate)` index forces a row scan to
  evaluate `endDate`.

### Fixed
- Pre-existing call-sheet-info sections persisted with empty settings
  (a legacy bug where the dispatcher returned `{}`) used to render a
  blank section because every toggle read as `undefined`. The renderer
  now merges defaults at read time so old data still renders the
  expected fields.

## [0.8.1.2] - 2026-06-03

Second hotfix in the v0.8.1.x series — delivery dockets and return
sheets were silently dropping every Project Group from the doc. The
status filter (CHECKED_OUT for dockets; CHECKED_OUT + RETURNED for
return sheets) compared against the synthetic group row's status field,
which is hard-coded to CONFIRMED because the row is a label, not a
real line item. Result: the parent failed the filter, took its
attached members with it, and the entire group vanished from the doc
the warehouse hands to the client.

### Fixed
- **Status filter now passes synthetic Project Group rows through if
  ANY attached child meets the filter criteria.** The kit-style
  children-loop inside the parent's row still filters each member
  individually, so only checked-out (or returned, for return sheets)
  members indent under the group. Groups with zero passing members
  drop entirely — no empty group headers stranded on the doc.
- Mirrors the same isGroupRow special case in both the plugin filter
  (`gearflow-table.ts`) and the section-renderer's
  `getFilteredParentItems` (used for height calc + pagination).
- Bulk children of a group respect `checkedOutQuantity > 0` instead of
  the parent's status, matching how top-level bulk items are filtered.

### Added
- 5 regression tests across `section-renderer.test.ts` (group filter
  with bulk children, any-child-passes for both docket and return
  sheet) and `gearflow-table.test.ts` (docket renders group parent
  with only checked-out children indented; group with zero checked-out
  children drops entirely).

## [0.8.1.1] - 2026-06-03

Hotfix for v0.8.1.0: warehouse PDFs were silently dropping tail items
when groups carried members as `childLineItems`. The section-renderer
height calculator only counted attached children for kit parents — not
group parents — so the table under-estimated its space, the plugin
ran out of vertical room, and everything past the first page (or past
the first oversized group) just vanished from the doc instead of
paginating onto a second page.

### Fixed
- **Section-renderer pagination now accounts for `childLineItems` on
  Project Group rows.** `calculateItemHeight` treats `isGroupRow` +
  attached `childLineItems` the same as `isKit` + `showKitChildren`:
  the parent row's reserved height includes every indented member.
  Without this, an entire warehouse doc could lose its tail content
  on the first deploy of v0.8.1.0 — the "Drum Kit Mic Set" group
  rendered fine, then everything after it (other groups, ungrouped
  items, kit breakouts) was silently dropped.

### Added
- 2 height-calc regression tests in `section-renderer.test.ts`:
  group row with N children reserves strictly more space than a plain
  row (by at least N child rows worth), and a group row with EMPTY
  `childLineItems` uses plain-row height (collapse-mode parity).

## [0.8.1.0] - 2026-06-03

Project Groups on warehouse PDFs now look like kits — bold parent rows
with their members indented underneath — and sit inside their category
section. The previous version turned every group into its own
top-level teal section header, which doubled-up against the group's
own row and lost the category context warehouse staff use to walk the
warehouse.

### Fixed
- **Project Groups on pick lists, return sheets, and delivery dockets
  now render inside their category.** "Drum Kit Mic Set" shows up as a
  bold sub-header inside the "Band" category section, with its mics
  indented underneath, instead of breaking out as its own top-level
  section. The data builder now buckets group rows under `cat.name`
  and attaches non-kit members as `childLineItems` on the synthetic
  group row; the renderer treats group rows with attached members the
  same as kit parents (bold name, indented children).
- Removed the duplicate "group title" rows that appeared both as a
  section header AND as the first row inside the section.

### Changed
- Kit parents that live inside a Project Group still break out into
  their own `[Kit] <name>` section — the kit-boundary contract is
  preserved end-to-end.
- `gearflow-table.ts` adds an `isGroupParent` detection so the
  existing kit-children rendering path (indent, smaller font, per-unit
  checkboxes for multi-quantity members) extends to group members
  with zero new rendering code.

### Added
- **PDF renderer test harness** (`src/lib/pdfme/plugins/test-utils.ts`).
  Wraps a real `@pdfme/pdf-lib` page with capturing proxies on
  `drawText`, `drawRectangle`, and `drawLine` so plugin tests can
  assert font choice (bold vs regular), text content, and indent
  positions without producing a PDF on disk. Closes the long-standing
  "no unit tests for PDF rendering" gap.
- 7 harness-based tests in `gearflow-table.test.ts` covering: group
  parent renders bold, regular rows stay regular (control), children
  indent right of parent and stack below, child order preserved, group
  row without children stays regular (collapse-mode parity), kit
  parents still bold (regression), category section header sits above
  group contents.

## [0.8.0.0] - 2026-06-02

Warehouse-facing PDFs now show every item inside a Project Group, plus
sub-hire and kit gear get their own clearly-labelled sections. Pick
lists, return sheets, and delivery dockets render in packer-walk order
so warehouse staff walk the warehouse rack-by-rack instead of
ping-ponging across the building.

### Fixed
- **Pick list, return sheet, and delivery docket now show every line
  item inside a Project Group.** Previously, any project with Project
  Groups rendered as just the group title rows on warehouse docs —
  staff couldn't see the 50 lamps to actually pick. The data builder
  was collapsing groups into one synthetic row for every doc type;
  now it's controlled by a per-template `expandProjectGroups`
  setting, defaulting to expand for warehouse docs and collapse for
  quote / invoice.

### Added
- **Sub-Hire Groups render as their own top-level section** on
  warehouse docs (`Sub-Hire: <Supplier> — <Group Title>`). Packers
  see what's hired-in vs owned at a glance; clients see the same
  separation on the delivery docket they sign.
- **Kit boundary wins over Project Group placement.** A kit that
  sits inside a Project Group now breaks out into its own `[Kit]
  <name>` section on warehouse docs. Kit contents stay grouped as a
  unit instead of getting lost in the surrounding gear.
- **Packer-walk sort order** within each section: location →
  category → model name. Bulk items and custom items without a
  location bucket to the bottom of each section.
- **Delivery docket expands groups with serials** so the signed
  handover doc has full evidence of what physically left the
  building.

### Changed
- New `TemplateSettings.table.expandProjectGroups` boolean. Defaults
  true for packing-list, return-sheet, delivery-docket; false for
  quote, invoice, call-sheet.
- `resolveTemplateSettings(docType, stored)` deep-merges legacy
  stored template JSON against the docType defaults so new settings
  keys pick up safe values automatically. Without this, every
  existing template would silently regress to today's
  collapsed-row bug on first deploy.
- `gearflow-table.ts` delivery-docket grouping respects `groupName`
  for non-kit items so Project Groups and Sub-Hire Groups get their
  own section headers. Kit promotion (kit name as header,
  CHECKED_OUT children as rows) preserved.
- Pagination orphan check: group headers now reserve space for the
  header AND at least one body row before drawing, so headers never
  strand at a page bottom with items continuing onto the next.
- Both render pipelines (legacy template + section-based) get the
  fix simultaneously because both consume `data.line_items` from
  the same builder.

## [0.7.1.0] - 2026-06-02

iCal feed now shows the right time when subscribed in Google Calendar.
Previously, every event was shifted by the org's UTC offset (about 10–11
hours for Australia/Sydney) and often landed on the wrong day.

### Fixed
- **iCal feed times were off by the org's UTC offset on Google Calendar.**
  The generator used the server's local time and emitted "floating"
  DATE-TIMEs with no timezone anchor. On Vercel (UTC) a 9am Sydney event
  came out as `DTSTART:...T230000` floating, so Google rendered it at
  11pm in the viewer's local zone. The feed now anchors every DTSTART /
  DTEND with `TZID=<org-timezone>` and ships a matching `VTIMEZONE` block
  for AU (Sydney, Melbourne, Hobart, Adelaide, Brisbane, Perth, Darwin),
  NZ (Auckland), UK (London), US (LA / NY), and UTC. DST is handled by
  embedded `RRULE`s so events render correctly across the daylight-saving
  transition. `DTSTAMP` is now UTC with the mandatory `Z` suffix per RFC
  5545. The org timezone comes from `OrgSettings.timezone` (default
  Australia/Sydney) on the projects, services, maintenance, crew, per-
  crew-member, and per-assignment feeds. All-day events use explicit
  `VALUE=DATE` instead of relying on midnight detection. Backed by 16
  regression tests covering winter (AEST), summer (AEDT), Brisbane
  no-DST, unknown-zone fallback, all-day rendering, and the original
  floating-time bug shape.

## [0.7.0.4] - 2026-05-30

Patch release — delivery dockets now list every assigned asset tag, one
row per unit, instead of collapsing to "tag, tag +N".

### Fixed
- **Delivery docket collapsed multi-quantity lines.** A line with qty > 1
  rendered "TTP00042, TTP00045 +3" instead of one row per assigned unit,
  so the client had no per-unit list to tick off on receipt. The section
  render path (`generate-pdf` `loadTemplate` reads `sections` first) is
  the active path, but `getDefaultSections("delivery-docket")` was the one
  place `showPerUnitCheckboxes` was missed — the legacy
  `getDefaultSettings()` blob already had it `true`, so the two default
  sources disagreed and the section one won at render. Set it `true` on
  the section default to match packing-list/return-sheet.
- **`migrate:docket-per-unit` was a no-op for section-based templates.**
  The original script only flipped the legacy `settings.table` blob, but
  render reads `sections` first — so org templates customised through the
  modern editor kept the old single-row layout. The migration now flips
  both `sections[type=table].settings` and the legacy `settings.table`,
  with `--org` scoping. Idempotent, dry-run by default, `--apply` to write.

## [0.7.0.3] - 2026-05-30

Patch release — makes the v0.7.0.2 explicit-merge handoff actually
usable against production data.

### Fixed
- **`collapse:historic-splits` hid the ids you need.** A project-scoped
  dry-run truncated every line-item id to 10 chars and only collected
  singletons under `--diagnose`, so an operator saw neither the
  free-text priced parent (a singleton — its `modelId` is null or
  differs from the scan-created children) nor copyable child ids. The
  scoped dry-run now auto-dumps singletons + the unmatched bucket with
  **full ids**, ready to paste into `--merge-into` / `--children`.

## [0.7.0.2] - 2026-05-29

Patch release — finishes the historic-split consolidation tooling and
fixes the residue a merge leaves in the project view.

### Fixed
- **Merge tombstones showed as "Cancelled" ghost rows.** The
  split-collapse migrations keep each folded child line as `CANCELLED`,
  qty 0, `assetId` null so `LineItemMergeMap` history survives. But
  `getProject` didn't filter them, so a fold turned N duplicate
  equipment rows into N cancelled rows instead of removing them.
  `getProject` now filters `status != CANCELLED` on all three line-item
  includes (grouped, ungrouped-category, top-level), and the equipment
  tab re-applies the same predicate (`isHiddenFromList`) as defence
  against a stale cache or optimistic update. Normal line-item removal
  hard-deletes, so a `CANCELLED` line item is only ever inert merge
  residue. PDFs, warehouse, and list views already excluded it.

### Added
- **Explicit merge mode for `collapse:historic-splits`.** Older
  production data has a priced free-text parent (`modelId` null) whose
  physical rows were created later by scanning — parent and children
  share no FK and no `modelId`, only a description string, so no
  heuristic can safely cluster them. The script now takes
  `--merge-into <canonicalId> --children <id1,id2,...>`, validates both
  ends (same project/org, not kit children, have an asset, not already
  cancelled, canonical ∉ children), folds each child's asset onto a new
  unit on the canonical, repoints `CheckRecord` / `DamageEvent` /
  `ProjectService`, and writes the `LineItemMergeMap` audit row. When
  nothing clusters heuristically the script dumps the singletons (id,
  qty, price, status, model/description) so the operator can read off
  the exact ids. modelId-null rows are keyed per-row so a priced parent
  can never be falsely clustered.
- **Migration workflow drives the explicit merge.** `migrate.yml` gains
  optional `canonical_id` + `children_ids` inputs (shell-quoted, applied
  only for `collapse:historic-splits`) so the consolidation runs from
  the GitHub Actions UI — the prod SSH session freezes on long scripts.
  Dry-run by default; `apply` stays a separate human-gated checkbox.

## [0.7.0.1] - 2026-05-27

Patch release on top of the v0.7.0.0 fulfillment-model cutover.

### Fixed
- **T&T preflight missed unit-borne assets.** The checkout T&T
  compliance gate scanned `line.assetId` / `line.bulkAssetId` only.
  After the cutover those columns are null for most deployed lines —
  the assignment lives on the unit row — so a prepped asset with a
  FAILED or OVERDUE T&T record slipped past the gate. Preflight now
  unions three sources: legacy line columns, `ProjectLineItemUnit`
  rows on the same lines, and inbound `item.assetId` scans.
- **Delivery docket / packing list / return sheet showed `-` for
  multi-unit lines.** The PDF builder included `line.asset` but not
  `line.units`, so a `10x` deployed line rendered no asset tags. The
  builder now pulls units (filtered to non-CANCELLED) and the
  `getAssetTag` helper renders up to two tags, then `+N` for extras,
  falling back to legacy fields for single-asset and kit-child rows.

## [0.7.0.0] - 2026-05-27

Line-item fulfillment model — a foundational data-model rework that
fixes the long-standing warehouse checkout / docket duplication bug.

The order line (`ProjectLineItem`) now carries the commercial intent
and never splits: a `10x Powerplay P2` line stays one row with a
`quantity: 10`. Every assigned physical thing — a serialised asset, a
bulk slice — gets its own `ProjectLineItemUnit` row carrying its own
state (assigned / packed / checked-out / damaged / returned). Rollup
counters on the order line are recomputed from units in the same
transaction as every write, so order-line state never drifts from
unit truth.

### Added
- **`ProjectLineItemUnit` table** — one row per physical fulfilment.
  Phase 1 schema landed in 0.6.x; Phase 2a backfilled units for every
  existing line item with an asset assigned.
- **Unit-aware readers** — `reservation-conflicts.ts`,
  `utilization.ts`, `availability.getAssetBookings`, and the
  `addLineItem` double-booked guard all union the legacy
  `line.assetId` source with the unit table. Detection of
  unit-deployed assets is now correct; swap-candidate exclusion and
  the swap-asset TOCTOU re-check handle both shapes.
- **Split-sibling collapse migration** (`npm run collapse:split-siblings`,
  dry-run by default) — collapses historic per-asset siblings back
  onto one canonical order line under a strict full-equivalence key
  (every order-level field identical or flagged-not-merged). Moves
  units, repoints `CheckRecord` / `DamageEvent` / `ProjectService`,
  writes a permanent `LineItemMergeMap` audit row, and deactivates
  the sibling without deleting it. Operator-gated apply on prod.

### Changed
- **Checkout / check-in / prep / scan-lookup** rewritten to write and
  resolve units. `splitLineItem` (the per-asset line-fragmenting
  function that caused the docket duplication) is retired — zero
  callers remain.
- Check-in carries an `assetId` through the warehouse UI so a partial
  return of a multi-unit line returns the right physical unit.
- Kit check-in uses a no-unit fallback path for kit children (which
  carry `line.assetId` directly, no unit row) — both shapes are
  handled uniformly.

### Notes
- Test coverage: 45 new unit tests + 37 new integration tests across
  checkout, check-in, prep, reservation-conflicts, and the collapse
  migration. Full suite green on merge.
- Phase 4 (drop the now-redundant `ProjectLineItem.assetId` /
  `bulkAssetId` columns) intentionally deferred until all readers are
  observed clean in production.

## [0.6.0.1] - 2026-05-21

Hotfix for a production crash introduced in 0.6.0.0.

### Fixed
- **`ReferenceError: ReorderCandidate is not defined` taking down SSR.**
  Four Wave 3 server-action files (`reorder`, `utilization`,
  `reservation-conflicts`, `project-costs`) re-exported a type through the
  `"use server"` boundary via `export type { X }`. Next.js's server-action
  transform caught those re-exported type names in the module's export
  list and emitted runtime references to identifiers that, being types,
  have no value — so the SSR chunk threw on module evaluation and crashed
  affected routes. Types now live only in their `src/lib/*` modules;
  `"use server"` files neither re-export them nor serve them to consumers,
  matching the convention used everywhere else.

## [0.6.0.0] - 2026-05-21

Wave 3 — the AV-rental wedge. Eight new operational features plus an
app-wide error-UX overhaul. RVLT Flow now tracks the full asset lifecycle:
damage at checkin, the repair queue, ROI per asset, periodic inventory
counts, and reordering — and lets each operator extend the data model
to fit their shop.

### Added
- **Damage capture at checkin** — report damage on a returning item
  straight from the warehouse return flow. Camera-first capture: severity
  (minor / major / total), notes, photos shot on the rear camera, optional
  charge-back to the client. Major and total damage auto-creates a linked
  workshop ticket and holds the asset. Browse every event at `/damage`.
- **Workshop kanban** — `/workshop` shows the repair queue as a board:
  Scheduled → Awaiting Parts → In Progress → QA, with a Completed lane.
  Click a card forward or back a stage; QA cards get Pass / Fail buttons.
  Pass releases the asset, Fail keeps it held. Two new maintenance
  statuses (Awaiting Parts, QA) extend the hold/release state machine.
- **Asset utilization dashboard** — `/utilization` answers "is this gear
  paying for itself?" Per asset: booking rate, revenue, maintenance cost,
  damage cost, net contribution. Period selector (30 / 90 / 365 days /
  all time) and an idle / lossy filter to surface dead stock.
- **Stocktake / inventory verification** — `/warehouse/stocktake` runs a
  scan-driven count session. Pick a location, scan everything, and the
  system flags every discrepancy — missing, unexpected, wrong location,
  quantity mismatch. Resolve each one (mark lost, adjust quantity, update
  location) and the inventory updates on completion.
- **Reorder dashboard** — `/warehouse/reorder` lists every bulk item at or
  below its reorder threshold, grouped by preferred supplier. Tick items
  and generate a draft supplier order per supplier in one click. Bulk
  assets gain a preferred-supplier field and a last-reordered timestamp.
- **Maintenance photos** — attach before/after photos to any maintenance
  ticket via a reusable photo-grid input. Workshop cards show thumbnails.
- **Reservation conflict resolution** — when an asset is double-booked
  across overlapping projects, the project page shows an amber banner and
  lets you swap the conflicting line item onto a free asset of the same
  model in one click.
- **Custom fields** — define operator-specific asset attributes (rig
  number, firmware version, road-case colour, anything) at
  `/settings/custom-fields`. They render on the asset create/edit form and
  detail page. Text, number, date, dropdown, and yes/no field types.
- **Operational P&L panel** — the project detail page gains a right-rail
  costs panel: equipment revenue minus service, labour, sub-hire,
  maintenance, and damage costs, with charge-back awareness and a net
  margin bar.

### Changed
- **Error messages now show context, not raw exceptions.** A new
  `UserFacingError` type plus a Prisma-error translator turn "Unique
  constraint failed on the fields: (`assetTag`)" into "Duplicate asset
  tag — that asset tag is already used. Pick a different value." Asset,
  project, and line-item actions surface structured title + message +
  hint. The warehouse return page's error toasts use the same helper.
- **QR / barcode scanner hardened for iPhone** — per-instance camera
  viewport, `playsInline` so iOS Safari streams inline instead of going
  fullscreen, a remembered camera choice, a zoom slider, torch, and Micro
  QR support. The check-items and warehouse-lookup pages now scan with the
  camera too.

### Fixed
- Custom items inside a project group no longer vanish from the project
  total — they count as extras on top of the group's bundle price.
- The reservation swap re-check and reassignment now run in one
  transaction, closing a race where two operators could swap onto the
  same asset and silently re-create a double-booking.
- Stocktake discrepancy resolution wraps each inventory mutation in a
  transaction and floors bulk quantities at zero, so a counted shortfall
  can't drive stock negative.
- Maintenance-record deletion releases held assets and deletes the record
  atomically.

## [0.5.1] - 2026-05-14

### Fixed
- **Sub-hire dialog supplier picker (and sibling queries) showed "No suppliers found" for up to 5 minutes after login.** Better Auth's session cookie cache (5-minute TTL) can briefly return `activeOrganizationId: null` even after a successful login. The supplier picker, project sub-hires list, and sub-hire detail queries were gated on `enabled: !!orgId` — when client-side `orgId` was null, the queries never ran and rendered empty state. Server actions already resolve org server-side via `getTheOrg()` (single-org pattern), so the client-side gate was unnecessary. Removed the gate from all three queries in `sub-hire-order-dialog.tsx`. Matches the existing pattern in `asset-form.tsx`. (`src/components/projects/sub-hire-order-dialog.tsx`)

### Chore
- Sync `VERSION` file to match `package.json` (0.4.5 → 0.5.1). The 0.5.0 release bumped `package.json` but left `VERSION` at 0.4.5.

## [0.5.0] - 2026-05-14

App-wide cleanup, unification, and feature-completeness pass. Wave 1 fixed
four operational bugs that could leave inventory or revenue in a wrong state.
Wave 2 closed the highest-pain audit gaps (errors, custom-items pricing,
project totals, notifications, scheduled reports, settings IA, design drift).
Per P10, the multi-tenancy harness is retained but soft-warn linted —
single-tenant is the operational reality.

### Added
- **Boot-time env validation** — `src/env.ts` fails fast on missing or
  malformed environment variables. Replaces scattered `process.env.X!` reads.
- **Sentry** — `@sentry/nextjs` wired with safe defaults for client/server/edge.
- **DamageEvent model + MaintenanceRecord.projectId** — operational P&L can
  now attribute repair cost and damage to a specific project.
- **Notification email delivery** — cron endpoint that fans out batched
  notifications to opted-in recipients via Resend, with a `NotificationEmailLog`
  dedupe table to prevent the same notification firing twice in a window.
- **Notification preference table** — settings page lets users opt in/out of
  each notification type.
- **Persistent notification dismissal** — `Notification.dismissedAt` replaces
  per-device localStorage so a dismissal on phone clears desktop too.
- **Scheduled reports** — saved reports can now run on a `DAILY` /
  `WEEKLY` / `MONTHLY` cadence and email a CSV to a list of recipients.
- **Test & Tag checkout gate** — assets with a current `FAILED` or `OVERDUE`
  T&T record cannot be checked out. `SCAN_VERIFY` denial event is logged.
- **Shared inventory mutation helper** — `src/lib/inventory-mutations.ts`
  provides `adjustBulkAvailability` (guarded `updateMany`) and an
  `InventoryError` class with `NOT_FOUND` / `CROSS_ORG` / `INSUFFICIENT_STOCK`
  codes. Used by all bulk-asset write paths.
- **Audit-trail timeline UI** — every entity detail page now shows the last
  5 events with a "View all" link to `/activity` scoped by entityType +
  entityId.
- **TOTAL column on /projects** — the project list now shows the canonical
  rolled-up job total (services + line items + sub-hires).
- **Custom-line-item pricing fields** — the Add Custom Item dialog now
  exposes `isOptional` and discount, matching the rest of the line-items UI.
- **DeleteDialog / BulkDeleteDialog / ConfirmActionMenuItem** primitives —
  one consistent confirm pattern across the app, replacing every remaining
  `window.confirm`.
- **`subHire` + `groupTemplate`** in global search; **crew, check items,
  group templates** in org export/import.

### Changed
- **Settings nav** grouped into 4 IA sections with overline labels
  (Organization, Operations, Documents, Integrations).
- **Activity Timeline** is collapsed by default (5 events) on every
  entity detail page, with a deep-link to `/activity`.
- **General settings** page flattened — one `Card` per section was
  visual noise. Replaced with section headers + dividers.
- **`staff` role consolidated into `member`** — `staff` was identical
  to `member` in permissions. One migration row update, no UX change.
- **`ProjectLineItem.isSubhire` dropped** — sub-hire detection is now
  `subHireId != null` (single source of truth). Migration includes a
  prod-check note: confirm zero legacy-only rows before deploy.
- **Custom items in groups** now contribute to project total via
  `customExtras` on top of `bundlePrice * quantity`. The "suggested
  price" remains equipment-only — custom items are always extras.

### Fixed
- **Kit checkout/checkin** now correctly updates bulk-asset availability
  for nested KitBulkItems. Previously a kit holding bulk items would
  check out the parent but leave bulk availability stale.
- **Maintenance state machine** — atomic transaction wraps create / update;
  asset status only transitions `AVAILABLE → IN_MAINTENANCE` on hold and
  `IN_MAINTENANCE → AVAILABLE` on release (and only when no other
  IN_PROGRESS record holds the asset).
- **BulkAsset availability** — one-shot reconcile script repairs any
  rows where `availableQuantity` drifted from `totalQuantity − checkedOut`.
- **LOW_STOCK email regression** — `getNotifications` now live-computes
  `availableQuantity <= reorderThreshold AND reorderThreshold > 0` instead
  of trusting the cached `status` enum. Previously a refilled bulk asset
  could keep sending low-stock alerts.
- **Custom-items-in-groups double-count (pre-landing review)** —
  `calculateSuggestedPrice` is now equipment-only. Accepting the
  suggestion no longer billed every custom item twice.
- **Scheduled-report duplicate-send (adversarial review)** —
  per-recipient try/catch in the cron runner. A transient sendEmail
  failure on one recipient no longer prevents the `scheduleLastRunAt`
  stamp and trigger a re-fire to everyone on the next tick.
- **`requirePermission` enforced on reads** in `group-templates`, `crew`,
  `check-items`, and `sub-hires` server actions.
- **DESIGN.md typography drift** swept across components.

### Engineering
- **50 new integration tests** across 5 files: `warehouse-tt-block`,
  `maintenance-state`, `group-revenue-custom-items`,
  `notifications`, `scheduled-reports`. Integration harness runs against
  a real Postgres instance (`gearflow_test`).
- **Wave 2 Track E** ships a soft-warn lint that flags `requirePermission`
  / `logActivity` gaps on server actions. Single-tenant per P10 — failures
  in audit do not block builds, but the report runs in CI.

## [0.4.5] - 2026-04-20

### Fixed
- Subhired items no longer prompt for an asset tag during warehouse prep. Since subhires are third-party equipment you don't own, they are now prepped directly without requiring an asset assignment.

## [0.4.4] - 2026-04-19

### Added
- **Custom line items**: Add free-text items to any project without needing inventory records. Use the new "Custom Item" button in the Equipment tab to add borrowed gear, client-supplied items, or one-off rentals that aren't in your asset library.
- Custom items show a muted "Custom" badge in the equipment list and all three warehouse tabs (Pick/Prep, Deploy, Return).
- Custom items appear on all project documents — quotes, invoices, packing lists, delivery dockets, and return sheets — using their entered name as the display label.
- Custom items flow through the full warehouse pick/prep → deploy → return cycle via the existing button/checkbox mechanism (no barcode scan required).
- `addCustomLineItem()` server action with validated input (`customLineItemSchema`) — requires a name, optional quantity, price, pricing type, duration, and notes.

## [0.4.3] - 2026-04-16

### Added
- Duplicate model detection in add equipment dialog. When adding a model that already exists on the project, users can choose to combine (merge quantity) or add as a separate line item.
- Sub-hire items always create separate line items and never merge with own-stock items of the same model.
- `forceSeparate` parameter on `addLineItem` server action to bypass auto-merge.
- Line item notes now display in the equipment list view (truncated with full text on hover) for both regular items and kit children.

### Fixed
- Combine/separate choice no longer resets when adjusting quantity. Previously, changing the quantity spinner silently reverted the selection back to "combine".

## [0.4.2] - 2026-04-16

### Fixed
- Editing a line item no longer wipes its model association. The `updateLineItem` server action was unconditionally setting `modelId` to null when the edit dialog didn't send it, which removed the item from all overbook calculations and made the badge disappear after any edit.
- Edit dialog now correctly warns when a line item is overbooked due to in-maintenance, lost, or retired assets. Previously, the edit dialog compared against raw stock (including unavailable assets), so overbooked items appeared editable without warnings.
- Adding a second line item for the same model on a project now shows accurate availability. The add dialog previously displayed stale stock counts because cache wasn't refreshed after edits, removes, or moves.
- Server-side availability enforcement in both add and update paths now uses effective stock (excluding unavailable assets), matching the overbook badge logic.

### Added
- Edit dialog now shows full availability info (available count, usable stock, unavailable asset breakdown, conflicting projects), matching the add dialog experience.
- `computeStockBreakdown` helper centralizes stock calculations across all availability checks, preventing client/server divergence.

## [0.4.1] - 2026-04-15

### Added
- Group template picker in the project equipment tab's Add Group dialog. Selecting a template auto-fills the group title and flips the create action to apply the template's items; leaving it blank creates an empty group as before.
- "Save as Template" action on each project group dropdown, with a dialog pre-filled from the group title. Captures the group's model- and kit-backed line items via `saveGroupAsTemplate` and invalidates the templates query so newly saved templates appear immediately in the picker.
- Group Templates management page at `/settings/group-templates` (nav entry gated by `project:manage_line_items`). Lists all templates sorted by name with expandable item previews (kit vs. model icons, quantity badges), rename/description edit dialog, and a delete dialog that clarifies existing projects keep their line items.

### Fixed
- `updateGroupTemplate` item-replace path no longer drops `kitId` and `sortOrder` when rebuilding template items.

## [0.4.0] - 2026-04-15

### Added
- Kit delete flow: the kit detail page now exposes a `DeleteKitDialog` with two tiers. Archive (soft delete) is always available while the kit is AVAILABLE + active, and is the default; hard delete is an opt-in second option that is blocked whenever any `ProjectLineItem` references the kit, so historical project data is preserved. The dialog surfaces a human-readable reason when hard delete is unavailable. New server actions `canDeleteKit(id)` and `deleteKit(id)` back the UI, gated by the existing `kit:delete` permission.
- Group templates now support kit items in addition to model items. `GroupTemplateItem` got a nullable `kitId` column and a Zod XOR refine so each row references exactly one of `modelId`/`kitId`. A template can mix both: "FOH Package" = 2x SM57 (model) + 1x rack kit (rigid). `saveGroupAsTemplate` captures both kinds from the source group; `applyGroupTemplate` creates the model lines inside the same transaction as the new group, then delegates kit items to `addKitLineItem` per unit of quantity (so "2x rack kit" becomes two independent parent rows with their full child expansions). Kit expansion failures (conflicts, availability) are collected as warnings rather than aborting the apply, matching warehouse-staff expectations.

### Removed
- The unused `KitPreset` / `KitPresetItem` tables (introduced in an earlier WIP migration) have been dropped in favor of extending the existing `GroupTemplate` system. The `group_template_supports_kits` migration atomically drops the orphan tables and adds `kitId` + `sortOrder` to `group_template_item`.

## [0.3.5] - 2026-04-15

### Added
- Keyboard shortcuts in the warehouse item check form: `P`/`F` to pass/fail the focused PASS_FAIL row with auto-advance, `A` to pass all remaining, `↑`/`↓` to move the focused-row cursor (skips non-PASS_FAIL rows), `Enter` to submit. Shortcuts are suppressed while typing in a text input, while submitting, or with a modifier key held. Desktop-only hint bar in the sheet footer shows the available keys.
- Deprep check gate: deprepping a returned item whose model has check items now runs a second RETURN-context check at deprep time (the inventory↔staging boundary), in addition to the existing return-scan check. Matches the mental model where Deploy is a staging ground on both sides of the truck. Damaged/flagged items bypass the second check. Kits respect `KitCheckMode` (KIT_LEVEL runs one kit-level check, PER_ITEM runs a queue entry per child).
- New `completeCheckAndDeprep` server action that writes RETURN-context check records and resets `prepStatus=PENDING` in one transaction.
- React component test infrastructure (`@testing-library/react` + jsdom) with 11 keyboard-handler tests for `ItemCheckForm`. Existing 1656 node-env validation tests are unaffected.

### Fixed
- Scan input auto-refocus after check completion: `finishCheckQueue` now returns focus to the correct scan input via `requestAnimationFrame` (PREP → main scan input, RETURN → return-tab scan input, deprep → deploy-tab scan input), letting barcode scanners flow scan-to-scan without a mouse click between checks.
- Timer leak in `ItemCheckForm` pass-all undo window — the 3-second setTimeout is now cleared on form close and component unmount.
- `completeCheckAndDeprep` pre-condition guard now strictly enforces `status=RETURNED` and `prepStatus=PACKED`, rejecting CONFIRMED/PREPPING items that could previously have been written against by a race or UI bug.

## [0.3.4] - 2026-04-15

### Fixed
- Edit line item dialog (equipment tab) now shows overbooking warnings and requires confirmation to save an overbooked quantity — previously the warning only existed when adding items
- Overbooked badge in the equipment table now wraps onto a second line on narrow viewports instead of overflowing outside the table column, so the badge is visible on mobile
- Sub-hire line items no longer consume our own stock in availability/overbooking calculations — they represent third-party rental so they should be invisible to our inventory math (fixed in `addLineItem`, `updateLineItem`, `checkAvailability`, and `computeOverbookedStatus`)
- `updateLineItem` now enforces availability server-side when quantity increases, matching `addLineItem` — previously the `allowOverbook` parameter was accepted but never checked, letting the client bypass overbook confirmation
- Project status changes (cancelled, completed, returned, invoiced) now invalidate overbook/availability caches across all open projects, so stock freed up by the transition is visible immediately instead of after a 30s stale window
- Edit dialog overbook warning now surfaces a "no dates set — checking stock only" notice when the project has no rental dates, matching the add dialog

### Removed
- Dead code: `line-items-panel.tsx` and `edit-line-item-dialog.tsx` were imported but never rendered (replaced by `equipment-tab.tsx`). Deleting them prevents future audits from getting misled by stale overbooking logic in an unreachable component.

## [0.3.3] - 2026-04-14

### Fixed
- Overbooking badges and availability conflict detection now work when adding equipment to projects (dates were not being passed through to the availability checker)
- Overbooking badges now refresh immediately after adding, editing, or removing line items instead of staying stale for up to 30 seconds
- Kit additions and line item deletions via the line items panel now also refresh overbooking status

## [0.3.2] - 2026-04-01

### Added
- Timeline PDF multi-page pagination: services that overflow one page now automatically split across multiple pages with continuation headers
- Timeline PDF column settings: configurable columns (crew, location, notes, charge, cost, status) via query params with sensible defaults

### Fixed
- Crew members with multiple roles on the same project no longer appear as duplicate rows on call sheets, roles are merged into a single entry
- Day-header separators between dates on multi-day call sheets now have stronger visual separation with background fill and thicker borders
- Unicode bullet character in day-header replaced with ASCII pipe for Helvetica font compatibility
- Timeline route no longer loads unnecessary crew assignment data from the database
- Crew role deduplication now uses exact match instead of substring match, preventing silent role drops

## [0.3.1] - 2026-04-01

### Added
- Multi-day call sheets: generate one PDF with separate pages per day, each with day header showing date, phase badges, and crew count
- Per-person call sheets: filter to a single crew member's schedule across all days
- Crew role filtering: filter call sheet output to a specific crew role
- Call sheet info section: dense 2-column block showing PM contact, client, venue, schedule times, and equipment summary on call sheets
- Call sheet generation dialog: date picker with crew count badges, role filter, and individual crew member selector
- PM contact extraction from ProjectManager join table for call sheet info
- Equipment summary computation for call sheet context
- Day header pdfme plugin with accent bar, bold date label, and phase badges
- Call sheet info pdfme plugin with configurable visibility toggles
- 17 new tests covering section expansion logic, height estimation, and Zod validation

### Fixed
- Cap dates query parameter at 31 before parsing to prevent unbounded allocation

## [0.3.0] - 2026-04-01

### Added
- Sub-hire order system: first-class entities for tracking gear rented from third-party suppliers
- Dual cost/charge pricing with gross margin analysis on every sub-hire order
- Sub-hire groups: organize items into logical sections with group-level pricing overrides
- Two pricing modes: itemized (per-item costs) or order total (single lump sum)
- Supplier rate memory: last-used rates saved per model+supplier pair, auto-filled on next order
- Cost comparison panel: see rates from all suppliers when adding items to a sub-hire
- Sub-hire lifecycle: Draft → Confirmed → On Hire → Returned, with automatic line item generation on confirm
- Per-item placement targeting: assign sub-hire items to specific project categories/groups
- Per-item document visibility: control which items appear on quotes, invoices, and packing lists
- Sub-hire items integrate into project financial totals (subtotal, tax, total)
- Dashboard metrics: active sub-hires count, monthly sub-hire cost, overdue returns
- Shortage-triggered sub-hire: when adding equipment exceeds stock, prompt to sub-hire the shortfall
- Quick duplicate: clone a sub-hire order to a new draft with same items
- "via Supplier" display on sub-hire items across warehouse tabs and pull sheets
- Subhire badge on pull sheet (HTML and PDF) for internal warehouse documents
- Supplier name rendering on PDF packing lists and delivery dockets
- Payment status tracking and file attachments on sub-hire orders
- 94 new validation schema tests for sub-hire system

### Changed
- Legacy free-text "Add Subhire" dialog removed in favor of structured sub-hire orders
- Sub-hire status actions moved to header dropdown menu on project detail
- Equipment tab shows sub-hire items as kit-style groups with children
- Financial summary now includes sub-hire charges in project totals

### Fixed
- Duplicate line item generation when re-confirming sub-hire orders
- Sub-hire items appearing as regular flat line items instead of grouped display
- Sub-hire costs not flowing through to project financial calculations
- Cross-tenant write vulnerability in sub-hire item reorder (org scoping added)
- Missing org scoping on sub-hire status return path and line item sync queries

## [0.2.6] - 2026-03-28

### Added
- Project finance rewrite: billing weeks/days pricing model with per-group overrides
- Equipment tab category/group/line-item hierarchy with drag-and-drop reordering
- Line item edit dialog, move between groups, and uncategorized items section
- Category rename/delete UI with inline editing
- Group edit dialog with price field and suggested price hint
- Project manager picker and rental defaults on project form
- Merge notification toast when equipment items combine
- Template picker, pricing progress bar, and audit trail on project detail
- Default tax rate in org settings
- Financial summary sidebar with margin tracking
- 42 new validation and formatter tests for finance schemas

### Changed
- Equipment tab rewritten as proper flat table layout with table-layout fixed
- Group rows match line item style with edit button and dropdown menu
- Removed legacy groupName field from add dialogs, replaced with "Adding to" label
- Removed pricing approval UI (accept suggested price buttons)
- Project form UX overhaul: billing time under rental dates, match button

### Fixed
- Drag-and-drop: replaced nested DndContexts with single flat context using prefixed IDs
- Table column reflow on group expand/collapse (table-layout: fixed + colgroup)
- Broken callbacks and missing query invalidations in equipment tab
- Move dialog now defaults to item's current group instead of uncategorized

## [0.2.5] - 2026-03-25

### Added
- Warehouse check item system: org-scoped check item library with PASS_FAIL, NOTES, MEASUREMENT, and DROPDOWN types
- Model and kit check item assignments with drag-to-reorder and library picker
- Three-phase warehouse prep flow: Pick → Prep (with checks) → Deploy, replacing the old single-step checkout
- Check form sheet (full-screen mobile, slide-over desktop) with "Pass All" shortcut and photo upload on failures
- Multi-item check queue for serial/bulk prep and return flows
- Container grouping system: prepContainer field with auto-add container assets, container picker with category search
- Kit check modes: KIT_LEVEL (check the kit itself) and CHILD_ITEMS (check each child individually)
- PrepStatus and ReturnStatus enums for independent warehouse lifecycle tracking
- Warehouse close-out: per-project close with summary stats, batch close from dashboard
- Check history tab on asset detail pages with context filtering
- Model failure analytics widget showing per-check-item failure rates
- Ad-hoc check route at `/check/[assetTag]` for standalone inspections
- Predictive maintenance: auto-creates maintenance records when 2+ consecutive failures detected
- Flagged asset notifications for project managers
- Check items integrated into global search and page commands
- `splitLineItem` helper for DRY multi-quantity line item splitting (extracted from 5 duplicated sites)
- Bulk assign check items to multiple models from the model table (row selection + multi-select dialog)
- 61 new validation tests for check item schemas
- Container grouping in pull sheet PDFs with asset tag display

### Changed
- Warehouse page split into tab components (deploy-tab, return-tab, pick-prep-tab, close-out-tab) from monolithic 2700-line page
- Prep flow uses split-based pattern: multi-qty items split off qty=1 items during prep
- Removed old prep-kit system in favor of prepContainer string field
- Asset availability query rewritten as single atomic Prisma filter using `none` relation

### Fixed
- Asset availability filtering: assets already assigned to other projects no longer appear in picker
- Bulk items with checks now prep all units in one check dialog
- Items of same model in different containers grouped separately
- Quick-add scan now routes through check queue when model has check items (was skipping checks entirely)
- WarehouseClose uses unique constraint to prevent duplicate close-outs (race condition fix)
- deleteCheckItem blocks deletion when check item is used by kits (not just models)
- Design system compliance: notices use left-edge accent bar, metrics use inline strip, teal palette for selection badges

## [0.2.3] - 2026-03-20

### Added
- Section-based PDF template builder with block editor UI (3-pane layout: block tree, PDF preview, settings panel)
- Drag-and-drop block tree with row/column layout system and cross-column content moves
- Section settings panel with per-section-type controls (table columns, styling, conditional visibility, custom fields)
- Column width picker with preset layouts and custom percentage inputs
- Brand template system for reusable header/footer/accent color configurations
- Section presets — save and load custom section groups across templates
- Section renderer with multi-page pagination engine supporting table splitting, group headers, and continuation pages
- Condition evaluator for dynamic section visibility based on document data
- Token resolver whitelist for safe template variable substitution
- `gearflow-rect` plugin for section background/border styling
- Document-level settings types and save pipeline for footer configuration (page numbers, text, format)
- 124 new tests covering block utilities, section renderer, token resolver, condition evaluator, and validation schemas

### Fixed
- PDF table pagination: fixed N×N page multiplication caused by separate pdfme inputs per page
- PDF table pagination: fixed item duplication when items span page breaks (startIndex/endIndex/isContinuation)
- PDF table pagination: aligned section-renderer filtering/grouping with plugin to fix 64-page PDF bug
- PDF table pagination: fixed phantom table padding and group header re-draw height estimation
- Crew table overflow clipping to page bounds
- Null guards in page header plugin and crew table to prevent 500 errors on preview
- TOCTOU race condition in template save optimistic locking (moved to transaction)
- Added size validation guard on template thumbnail uploads

### Changed
- Template preview now uses native browser PDF viewer instead of custom renderer
- Document template schema extended with section-based fields, brand template reference, and thumbnail storage

## [0.2.2] - 2026-03-19

### Added
- Full UX/UI structural redesign eliminating "AI slop" patterns across the entire app
- New design system (`DESIGN.md`) with deep teal primary palette, DM Sans typography, and motion guidelines
- Framer Motion utility components: `FadeIn`, `StaggerList`, `StaggerItem`, `AnimatedNumber`, `SurfaceLift`, `TabFade`
- Pure SVG data visualization: `Sparkline`, `UtilizationBar`, `DateRangeBar` (no charting library)
- 10 domain-specific spot illustrations for empty states (road case, stage plot, headset, etc.)
- Centralized `StatusIndicator` component with `status-colors.ts` replacing 20+ scattered inline color maps
- Keyboard shortcuts system (`Cmd+K` search, `Cmd+N` create, navigation shortcuts)
- Reusable `PageHeader`, `ListPageLayout`, `SectionHeader` layout components
- Shimmer skeleton loading states replacing static placeholders
- 61 new tests covering status colors, sparkline math, empty state resolution, dashboard utilities

### Changed
- **Dashboard**: Replaced 7 identical stat cards with inline metrics strip, dynamic time-of-day greeting, alert badges (overdue/maintenance), and DateRangeBar-enriched project list
- **All detail pages** (10 pages): Converted from full-width tab layout to asymmetric 2-column layout with sticky sidebar containing key info, eliminating need to tab through to find status/dates/financials
- **Sidebar navigation**: Reorganized into 5 logical sections (Core, Assets, Operations, People, Admin) with Quick Create dropdown
- **Warehouse**: Projects grouped by urgency (overdue → today → upcoming) with color-coded left borders
- **Login page**: Split-panel layout with brand panel and dot grid background
- **Tables**: Removed uniform surface wrappers, added contextual data (DateRangeBar in projects, utilization in assets, cert count in crew)
- **Forms**: Replaced Card wrappers with `SectionHeader` chip labels and increased spacing
- **Empty states**: Added spot illustrations and preset system for 20 domain contexts
- **Settings/Account**: Section-based layout with `SectionHeader` labels replacing monolithic cards
- **Availability calendar**: Borderless grid with contextual month header

### Removed
- Legacy Card component wrappers on forms, settings, and detail pages
- Old color tokens (`bg-muted`, `text-foreground`, `text-muted-foreground`) — replaced with semantic tokens
- Stat card grid pattern on dashboard
- Uniform surface-ring wrapping on all tables

## [0.2.1] - 2026-03-19

### Fixed
- Resolved all 145 ESLint errors to pass CI lint checks
- Excluded third-party gstack skill files from project ESLint scope
- Fixed misplaced `eslint-disable` comments that weren't suppressing errors
- Fixed `prefer-const` violations across PDF and server modules
- Fixed `react/no-children-prop` error by renaming `children` prop on KitChildRows
- Fixed `useMemo` dependency array using method calls instead of simple expressions
- Removed stale `eslint-disable` directive on interface with no violation

## [0.2.0] - 2026-03-19

### Added
- Test infrastructure: Vitest for unit tests, Playwright scaffold for E2E
- 1,084 unit tests covering all 20 Zod validation schemas + utility functions
- VERSION file for semantic versioning
- CHANGELOG.md following Keep a Changelog format
- TODOS.md for tracking deferred work
- CI pipeline now runs tests before deploy
- npm scripts: `test`, `test:watch`, `test:coverage`, `test:e2e`

## [0.1.0] - 2026-03-10

Initial release of RVLT Flow — asset and rental management platform for AV/theatre production companies.

### Added

#### Core Platform
- Next.js 16 App Router with Turbopack, TypeScript strict mode
- PostgreSQL database with Prisma v6 ORM (56 models)
- Better Auth with organization plugin, 2FA, passkeys, SSO (SAML/OIDC)
- Two-tier role system: site admin + org roles (owner, admin, manager, member, viewer)
- Custom per-org roles with granular permission matrix
- Tailwind CSS v4 + shadcn/ui v4 dark theme

#### Asset Management
- Serialized and bulk asset CRUD with auto-incrementing asset tags
- Asset models with categories, specifications, and custom fields
- Kit system — physical containers with fixed sets of assets
- QR code generation and barcode scanning
- Media uploads to S3 with org-prefixed paths
- CSV import/export for assets and models

#### Project & Rental Lifecycle
- Full project lifecycle: enquiry → quoting → confirmed → deployed → returned → invoiced
- Line items with per-day/week/hour/flat pricing and group support
- Subhire line items for third-party equipment
- Project templates and duplication
- Availability engine with overbooking detection
- Booking calendar views for models, assets, and kits

#### Warehouse Operations
- Barcode-driven checkout/checkin scanning
- Kit atomic checkout/checkin (scans kit, deploys all contents)
- Pull sheet generation for project preparation
- Warehouse display dashboard (live, token-based)
- Conflict detection for double-bookings

#### Documents & PDFs
- Quote, invoice, packing list, return sheet, delivery docket, call sheet PDFs
- Custom document template designer (pdfme)
- Kit group rendering in documents

#### Crew Management
- Crew members with roles, skills, and certifications
- Project assignments with phases and rate overrides
- Shift scheduling and timesheet tracking
- Crew availability calendar
- iCal feed export

#### Compliance & Maintenance
- AS/NZS 3760 Test & Tag module with full electrical test records
- Maintenance records (multi-asset, scheduled/ad-hoc)
- Compliance reporting (PDF/CSV)

#### Clients & Suppliers
- Client directory with company/individual types
- Supplier management with purchase orders
- Address autocomplete via Google Maps

#### Reporting & Search
- Report engine with ~30 pre-built reports and custom report builder
- Global search with fuzzy matching and keyboard navigation
- Activity log audit trail

#### Settings & Admin
- Organisation settings: branding, asset tag config, timezone
- Site admin panel for user/org management
- Team member invitations via Resend email
- WooCommerce integration (webhook-driven order import)

#### Mobile & PWA
- Progressive Web App with offline support
- Mobile-responsive layout with safe areas
- Continuous barcode scanning on mobile

### Infrastructure
- Self-hosted deployment via GitHub Actions + PM2
- Google Maps integration (address autocomplete, location mapping)
