# Test & Tag Module (AS/NZS 3760:2022)

> _Owner: Jayden Nawotka · Last reviewed: 2026-07-23 (review quarterly — POLICY.md R-5.5)_

## The Test & tag list (UX Phase 14, 14a-3, `/test-and-tag`)
`/test-and-tag` IS the list (`src/components/test-tag/test-tag-list.tsx`, config `src/lib/list-views/test-tag.ts`) on
`ListPage` over `testTagList.listPage` / `segmentCounts`. The old overview page and the registry table are gone;
`/test-and-tag/registry` redirects to `/test-and-tag?seg=all` (D44).
- **State is derived, never the stored word** (`convex/lib/testTagListState.ts`, the ONE definition): Retired
  (retired or inactive) > Failed (stored `FAILED`, cleared by the next pass) > Overdue (`nextDueDate` in the past)
  > Due (inside the due-soon window, or never tested) > Passed. The stored `DUE_SOON` / `OVERDUE` the cron writes
  can lag and is not read. The window is the org's own `dueSoonThresholdDays` (Settings > Test & tag, clamped 1 to
  90, default 14), passed by the client. The More sheet's Test & tag count (`navCounts` `testTagOverdue`) uses the
  same derived Overdue, so the number on the row is the number on the page it opens.
- Strip `Due · Overdue · Passed · Failed · All · Retired` (All = not retired; Retired stays reachable and offers
  `Reactivate` with its existing exact Undo). Filters: Class, Type, Profile, Link. Columns: Last test, Result, Next due
  (a failed item prints `After repair`), Tester; opt-in Class, Appliance type, Profile, Linked asset. The sort is an
  explicit allow-list; reads are bounded and say `truncated`.
- Primary `Register item` (`/test-and-tag/new`). Page menu: `Sync from assets` (the backfill), `Quick test` (the Scan
  page's Test & tag mode), `Reports…` (still the reports page).
- **Dialogs (14a-3b, D44).** `Reports…` (page ⋯, absent without `reports:view`) opens `ReportsDialog` from `?dialog=reports`:
  the ten reports come from ONE table, `src/lib/test-tag-reports.ts` (kinds, formats, the filters each asks for, the URL), and
  Generate PDF / Download CSV call the unchanged `/api/test-tag-reports/<key>` routes. `/test-and-tag/reports` is now only a redirect
  to `/test-and-tag?dialog=reports` (the nav sub-row and the ⌘K page command point at the dialog URL).
  **Export report** (row ⋯ and record ⋯, `reports:view`) opens that item's history PDF. **Print tags** (bulk bar) prints one label
  per selected item through the ONE `LabelTemplate` in `sheet` mode (a label per page, everything else hidden on print); its data is
  `testTagList.labelsFor` (the latest test of each item, at most 100 ids, org-checked, bounded), and a never-tested item has no
  label and is NAMED, never printed blank. **Schedule…** (row, record ⋯, bulk; `maintenance:create`, absent on a retired item) books
  ONE scheduled `TEST_AND_TAG` maintenance job covering the items' linked serialised assets (`planTestSchedule`,
  `src/lib/test-tag-schedule.ts`; an item with no linked asset is named as skipped); the toast's Undo is `undoCreateNative`, ids only.

## The Test & tag record (UX Phase 14, 14b-4, `/test-and-tag/[id]`)
`TestTagRecord` (`src/components/test-tag/record/test-tag-record.tsx`) on `RecordShell`, reading `testTagAssets.detail`
live (a subscription, not a one-shot).
- **Header word is derived** by the list's own rule (`deriveTestTagState`, `src/lib/test-tag-record-facts.ts`):
  `18d overdue`, `Due in 5d`, `Not yet tested`, `Passed`, `Failed`, `Retired`, with the org's due-soon horizon.
- **Overview**: `n of m checks clear` (tested inside its interval, the last test passed, a test profile is set; a check
  with no input is `not checked`, never a pass), each failing row with its one action (`Record test ›` / `Edit ›`), then
  three fact columns (Dates, Item, Place). Next due is last test + interval, never typed (a failed item says `After repair`).
