# Test & Tag Rebuild — AS/NZS 3760:2022 Digital Compliance Platform

> **SHIPPED.** The compliance platform, per-outlet sub-testing, and
> class-based test wizards designed here are all live — see
> [FEATUREDOCS/14-test-and-tag.md](../../../FEATUREDOCS/14-test-and-tag.md).
> Archived here as design rationale.

**Branch:** claude/vigilant-nash
**Mode:** SCOPE EXPANSION
**Date:** 2026-03-25
**Status:** ~~ACTIVE~~ Shipped

## Vision

### 10x Check
A complete digital compliance testing platform for AS/NZS 3760:2022. Tester scans a tag, system shows only relevant tests for that type. Multi-outlet devices get per-outlet sub-testing. Three-phase equipment gets phase-to-phase readings. RCDs get full trip time + current + push-button tests. Routine retesting takes 10 seconds with pre-filled data. Label printing connects digital to physical.

### Platonic Ideal
The tester walks up to an item, scans the tag. The screen instantly shows a clean, focused wizard for exactly that item type. For a 4-port power board, it shows 4 sub-test cards — one per outlet. Every field has pass/fail thresholds from the standard shown inline. Big touch targets for tablet use. Audio feedback. The whole test takes 60 seconds for a routine pass. When done, a label is ready to print and stick on the item.

## Architecture

### System Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                        SETTINGS UI                               │
│  /settings/test-and-tag/profiles                                 │
│  ┌─────────────────┐  ┌──────────────┐  ┌────────────────┐     │
│  │ Profile List     │  │ Profile Edit │  │ Seed/Reset     │     │
│  │ (CRUD + dup)     │  │ (thresholds) │  │ (AS/NZS 3760)  │     │
│  └─────────────────┘  └──────────────┘  └────────────────┘     │
└──────────────────────────────┬──────────────────────────────────┘
                               │ reads
┌──────────────────────────────▼──────────────────────────────────┐
│                      TestProfile (DB)                            │
│  id, orgId, name, equipmentClass, applianceType                  │
│  visualChecks: JSON, electricalTests: JSON, thresholds: JSON     │
│  requiresSubTests: bool, defaultSubTestCount: int                │
│  subTestLabel: string ("Outlet" | "Phase" | custom)              │
│  isDefault: bool, isActive: bool                                 │
└──────────────────────────────┬──────────────────────────────────┘
                               │ matched by class+type
