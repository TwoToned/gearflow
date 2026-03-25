# Test & Tag Module (AS/NZS 3760:2022)

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

## Quick Test Wizard

5-step wizard using `useReducer` pattern at `/test-and-tag/quick-test`:

### Steps
1. **Scan** — Enter test tag ID, loads asset + resolves profile. Handles retired assets (block + reactivate button). Quick Pass pre-fills from last test record.
2. **Visual** — Profile-driven checkbox grid of visual inspection items. "Pass All" button (Ctrl+Shift+P). Auto-calculates visual result.
3. **Electrical** — Profile-driven test inputs (only enabled tests shown). Numeric inputs with unit labels and threshold hints. Auto-evaluates readings.
4. **Sub-Tests** — Only shown if profile `requiresSubTests`. Per-outlet rows with electrical inputs. Add/remove outlets.
5. **Result** — Overall result pill. Breakdown dots. Failure workflow dialog (create maintenance record / mark out of service / retire). Next due date picker. Save & Next / Save & Print Label.

### Session Features
- **Session tester**: Defaults to logged-in user, selectable from org members. Persists across tests in session.
- **Audio feedback**: Beep on save (success/fail tones), toggleable.
- **Session log**: Desktop sidebar / mobile bottom bar showing tested items + results.
- **Keyboard shortcuts**: Ctrl+Enter save, Escape reset to scan.

### Failure Workflow
When overall result is FAIL, a dialog prompts with options:
- Create Maintenance Record → sets `failureAction: REFERRED_TO_ELECTRICIAN`
- Mark Out of Service → sets `failureAction: REMOVED_FROM_SERVICE`, asset status → FAILED
- Retire Asset → sets `failureAction: DISPOSED`, asset status → RETIRED, isActive → false
- Save Without Action → sets `failureAction: NONE`

### Pass/Fail Calculation
Shared utility in `src/lib/test-tag/calculate-result.ts` used by both client (real-time UI) and server (authoritative on save):
- `calculateVisualResult` — all enabled checks must pass
- `calculateElectricalResult` — evaluates readings against thresholds
- `calculateSubTestResult` — per-outlet evaluation
- `calculateOverallResult` — any FAIL → overall FAIL

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
- `/test-and-tag/quick-test` — Quick test wizard
- `/test-and-tag/reports` — 10 report types
- `/settings/test-and-tag/profiles` — Test profile management

## Server Actions
- `src/server/test-tag-assets.ts` — CRUD, batch create, sync, reactivate
- `src/server/test-tag-records.ts` — Test records with sub-tests, session tester, fail workflow, status recalculation
- `src/server/test-tag-profiles.ts` — Profile CRUD, seed defaults, resolve profile cascade, duplicate
- `src/server/test-tag-reports.ts` — Report data + CSV exports (includes sub-test data)

## Auto-Registration
When creating an asset with a model that has `requiresTestAndTag: true`, a `TestTagAsset` record is automatically created. If the model has `defaultTestProfileId`, the asset inherits it.

## Model Integration
Models can set:
- `requiresTestAndTag` — auto-creates TestTagAsset on asset creation
- `testAndTagIntervalDays` — default retest interval
- `defaultEquipmentClass` — equipment class for auto-registered assets
- `defaultApplianceType` — appliance type for auto-registered assets
- `defaultTestProfileId` — test profile inherited by assets