- **Tabs**: Overview · Tests (newest first, readings and the tester, `Show 25 more · n left`) · History (the audit log).
  There is no Files tab: a test row carries no files.
- **`Record test`** is the one primary (the Scan page's Test & tag mode); `Edit` is the real sheet; ⋯ holds `Print label`
  (when the item has a test: the browser print dialog over the one `LabelTemplate`, the latest test, for an active or a
  retired item), `Retire` (active item) or `Reactivate` (retired), and `Delete…` ONLY for a retired item (red, last, naming that every test and
  its readings go too).
- **Edit sheet** (D80, `TestTagSheet`, `?edit=1`, `TestTagSheetHost`): the fields `testTagEditWrites.editNative` sets
  (description, class, type, make, model, serial, location, interval, profile, outlets, notes, and one link: an asset OR
  a bulk asset), nothing else. There is NO status field and the tag id is not editable. A blank optional box CLEARS its
  field. It is a plain `recordFieldEdit`; the toast Undo is `undoEditNative` (ids only: author, 10-minute server window,
  once, compare-and-set on the fields it changed). **Next due is derived**: a changed interval on a tested item re-derives
  `nextDueDate` (last test + new interval) in the same write, and the Undo restores it; `nextDueDate` is not a settable
  field. When the interval changed, the audit row also records the dates next due was derived from (`details.guard`:
  last test, next due) as COMPARED-not-restored inputs, so an Undo refuses once a test has landed since. A retired
  item is not edited (Reactivate first). A link is set to an id (org-checked when changed) or cleared through `clear`;
  an empty string is refused.
- **The sheet sends only what it changed** against the values it OPENED with (`src/lib/changed-edit.ts`, the same rule
  as the job edit sheet's `buildProjectUpdate`; the Maintenance sheet does the same), so another user's edit made after
  it opened is never silently reverted.
- **Retire has an exact Undo** (`retireNative` with an actor and audit id writes the row `undoRetireNative` reads: the
  status, active flag and `updatedAt` it overwrote; refuses unless the author, in the window, once, and the item is
  still exactly as the retire left it). It refuses an already-retired item, takes the actor and audit id together or
  neither, and refuses a reused audit id. The Scan page's older retire (no audit id) still retires and offers no Undo.
  The attributed actor is always the verified caller (`resolveActor`), never the one in the arguments.

## Equipment Classes
- `CLASS_I` — Earth continuity + insulation/leakage
- `CLASS_II` — Insulation/leakage only (no earth)
- `CLASS_II_DOUBLE_INSULATED` — Same as Class II
- `LEAD_CORD_ASSEMBLY` — Earth continuity + always polarity (like Class I but polarity not conditional)

## Appliance Types
`APPLIANCE`, `CORD_SET`, `EXTENSION_LEAD`, `POWER_BOARD`, `RCD_PORTABLE`, `RCD_FIXED`, `THREE_PHASE`, `MICROWAVE`, `OTHER`

## Status Lifecycle
```
NOT_YET_TESTED → (first test) → CURRENT
CURRENT → (interval expires soon) → DUE_SOON
DUE_SOON → (interval expires) → OVERDUE
Any → (test fails) → FAILED
Any → (manual) → RETIRED
FAILED → (retest passes) → CURRENT
RETIRED → (reactivate) → NOT_YET_TESTED
```

## Test Profiles

Test profiles define which visual checks and electrical tests apply for a given equipment class + appliance type combination. Stored in the `TestProfile` model.

### Schema
- `name` — unique per org (e.g. "Class I Appliance")
- `equipmentClass` — CLASS_I, CLASS_II, etc.
- `applianceType` — APPLIANCE, POWER_BOARD, etc.
- `visualChecks` — JSON array of `{ key, label, defaultEnabled }` items
- `electricalTests` — JSON array of `{ key, label, unit, defaultEnabled }` items
- `thresholds` — JSON object with pass/fail limits per test (e.g. `{ earthContinuity: { max: 1.0 } }`)
- `requiresSubTests` — true for power boards, RCD power boards, three-phase
- `defaultSubTestCount` — default outlet/phase count
- `subTestLabel` — "Outlet", "Phase", or "Port"
- `isDefault` — seed profiles are marked default
- `isActive` — soft-delete via deactivation

### Seed Data
12 AS/NZS 3760 default profiles in `src/lib/test-profiles/seed-data.ts`. Seeded via Settings UI button or `seedDefaultProfiles()` server action.

### Profile Resolution (cascade)
One implementation, `convex/lib/testProfileResolve.ts`, shared by `testProfiles.resolveForAsset`,
`scanLookup.testCard` and `testTagRecordsWrites.createNative` (which holds the test to it):
1. Asset's `testProfileId` (if explicitly set)
2. Asset's model `defaultTestProfileId` (inherited)
3. First default profile matching equipment class + appliance type
4. Any matching active profile

### Settings UI
`/settings/test-and-tag/profiles` — CRUD for test profiles with:
- Empty state with "Seed Defaults" button
- Table: name, class, type, enabled test count, sub-test config, active badge
- Edit dialog: name, class, type, visual check toggles, electrical test toggles with thresholds, sub-test config, active toggle
- Row actions: edit, duplicate, delete

## Sub-Tests

Multi-outlet/phase devices (power boards, RCD power boards, three-phase) require per-outlet testing via the `SubTestRecord` model.

- Each sub-test records: earth continuity, insulation, leakage current readings + pass/fail per test
- Labels auto-generated: "Outlet 1", "Outlet 2", ... or "L1-L2", "L2-L3", "L1-L3" for three-phase
- UI allows adding/removing outlets during testing
- `outletCount` remembered on asset for next test

## Testing an item: the Scan page's Test & tag mode (Phase 16, spec §9i)

The five-step quick-test wizard is gone. Testing is `/scan?mode=tt&tag=` — the same page
as the ad-hoc check (FEATUREDOCS/37), one scroll, no steps. `/test-and-tag/quick-test[?id=]`
is a server redirect into it (old links, the item page's "Test now", the palette), and NAV
› Test & Tag › Quick Test points at `/scan?mode=tt`. Mode shown only with `testTag:create`.

- **Any tag**: an asset tag or a test tag (`TT-0412`) reaches the same item
  (`scanLookup.testCard`, which also returns the resolved profile).
- **States**: an asset not on the register → `Add to the register` (Undo is the guarded
  `testTagAssetsWrites.undoCreateNative`: author-only, 10 minutes on the server clock, and
  only while the new item is untouched — still Not tested, active, `updatedAt` as created,
  no test recorded since); a RETIRED item → `Reactivate and test` (Undo is
  `undoReactivateNative`, restoring the prior status, `isActive` and `updatedAt` exactly);
  an item that is inactive but not retired says so, with no Reactivate (the server only
  reactivates a retired item); unknown / kit / bulk tags say what to scan instead; a tag the
  page can't read says `Can't read tag X`. Each is logged in Last scans.
- **The form** (`src/components/scan/tt-section.tsx`, draft `src/lib/tt-draft.ts`):
  - `Tested by: Name ▾` (org members; sticks for the session, defaults to you) and
    `Method: … ▾`.
  - Visual inspection: an always-on tick per enabled check (shift-click ticks a range),
    `Fail` per check, `Pass all` with Undo, notes, `n/m` + a dot-word in the head. Pass
    all's Undo (`revertPassAllVisual`) puts back only the ticks it made that still read
    ticked; later fails, readings and notes survive. With nothing left to revert it says
    `Nothing to undo`; with every check already ticked Pass all writes nothing.
  - Electrical: one row per enabled profile test with its threshold, the reading's own
    dot-word verdict, and `N/A`; pass / fail / N/A words for polarity and the RCD
    push-button; an optional insulation test voltage.
  - Outlets (sub-test profiles): `− n +`, a row per outlet with its readings and polarity.
  - Result: `Pass` / `Fail` / `not finished`, and **Next due, derived** (`Next due 21 Feb
    2027 · every 3 months`; a fail reads `Next due after repair`).
  - On a fail, inline `Failure action: Removed from service ▾` (D53 default; also
    Referred to electrician — only for an item linked to inventory — Disposed / retired,
    Repaired on the spot, No action), failure notes, and a line saying the item is
    flagged. No blocking dialog.
- **The primary** `Save and scan next` is disabled with the first blocker in plain words
  (`Enter insulation resistance, or mark it N/A`, `Finish the visual inspection (2 left)`).
  Caret: `Save and keep this asset open`, `Save and print label` (mounts the saved record's
  `LabelTemplate` print-only, then prints — it used to print the page).
- **Create maintenance job…** (card ⋯, and the caret's `Save and create maintenance job` on a
  fail; only for an item linked to inventory): the same dialog and exact Undo as Check mode
  (FEATUREDOCS/37), prefilled with what failed (`Visual: Plug condition`, `Earth Continuity:
  fail`, the failure notes). The old wizard's fail dialog only set `Referred to electrician`,
  which stays reachable as a failure action.
- **Card ⋯**: Open asset, `Quick pass: repeat the last test` (PREFILLS the last record's
  ticks, readings and method for review; every blocker still applies — it can no longer
  save a reading-less PASS; absent for an item never tested), Open in test & tag list, Clear this scan, `Retire from test &
  tag…` (confirm; no Undo, because reactivating sets Not tested, not the prior status).
- **Save awaits** `recordTest`; the save's ONE undo closure (`undoRecordTest`) is the
  toast's Undo and the Last scans row's (10 s), and restores the draft when nothing else is
  loaded. A scan over unsaved answers asks `Discard this test?`; Escape never resets
  the answers.
- **Keyboard** (`src/components/scan/use-tt-hotkeys.ts`, restored from the old page):
  `Ctrl/⌘+Enter` saves (also from inside a reading or note), `Esc` goes back (clears the
  scan, asking first over answers), `Ctrl/⌘+Shift+P` passes all visual checks. Only while
  a test card is open and no dialog or menu is open; inside a text field only
  `Ctrl/⌘+Enter` is taken. Known limit: in Firefox, `Ctrl+Shift+P` is the browser's own
  "New private window" and never reaches the page, so there it does nothing (use the
  `Pass all` button); left as is by decision.
- **A save that fails after a mid-save scan** names the item (`Test on TT-0412 wasn't
  saved`) and offers Retry with exactly the captured answers, once; the item now on screen
  is left alone (same as Check mode, FEATUREDOCS/37).
- Last scans (`n pass · n fail`) replaces the session log; the page ⋯ holds `Scan sounds`.

## Audio / Scan Feedback

The Scan page uses the shared **`src/lib/scan-feedback.ts`** + **`src/hooks/use-scan-feedback.ts`**
pair (FEATUREDOCS/12 §"Scan Feedback"; the T&T wizard's page-local `playBeep` was the
original call site): a save plays `success` on a PASS and `error` on a FAIL or a failed
save, `exception` on a tag it can't test. The toggle is the page ⋯ `Scan sounds` (the same
`rvlt.scanAudio` key; the old `<ScanFeedbackToggle>` is deleted). Haptics (#1220) ride the
same toggle; `navigator.vibrate` is unimplemented on iOS Safari, so iOS is audio-only.

### Failure actions
On a derived FAIL the record's `failureAction` (default `REMOVED_FROM_SERVICE`, D53 — a UI
default; an API caller that sends none gets `NONE`, Q16):
- `REMOVED_FROM_SERVICE` → item status FAILED
- `REFERRED_TO_ELECTRICIAN` → opens a REPAIR maintenance record linked to the inventory
  asset and sets that asset IN_MAINTENANCE (only for an item linked to inventory)
- `DISPOSED` → item RETIRED, `isActive: false`
- `REPAIRED` / `NONE` → recorded, no side effect

### Pass/Fail Calculation
The browser previews with `src/lib/tt-draft.ts` (`readingVerdict`, `ttBlocker`,
`ttResult`, `ttPayload`), which imports `evaluateReading` and `TEST_FIELDS` from
`convex/lib/testTagReadings.ts` — ONE function for preview and check.

**The server is the authority (Phase 16, D51 + Q11).** `testTagRecordsWrites.createNative`
re-derives everything in `convex/lib/testTagReadings.ts` before it writes:
1. **Each reading carries its OWN verdict.** A numeric reading needs `PASS`/`FAIL`; a
   `PASS`/`FAIL` needs its reading; `NOT_APPLICABLE` carries none. (Live bug F5: every
   reading used to be stored with the *overall* electrical result, and RCD trip time was
   always `PASS`.)
2. **A blank enabled reading is rejected, an explicit N/A is not (D51).** Every test the
   profile enables must be answered. The profile is ALWAYS the asset's resolved cascade
   (`convex/lib/testProfileResolve.ts`, which skips deactivated profiles): a caller may
   name it as `testProfileId` only to confirm it — naming another (a laxer one), a foreign
   or an inactive profile is rejected, and only the resolved profile is ever pinned onto
   the asset. Sub-test profiles apply the same rule per outlet; a profile that requires
   sub-tests needs 1–50 of them, and `outletCount` (a whole number 1–50) must equal the
   outlets tested. A legacy object-shaped `electricalTests` blob is normalised (an entry
   counts as enabled unless it says `enabled: false`), never read as "no tests".
   `testDate` may not be more than 5 minutes ahead of the server clock.
3. **A stated threshold decides the verdict.** A reading that fails the profile's limit
   can't be sent as a pass (outlets use `thresholds.earthMax`/`insulationMin`/`leakageMax`,
   as the outlet UI does).
4. **The overall `result` is derived** (visual — a false tick fails it — any reading,
   functional test, any outlet). There is no `result` argument any more (live bug F9:
   the server stored whatever result it was sent). A failure action only applies to a
   derived FAIL.

RCD trip current, the RCD push-button test and microwave leakage are now stored, each
with its own verdict (`rcdTripCurrentResult`/`Reading`, `rcdPushButtonResult`,
`microwaveLeakageResult`/`Reading`; owner-approved schema change, 2026-11-21). Absent on
older rows = "not recorded".

### Next due is derived (D52)
`nextDueDate` is never typed and is not a `createNative` argument: the server stores
`deriveNextDueDate(testDate, asset.testIntervalMonths)` (`convex/lib/testTagNextDue.ts` —
UTC calendar months, clamped at month end, 3 months when the asset has no interval) and
returns it. To change a date, change the interval on the register. A **failed** test
stores the same derived date — the UI reads it as "Next due after repair" — and the asset
stays `FAILED` until a passing test.

### Undo a saved test (Phase 16, Q2/Q10)
`testTagRecordsWrites.undoCreateNative({ orgId, recordId, … })` (`testTag:create`,
`danger: "high"`) is the exact reverse of one save. The save's own audit row carries a
server-written before/after snapshot of the T&T asset (`lastTestDate`, `nextDueDate`,
`outletCount`, `testProfileId`, `status`, `isActive`, `updatedAt`), the inventory asset a
referral flagged, and the referral it opened (`convex/lib/testTagUndo.ts`). The Undo takes
only ids and refuses (changing nothing) unless it is **within 10 minutes on the server
clock** (`UNDO_WINDOW_MS`, `convex/lib/undoWindow.ts`, shared with the ad-hoc check's
Undo), by the tester who saved it, the first undo (its forward audit row is read first, so
a second undo is answered by the UNDO-row guard), the record is still the item's
newest, and the item / flagged asset / referral are exactly as the save left them. It
deletes the record, its sub-tests and an untouched referral (a link it added to an
EXISTING referral is deleted by `(maintenance record, asset)` after an org check, never by
a bare link id; the save also rejects a colliding `maintenanceLinkId`), restores every field exactly
(absent ones unset), and appends an `UNDO` activity row as the compliance trace. (Nothing
else references a record today — labels print client-side and are not recorded.) Like
every Phase 16 Undo, it deletes only the records its save created and NEVER deletes a
stored file (overseer ruling 2026-11-24; the reasoning is in FEATUREDOCS/37).

## Auto-Incrementing IDs
Same pattern as asset tags. Stored in `Organization.metadata.testTag`:
```json
{ "prefix": "TT", "digits": 5, "counter": 1 }
```

## Settings (`Organization.metadata.testTag`)
- `defaultIntervalMonths`, `defaultEquipmentClass`, `dueSoonThresholdDays`
- `companyName`, `defaultTestMethod`, `checkoutPolicy`

## Label Printing
`src/components/test-tag/label-template.tsx` — 89mm x 36mm label with CSS @media print. Shows tag ID, barcode, PASS/FAIL result, test date, next due, tester name, company.

## Routes
- `/test-and-tag` — Overview
- `/test-and-tag/registry` — Item list
- `/test-and-tag/new` — Create item
- `/test-and-tag/[id]` — Item detail + test records
- `/test-and-tag/quick-test` — redirect to `/scan?mode=tt[&tag=]` (the Scan page's Test & tag mode)
- `/test-and-tag/reports` — redirect to the Reports dialog (`/test-and-tag?dialog=reports`, 14a-3b)
- `/settings/test-and-tag/profiles` — Test profile management

## Page header actions (UX prominence)
Running a test is the primary task across the section, so the header CTAs are ranked
test-first to avoid confusing "new test" with "register equipment":
- **Overview** (`/test-and-tag`): primary "Quick test" (→ `quick-test`), secondary `line`
  "Add equipment" (→ `new`), `line` "Registry" (→ `registry`).
- **Registry** (`/test-and-tag/registry`): primary "New test" (→ `quick-test`), secondary
  `line` "Add equipment" (→ `new`); "Sync from assets" (backed by `backfillTestTagAssetsCore`,
  `convex/lib/` — a Convex-side helper, not a standalone server action)
  lives in a `⋯` overflow `DropdownMenu`. ("Add item"/"Sync" were the old prominent labels —
  the bare "Add item" primary made registration look like the main task.)

## Convex Functions (formerly server actions, all deleted from `src/server/`)
- `convex/testTagAssets.ts` (reads) + `convex/testTagAssetsWrites.ts` (browser-direct mutations) — CRUD, batch create, sync, reactivate
- `convex/testTagRecords.ts` + `convex/testTagRecordsWrites.ts` — Test records with sub-tests, session tester, fail workflow, status recalculation; derived next-due + result and the reading guards (above); `undoCreateNative`
- `convex/scanLookup.ts` `testCard` — the Scan page's T&T card: an asset tag or a test tag → the item, its four facts and its resolved profile (FEATUREDOCS/19)
- `convex/testProfiles.ts` + `convex/testProfilesWrites.ts` — Profile CRUD, seed defaults, resolve profile cascade, duplicate

## Server Action (genuine carve-out — CSV/Node)
- `src/server/test-tag-reports.ts` — Report data + CSV exports (includes sub-test data).
  All eight CSV exports build their cells through `toCsv` (`src/lib/csv.ts`, the
  formula-injection guard — FEATUREDOCS/20), covered by
  `src/server/test-tag-reports.csv.test.ts`. A missing date is a blank cell (it used to
  be a `-` placeholder, which the guard would print as `'-`).

## Auto-Registration
When creating an asset with a model that has `requiresTestAndTag: true`, a `TestTagAsset` record is automatically created. If the model has `defaultTestProfileId`, the asset inherits it.

## Model Integration
Models can set:
- `requiresTestAndTag` — auto-creates TestTagAsset on asset creation
- `testAndTagIntervalDays` — default retest interval
- `defaultEquipmentClass` — equipment class for auto-registered assets
- `defaultApplianceType` — appliance type for auto-registered assets
- `defaultTestProfileId` — test profile inherited by assets

## UI / Design System (RVLT polish, chunk 11)
- Status colours come from `src/lib/status-colors.ts`: category `testTag` (CURRENT=
  success, DUE_SOON=warning, OVERDUE/FAILED=error t-out, NOT_YET_TESTED/RETIRED=
  neutral) and `testTagResult` (PASS=success, FAIL=error, NOT_APPLICABLE=neutral).
  Per DESIGN.md §1 a FAIL/overdue is the t-out (problem) semantic, a current/valid
  PASS is ok (success). **Never use teal for a PASS** — teal is the module hue, not
  a status.
- Human labels come from `src/lib/status-labels.ts`: `testTagStatusLabels`,
  `testTagResultLabels`, `equipmentClassLabels`, `applianceTypeLabels` (all sentence
  case). Reuse/extend these rather than hand-rolling per-file maps.
- Auth: every page is gated with `RequirePermission resource="testTag"` (read for
  list/detail/registry, create for new/quick-test). Reports uses `reports`/`view`.
- The Scan page's Test & tag mode is the inspector data-entry flow: 44px tap targets,
  16px inputs on a phone, the primary pinned above the bottom nav, plain copy (no
  personality) in the failure action / retired / not-on-register states (alert
  contexts, §9).
- `label-template.tsx` is a print template — intentionally left on its own print-CSS
  styling, not migrated to app tokens (mirrors the pull-sheet print exception).
- The **new-item page** (`test-and-tag/new/page.tsx`) is a PAGE smart form on the
  shared `SmartFormLayout` shell (`src/components/ui/smart-form.tsx`), modelled on
  `asset-form.tsx`: Identity (bulk/serialized asset `ComboboxPicker` links that
  auto-fill, test-tag `AssetTagInput`, description, make/model) → Test details (the
  test-profile `ComboboxPicker` auto-fills equipment class + appliance type, both now
  overridable via registry `Select` with explicit `SelectValue` children; interval +
  location) → "More details" accordion (notes). Helper rail = contextual tip + a live
  preview card (description, tag, equipment-class chip, retest interval). All auto-fill
  / peek-tag / profile-sync behaviour, the `testTagAssetSchema`, the create action and
  the `testTag:create` gate are unchanged — markup/layout pass only.
- The **batch-create dialog** (`test-tag/batch-create-dialog.tsx`) binds its
  equipment-class / appliance-type registry `Select`s via `Controller` (explicit
  `SelectValue` children, label fallbacks) instead of `form.watch()`/`setValue` in
  render. Behaviour unchanged.

## Reminder digests & scheduler (Phase 6a)

- `sendTestTagReminderDigests()` + `recalculateAllTestTagStatuses()` in
  `src/server/test-tag-reminders.ts` recompute asset statuses (CURRENT/DUE_SOON/
  OVERDUE from `nextDueDate`) then email a per-org digest to admins/owners. The
  digest HTML itself is built by `testTagDigestEmail()` in
  `src/lib/email-templates.ts` (POLICY.md R-8.10.4 — templates live in
  `email-templates.ts`, not hand-built inline in feature code).
- Executor route: `POST /api/cron/test-tag-reminders` (also GET), `Bearer ${CRON_SECRET}`.
- **Scheduler: `convex/crons.ts`** — Convex owns the durable daily schedule;
  `internal.scheduledJobs.runTestTagReminders` invokes the route once/day (22:00 UTC
  ≈ 08:00 AEST). Executor stays in Next because it reads org/member/user (Postgres/
  Better Auth). **Dormant until `ENABLE_CONVEX_CRONS=true`** on the Convex deployment
  (+ `CONVEX_CRON_TARGET_URL` + `CRON_SECRET`); until then the external cron triggers it.