┌──────────────────────────────▼──────────────────────────────────┐
│                     QUICK TEST WIZARD                            │
│  ┌──────┐  ┌─────────┐  ┌────────────┐  ┌──────────┐  ┌─────┐ │
│  │ Scan │→ │ Visual  │→ │ Electrical │→ │Sub-Tests │→ │Save │ │
│  │      │  │(profile)│  │ (profile)  │  │(if req'd)│  │+Lbl │ │
│  └──────┘  └─────────┘  └────────────┘  └──────────┘  └─────┘ │
└──────────────────────────────┬──────────────────────────────────┘
                               │ creates
┌──────────────────────────────▼──────────────────────────────────┐
│                    TestTagRecord (DB)                             │
│  (existing model + testProfileId FK)                             │
│  ┌─────────────────────────────────────┐                        │
│  │ SubTestRecord[] (NEW)               │                        │
│  │ label, sortOrder, result            │                        │
│  │ earth/insulation/leakage readings   │                        │
│  └─────────────────────────────────────┘                        │
└──────────────────────────────┬──────────────────────────────────┘
                               │ feeds
┌──────────────────────────────▼──────────────────────────────────┐
│              REPORTS + LABELS + REMINDERS + AUDITOR              │
│  10 PDF templates (updated for sub-tests)                        │
│  Label template (barcode/QR + test result)                       │
│  Email reminders (DUE_SOON/OVERDUE daily digest)                 │
│  Auditor portal (read-only shareable link)                       │
└─────────────────────────────────────────────────────────────────┘
```

### Data Model Changes

```
NEW MODELS:
  TestProfile         — org-scoped test configuration
  SubTestRecord       — per-outlet/phase electrical readings

MODIFIED MODELS:
  TestTagRecord       + testProfileId (nullable FK)
  TestTagAsset        + testProfileId (nullable FK), + outletCount (nullable int)
  Model               + defaultTestProfileId (nullable FK)

NEW ENUM VALUES:
  ApplianceType       + MICROWAVE
```

## Accepted Scope (16 items)

1. **TestProfile DB model with Settings UI** — CRUD, seed with AS/NZS 3760 defaults, duplicate, custom profiles
2. **Per-model test profile assignment** — Model.defaultTestProfileId, inherited on auto-registration
3. **Profile selection on manual T&T record creation** — prompt user to select profile
4. **SubTestRecord model** — dedicated columns (earth, insulation, leakage readings per outlet/phase)
5. **Multi-step wizard quick-test UI** — scan → visual → electrical → sub-tests → result (useReducer state)
6. **Dynamic sub-test count** — user specifies outlet count, remembered on asset
7. **Three-phase test profiles** — via SubTestRecords (one per phase pair: L1-L2, L2-L3, L1-L3)
8. **Quick Pass speed mode** — pre-fill from last test record for routine retesting
9. **Full RCD test profiles** — trip time, trip current, push-button test
10. **Microwave leakage testing** — MICROWAVE appliance type with radiation threshold
11. **Reports updated for sub-tests** — all relevant PDF templates show per-outlet data
12. **Test tag label printing** — barcode/QR + result + dates after test completion
13. **Auto-increment bug fix** — server-side ID generation, forms don't pre-populate
14. **Retired asset scan blocking** — block with inline "Reactivate & Test" button
15a. **Session tester selection** — defaults to logged-in user, org member picker to test on behalf of another user
15b. **Fail workflow** — on FAIL result, prompt to create a maintenance record and mark asset out of service or retire
15. **Automatic scheduling & email reminders** — DUE_SOON/OVERDUE daily digest via Resend
16. **Auditor portal** — read-only shareable time-limited link for compliance verification

## Key Decisions

- SubTestRecord uses dedicated columns (same pattern as TestTagRecord) — not JSON
- Three-phase readings use SubTestRecords (one per phase pair) — not nullable columns on parent
- Test profiles stored in DB with Settings UI — not hardcoded config
- Per-model profile assignment via Model.defaultTestProfileId FK
- Manual T&T record creation prompts for profile selection
- Retired asset scan → block with inline "Reactivate & Test" button
- Auto-increment fix: server auto-generates IDs, forms don't pre-populate
- Failed test → prompt: create maintenance record + mark OUT_OF_SERVICE or RETIRED

## AS/NZS 3760 Test Profiles (Seed Data)

| Profile Name | Equipment Class | Appliance Type | Earth | Insulation | Leakage | Polarity | RCD | Sub-tests |
|---|---|---|---|---|---|---|---|---|
| Class I Appliance | CLASS_I | APPLIANCE | Yes (<1Ω) | Yes (≥1MΩ) | Optional | No | No | No |
| Class I Cord Set | CLASS_I | CORD_SET | Yes (<1Ω) | Yes (≥1MΩ) | Optional | Yes | No | No |
| Class I Extension Lead | CLASS_I | EXTENSION_LEAD | Yes (<1Ω) | Yes (≥1MΩ) | Optional | Yes | No | No |
| Class I Power Board | CLASS_I | POWER_BOARD | Yes (<1Ω) | Yes (≥1MΩ) | Optional | Yes | No | Yes (outlets) |
| Class II Appliance | CLASS_II | APPLIANCE | No | Yes (≥1MΩ) | Optional | No | No | No |
| Class II Double Insulated | CLASS_II_DI | APPLIANCE | No | Yes (≥2MΩ) | Optional | No | No | No |
| Lead / Cord Assembly | LEAD_CORD | CORD_SET | Yes (<1Ω) | Yes (≥1MΩ) | Optional | Yes | No | No |
| RCD Portable | CLASS_I | RCD_PORTABLE | Yes (<1Ω) | Yes (≥1MΩ) | Optional | No | Yes (≤300ms) | No |
| RCD Fixed | CLASS_I | RCD_FIXED | No | No | No | No | Yes (≤300ms) | No |
| RCD Power Board | CLASS_I | POWER_BOARD | Yes (<1Ω) | Yes (≥1MΩ) | Optional | Yes | Yes (≤300ms) | Yes (outlets) |
| Three-Phase Equipment | CLASS_I | THREE_PHASE | Yes (<1Ω) | Yes (≥1MΩ) | Optional | No | No | Yes (phases) |
| Microwave Oven | CLASS_I | MICROWAVE | Yes (<1Ω) | Yes (≥1MΩ) | Yes (≤5mA) | No | No | No |

## File Map

```
src/
  lib/
    validations/
      test-tag.ts              UPDATE: add profile + sub-test schemas
    test-profiles/
      seed-data.ts             NEW: AS/NZS 3760 default profiles
  server/
    test-tag-assets.ts         UPDATE: fix auto-increment, add profileId
    test-tag-records.ts        UPDATE: create sub-tests in transaction
    test-tag-profiles.ts       NEW: profile CRUD + seed
    test-tag-reminders.ts      NEW: reminder scheduling + email
    test-tag-auditor.ts        NEW: auditor portal token generation
  app/(app)/
    test-and-tag/
      quick-test/
        page.tsx               REWRITE: wizard shell
        components/
          scan-step.tsx        NEW
          visual-step.tsx      NEW
          electrical-step.tsx  NEW
          sub-test-step.tsx    NEW
          result-step.tsx      NEW
          wizard-reducer.ts    NEW
      auditor/
        [token]/
          page.tsx             NEW: read-only auditor view
    settings/
      test-and-tag/
        profiles/
          page.tsx             NEW: profile list + CRUD
  components/
    test-tag/
      test-tag-table.tsx       UPDATE: profile column
      label-template.tsx       NEW: printable label
```

## UI Design Specs

### Design Principles (calibrated to DESIGN.md)
- **Tablet-first** — primary testing device. 44px min touch targets, large inputs.
- **Industrial Calm** — flat form sections, dot+text status, teal accent only
- **Rhythm-optimized** — batch testing 50 items should feel like a flow state
- **Profile-driven rendering** — wizard shows only tests from the matched profile

### Wizard Progress Indicator
Minimal tab style (NOT circle-and-line stepper). Teal underline on active step.
Steps that don't apply to the current profile are hidden entirely.
```
  Scan    Visual    Electrical    Sub-Tests    Result
  ────    ──────    ──────────    ─────────    ──────
                    ▲ active (teal underline, bold)
```

### Wizard Step Layouts

**Session Header** — Tester selector (combobox of org members, defaults to logged-in user). Persists across scans for the entire session. Shows avatar + name.

**Step 1: Scan** — ScanInput (full-width, 48px height, autofocus). After scan: asset info bar (tag ID, description, class, type, status dot, last tested, next due, profile badge). Quick Pass button if previous test exists.

**Step 2: Visual Inspection** — Grid of checkboxes from profile.visualChecks. 3-column desktop, 2-column tablet, 1-column mobile. 44x44px touch targets per checkbox. Pass All button prominent. Visual result dot+text auto-calculated.

**Step 3: Electrical Tests** — Only tests enabled in profile. Each test row: label, number input (48px height, 120px min), unit, threshold hint (fg-3), pass/fail dot. Test method selector if applicable.

**Step 4: Sub-Tests** — Flat rows separated by border (NOT cards). Each row: label ("Outlet 1"), reading inputs, pass/fail dot. [+ Add Outlet] ghost button at bottom. Summary counter: "3/4 PASS".

**Step 5: Result & Save** — Large overall result pill (green/red, semantic bg at 8%). Breakdown: Visual dot, Electrical dot, Sub-tests counter. If FAIL: failure action select + notes textarea + prompt dialog offering: [Create Maintenance Record] (opens maintenance form pre-filled with asset + failure details), [Mark Out of Service], [Retire Asset], or [Save Without Action]. Actions: [Save & Print Label] primary, [Save & Next] secondary.

### Sub-Test Row Layout (Flat, NOT Cards)
```
  Outlet 1    Earth: [____] Ω   Insul: [____] MΩ   ● PASS
  ─────────────────────────────────────────────────────────
  Outlet 2    Earth: [____] Ω   Insul: [____] MΩ   ● PASS
  ─────────────────────────────────────────────────────────
  Outlet 3    Earth: [____] Ω   Insul: [____] MΩ   ● FAIL
```

### Session Log
Desktop: right sidebar (280px). Tablet: bottom bar showing "Session: 3 tested · 2 pass · 1 fail" (tap to expand). Monospace tag IDs, dot+text results, timestamps.

### Profile Settings Page
- Route: `/settings/test-and-tag/profiles`
- Layout: ListPageLayout (PageHeader + DataTable + empty state)
- Profile edit: full page at `/settings/test-and-tag/profiles/[id]` (NOT dialog — too complex)
- Empty state: shield icon (44px teal container) + "No test profiles configured" + [Seed AS/NZS 3760 Defaults] button

### Label Template
- Dimensions: 89mm x 36mm (standard Avery label)
- Layout: QR code (left, 30x30mm) + text block (right): Tag ID (bold), PASS/FAIL, Test date, Next due, Tester, Company
- Print via browser print dialog (CSS @media print)

### Interaction States
| Feature | Loading | Empty | Error | Success | Partial |
|---|---|---|---|---|---|
| Scan/Lookup | Spinner on input | "Scan a tag to begin" | Toast + create-new | Asset info bar | — |
| Visual checks | — | All unchecked | — | All green, "PASS" | Some checked |
| Electrical | — | Empty, thresholds shown | Red dot per test | Green dot per test | Mixed |
| Sub-tests | — | "Set outlet count" | Individual red dots | All green, counter | 2/4 counter |
| Result & Save | Spinner, btns disabled | — | Toast error | Audio beep + toast | — |
| Quick Pass | Loading spinner | "No previous test" | — | "Pre-filled" notice | — |
| Profile list | Skeleton rows | Shield + seed button | Toast | Profile rows | — |
| Retired scan | — | — | Block banner + reactivate btn | Toast "Reactivated" | — |

### Responsive Breakpoints
| Viewport | Wizard | Session Log | Sub-tests | Visual Grid |
|---|---|---|---|---|
| Desktop (≥1024px) | max-w-2xl centered | Right sidebar | 1 row per outlet | 3 columns |
| Tablet (768-1023px) | Full-width | Bottom bar (tap to expand) | 1 row per outlet | 2 columns |
| Mobile (<768px) | Full-width | Collapsed accordion | Stacked per outlet | 1 column |

### Accessibility
- All buttons: min 44px touch target
- Number inputs: `inputmode="decimal"` (no spin buttons on mobile)
- Progress indicator: `role="tablist"` + `aria-selected`
- Pass/Fail dots: `aria-label` includes test name and result
- Overall result: `role="alert"` for screen reader announcement
- Keyboard: Tab follows step order, Ctrl+Enter saves, Ctrl+Shift+P passes all visual, Escape → scan

## NOT in Scope

- **Offline mode** — user skipped. Service worker + IndexedDB + sync conflict resolution.
- **Mobile-native app** — responsive web sufficient
- **Bluetooth PAT tester integration** — hardware integration
- **Multi-org profile sharing** — profiles are per-org

## Migration Strategy

All migrations are additive (new tables, nullable columns, new enum values). Zero-downtime compatible.

1. Add TestProfile model with indexes
2. Add SubTestRecord model with FK to TestTagRecord
3. Add nullable testProfileId FK to TestTagRecord, TestTagAsset, Model
4. Add nullable outletCount int to TestTagAsset
5. Add MICROWAVE to ApplianceType enum
