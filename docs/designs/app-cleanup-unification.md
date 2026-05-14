<!-- /autoplan restore point: /Users/jayden/.gstack/projects/TwoToned-gearflow/claude-strange-chebyshev-58d336-autoplan-restore-20260514-090134.md -->
<!-- STATUS: APPROVED 2026-05-14 — paused before execution, awaiting usage reset -->
<!-- Next step on resume: begin Wave 1 day 0 (env validation → Sentry → BulkAsset reconcile script → shared inventory mutation helper → kit fix → maintenance fix → T&T enforcement) -->
# GearFlow — App-Wide Cleanup, Unification & Feature-Completeness Audit

**Branch:** `claude/strange-chebyshev-58d336`
**Created:** 2026-05-14
**Source:** /autoplan request — "I want to do a clean up and unification of the app. go through with a fine tooth comb. review all features and make sure everything is functional. make sure everything works together and nothing has been forgotten. Let me know if there are any missing features that should be implemented. dream big, i want this to be the most feature-full, bug free rental management system. Pay close attention to projects, and finances."

---

## Intent

GearFlow is a rental management SaaS for AV/Theatre (Two Toned Productions). Phase 1–6 + User Management are marked COMPLETE in memory. The user wants the v2 polish pass: every feature works, every feature connects to every other feature, nothing is forgotten, and the obvious feature gaps are filled.

**Two focal areas the user named:**
1. **Projects** — the central booking/quoting/dispatch entity that ties everything together
2. **Finances** — quotes → invoices → payments → reporting, plus pricing across line items and kits

**Dream big** — the user explicitly invited scope expansion where it makes the product better.

---

## What "audit" means here

A fine-tooth-comb sweep across every module, looking for:
- **Bugs** — broken flows, race conditions, missing validation, server-action footguns
- **Gaps** — features that exist but are half-finished, or pages that aren't wired into navigation
- **Disconnects** — module A doesn't talk to module B when it should (e.g. project finance doesn't reflect maintenance costs)
- **Inconsistencies** — DESIGN.md violations, naming drift, two ways to do the same thing
- **Missing features** — competitive-table items absent from this product
- **Performance** — slow pages, N+1 queries, missing indexes
- **DX/UX** — error messages, empty states, loading states, mobile experience
- **Permissions** — actions that bypass `requirePermission`, audit log gaps
- **Test coverage** — flows with no automated coverage that should have it

---

## Initial codebase inventory (to be filled by audit agents)

> Populated by Phase 0 audit agents — see Audit Findings section below.

### Module inventory
- (pending)

### Existing FEATUREDOCS coverage
- (pending)

### Existing tests
- (pending)

---

## Audit Findings — Consolidated from 4 parallel explore agents

> This is the rough plan content the CEO / Design / Eng reviews will critique.
> Severity tags: [CRITICAL] / [HIGH] / [MED] / [LOW]

---

### A. Projects & Finances — the user's named priority

#### Bugs (concrete)
- [CRITICAL] **No Invoice model. No Payment model. No Quote model.** "Invoices" are PDFs generated on-demand from project state. `Project.invoicedTotal` is a single denormalized field. No payment reconciliation, no partial payments, no payment history, no Stripe.
- [HIGH] **Sub-hire costs deducted from project margin but never flow to supplier AP.** `SubHire.paymentStatus` is metadata only — no `SupplierInvoice` / payable tracking, no aging, no supplier balance.
- [HIGH] **Maintenance & damage costs never flow into project P&L.** `MaintenanceRecord.cost` exists; `ProjectLineItem.returnCondition=DAMAGED` exists; neither is attributed back to the project that incurred it.
- [HIGH] **Crew timesheets don't bill projects.** `CrewAssignment.estimatedCost` is hardcoded. `CrewTimeEntry` exists but doesn't post to project totals.
- [HIGH] **Two parallel sub-hire systems.** Legacy `ProjectLineItem.isSubhire` boolean co-exists with the new `SubHire` entity. Both UX entry points visible. No migration path.
- [MED] `getProjectIssueFlags` does not filter `isTemplate: false` — templates can show up in availability issues.
- [MED] Custom items not filtered by `isOptional` in `recalculateProjectTotals` — optional customs inflate revenue.

#### Gaps (incomplete or absent first-class flows)
- [CRITICAL] **Quote acceptance workflow.** No `Quote.expiryDate / acceptedAt / acceptedBy`. No e-signature. No client-portal sign-off. Project transitions to CONFIRMED arbitrarily.
- [CRITICAL] **Payment tracking.** No `Invoice / Payment / CreditNote` models. No partial payments, no late fees, no scheduled invoicing, no deposits despite `depositPercent / depositPaid` fields existing unused.
- [HIGH] **Tax handling.** Single org-level rate. No per-line-item rate, no GST-exempt indicator, no tax categories by jurisdiction, no flat-fee taxes.
- [HIGH] **Discount handling.** Project-level percent only. No line-level discounts, no codes/promotions, no tiered/volume.
- [MED] **Recurring projects.** Templates are static dupes. No date-offset recurring generator.
- [MED] **Custom item library.** No autocomplete from past custom items, no "promote to inventory."
- [LOW] **Multi-currency.** Hardcoded AUD assumption in formatters.

#### Disconnects (module A ↛ module B)
- [CRITICAL] Maintenance → project P&L
- [CRITICAL] Sub-hires → supplier AP ledger
- [HIGH] Crew time → project billing
- [HIGH] Warehouse damage at checkin → client cost-back / charge-fee line item
- [MED] Project `tags` field exists but is unused (no filter, no search, no UI)
- [MED] Notifications missing: quote viewed, invoice overdue, project status change

#### Missing features ("dream big" for projects + finances)
- E-signature / formal quote acceptance
- Stripe / payment gateway, payment links, hosted checkout
- Customer portal (clients see their own projects/quotes/invoices)
- BI dashboard (revenue by category, profitability by project type, crew utilization)
- Automated reminder cadence (overdue invoices, expiring quotes)
- AI-assisted pricing (margin-aware suggestions, see TODOS.md)
- Route optimization for deliveries
- Credit notes & refunds

---

### B. Catalog, Warehouse, Kits, Preps, Maintenance, Test & Tag

#### Bugs
- [CRITICAL] **`checkOutKit` / `checkInKit` don't update `BulkAsset.availableQuantity`** for bulk items inside the kit. Availability calc will over-permit future bookings. `warehouse.ts:615–736`.
- [CRITICAL] **`createMaintenanceRecord` and `updateMaintenanceRecord` are not transactional.** Asset status `updateMany` calls run outside a `prisma.$transaction()`. A failure leaves the record without status sync. `maintenance.ts:101–141, 158–234`.
- [HIGH] **Maintenance asset-removal bug.** If assets are removed from a record but no new ones added, the removed assets remain `IN_MAINTENANCE` forever. `maintenance.ts:210–233`.
- [HIGH] **T&T `FAILED` / `OVERDUE` does NOT block checkout.** `lookupAssetForScan` doesn't query `TestTagAsset` status. Compliance risk per AS/NZS 3760:2022.
- [MED] Availability calc doesn't explicitly exclude kit children (`parentLineItemId === null` not asserted), works only because nested kits have no `modelId`.
- [MED] Asset tag form pre-fill via `peekNextAssetTags` is stale under concurrent creates; users may override to a duplicate.
- [LOW] Photo cascade deletes `AssetMedia` rows but leaves S3 files orphaned forever.

#### Gaps
- [CRITICAL] **No stocktake / inventory audit feature.** (`feat/stocktake` exists in another worktree but is not merged.)
- [HIGH] **No cross-warehouse transfers.** Assets have one `locationId`; no transfer model, no history.
- [HIGH] **No asset history / lifetime ROI.** No revenue-per-asset, no utilization rate, no maintenance cost per asset, no depreciation/book value.
- [HIGH] **No damage report at checkin.** Condition flag exists; no photos, severity, charge-back to client, repair queue.
- [MED] **No reorder points / low-stock alerts** beyond the basic `LOW_STOCK` bulk status (which is computed but not configurable per item).
- [MED] **Calibration / certification tracking** beyond Test & Tag — no audio analyzer, projector lens, frequency coordination certs.
- [LOW] Consumables tracking (gels, gaff, batteries) — bulk-asset workaround; no burn-rate metrics.

#### Disconnects
- [HIGH] Asset `IN_MAINTENANCE` excluded from `effectiveStock` ✓ but warehouse `lookupAssetForScan` blocks only `RETIRED / LOST` — staff can scan a maintenance asset and check it out.
- [HIGH] T&T FAILED/OVERDUE not blocked at checkout (see Bugs).
- [HIGH] **Warehouse close flagged items → no auto-create of `MaintenanceRecord`, no charge-back line item, no repair queue.**
- [MED] Prep-kits vs formal kits use the same `Kit` model with `isPrep: true` — terminology and behavior conflated.

#### Inconsistencies
- [MED] Two deletion patterns (DropdownMenu confirm vs Dialog confirm). DESIGN.md says no AlertDialog.
- [MED] Mobile vs desktop warehouse divergence — ad-hoc `isMobile` branches, no `useMobileLayout` hook.
- [LOW] Three asset-selection UIs (table picker, scan, autocomplete).

#### Missing features ("dream big")
- Workshop / repair queue with status (In For Repair → Awaiting Parts → Ready → QA → Back in stock)
- RFID instead of barcodes
- Vehicle assignment + route optimization + fuel/mileage logs
- 3D model catalog (visual quotes)
- Stage-plot / venue load-in integration
- Predictive maintenance from check history
- Reservation conflict resolution UI (swap proposals, alternative suggestions)

---

### C. Cross-cutting — DESIGN.md, auth, permissions, integration checklist, dead code

#### Permissions & audit-log gaps
- [CRITICAL] **`requirePermission` missing on reads** in `group-templates.ts` (`getGroupTemplates`), `crew.ts` (`getCrewMembers`, `getCrewMemberById`), `check-items.ts` (`getCheckItems`).
- [CRITICAL] **`logActivity` missing on writes** in `group-templates.ts` (0 calls — 6 write functions). `check-items.ts` partial coverage.
- [HIGH] Custom-role SSO group claim (`CustomRole.ssoGroupClaim`) defined but no settings UI to set/view it. Unverified end-to-end.
- [MED] "staff" role has identical permissions to "member" — redundant; one is legacy.

#### Integration Checklist drift (compare to `FEATUREDOCS/29`)
| Feature | Sidebar | Search | Activity | Notif | Export | Org Transfer |
|---|---|---|---|---|---|---|
| **groupTemplate** | ❌ buried | ❌ missing | ❌ none | ❌ none | ❌ no CSV | ❌ likely no |
| **checkItem** | ❌ hidden | ⚠ partial | ⚠ partial | ❌ none | ❌ no CSV | ❌ not in org-export |
| **crew** (full module) | ✓ | ✓ | ✓ | ⚠ partial | ? | ❌ **not in org-export** |
| **subHire** | ⚠ buried | ❌ missing | ⚠ partial | ❌ none | ❌ no | ? |

- [CRITICAL] `crew*` tables NOT in `src/lib/org-export.ts` — full crew dataset is lost on org export/import.
- [CRITICAL] `checkItem` and `checkRecord` NOT in `org-export.ts` — quality-check history lost on transfer.
- [HIGH] `groupTemplate` not in `search.ts` — users can't find templates via command palette / global search.
- [MED] `subHire` not in `search.ts`.

#### Search / Notification / Activity coverage gaps
- Search: missing `groupTemplate`, `subHire`, `crewRole`, `crewSkill`, `crewCertification`, `checkRecord`, `savedReport`.
- Notifications: types defined but no query code for `expiring_cert`, `pending_offers`, `pending_timesheets`, `flagged_asset` (per cross-cutting agent — confirm against fourth agent's finding that they DO exist; reconcile in eng phase).
- Activity log: 245 `logActivity` references but `groupTemplate` writes have zero.

#### Orphaned routes & dead code
- [MED] `/check/[assetTag]` exists but has no sidebar entry (warehouse scan flow — intentional or buried?).
- [MED] `/settings/check-items` and `/settings/group-templates` not linked from `/settings` page nor sidebar.
- [LOW] `rolePermissions["staff"]` identical to `["member"]` — confirm or consolidate.

#### DESIGN.md violations
- [LOW] Sidebar version badge uses `text-sm font-medium` and `text-[13px]` — should standardize on the `t-micro / t-body / t-label` scale.
- [MED] Quick-create button missing inset highlight pattern (DESIGN.md line 197).
- Other components likely have similar drift — only spot-checked.

#### Naming drift
- [MED] Status enum casing varies: project status mixes `CHECKED_OUT | ON_SITE | PENDING | QUOTE`; maintenance status is `SCHEDULED | IN_PROGRESS | COMPLETED`; line-item status mixes again.
- [MED] Two filtering patterns: `buildFilterWhere()` utility vs inline filter logic.

---

### D. Settings, Reports, Documents, Notifications, Crew, WooCommerce, Testing, DX

#### Settings & SaaS-foundation
- [CRITICAL] **No real billing/subscription system.** `/settings/billing` only has currency/tax fields. No `Organization.stripeCustomerId / subscriptionStatus / pricingTier`, no payment methods, no usage limits, no plan tiers, no invoice management for the *platform itself*. This is a SaaS-blocker.
- [HIGH] No "deactivate user" (only delete or leave dangling). No "transfer org ownership."
- [HIGH] No business-hours setting, no default email templates per org, no default T&Cs.
- [MED] No per-user persistent notification preferences (in-app only via localStorage dismissal).

#### Reports
- ~30 pre-built reports + custom builder both work ✓
- PDF + CSV export ✓
- [HIGH] **No scheduled reports / email delivery.** `SavedReport.lastRunAt` exists; no `scheduleFrequency / recipients`.
- [MED] No XLSX export.
- [MED] No drill-down from chart/table into detail views.
- [MED] No per-user view preferences on a report.

#### Documents / PDFs
- 6 doc types generate ✓; brand templates editor with live preview ✓
- [HIGH] **No email delivery flow.** Download-only. No "Email to client" action on documents.
- [HIGH] **No i18n.** Hardcoded English labels in pdfme plugins.
- [MED] No template version history / rollback.
- [MED] No status-driven template selection (deposit invoice vs final invoice).

#### Maintenance
- [HIGH] **No photo attachments on `MaintenanceRecord`.** Crew check system supports photos; maintenance doesn't reuse it.
- [HIGH] **No auto-scheduling of preventive maintenance.** `nextDueDate` field exists; no recurring generator.
- [MED] Costs not rolled up to project (echoes A-section finding).
- [MED] No parts inventory link.

#### Notifications
- 9 notification types defined; all 9 wired (reconciles cross-cutting agent's miscount)
- [HIGH] **In-app only — no email delivery.** Users miss alerts unless app is open.
- [MED] Dismissal in localStorage only — clear browser, lose dismissal state. No persistent read flag in DB.
- [MED] No bulk actions (mark all read, dismiss all).
- [HIGH] No quiet hours / DnD per user.

#### Crew
- Full lifecycle solid ✓; iCal export ✓; conflict detection ✓; time entries + offer flow ✓
- [MED] Minimal self-service crew portal — no "view my offers / log time / accept assignment" surface.

#### WooCommerce integration
- HMAC-verified webhook ✓; client/product matching ✓; idempotency ✓
- [MED] Order-log captures status but no exception stack traces — hard to debug failures.

#### Testing
- 95 `.test.ts` unit files; ~70% coverage threshold ✓
- Zero `// @ts-ignore` in codebase ✓
- [CRITICAL] **Zero integration tests on 53 server-action files (~19k LOC).**
- [CRITICAL] **Zero E2E tests.** Playwright scaffolded; `e2e/` dir doesn't exist.
- [HIGH] No component tests (123 component files, 0 RTL coverage).
- [HIGH] No test-DB setup / fixture strategy.
- [MED] Lint not in CI; 135 `// eslint-disable` directives backlog.

#### Developer Experience
- [HIGH] **No structured logging / observability.** No Sentry, no pino, no LogRocket. Errors `throw`'d and lost.
- [HIGH] **No env-var validation at boot.** Silent failures if DATABASE_URL is missing.
- [HIGH] **No feature flags.** No gradual rollout, no killswitch.
- [MED] Missing scripts: `db:seed`, `db:reset`, `db:studio`, `format`, `type-check`.

#### CSV import/export coverage
| Entity | Export | Import |
|---|---|---|
| Models | ✓ | ✓ |
| Assets (serialized) | ✓ | ✓ |
| Bulk Assets | ✓ | ❌ |
| Projects | ❌ | ❌ |
| Clients | ❌ | ❌ |
| Kits | ❌ | ❌ |

---

### E. Cross-cutting "dream big" backlog

Themes:
- **Customer-facing**: client portal (read-only quotes/invoices/projects), public booking widget, e-signature on quotes
- **Comms**: email notifications, SMS via Twilio, two-way email integration, calendar sync (iCal/Google/Outlook)
- **Platform**: public API + keys, outbound webhooks, feature flags, custom fields per entity (no migration), multi-language UI
- **Observability**: Sentry, env validation, system status page, audit-trail visualization UI on top of `ActivityLog`
- **Ops**: scheduled reports, document email delivery, automated invoice reminder cadence, backup/restore per org, GDPR data export
- **Collaboration**: comments + @mentions on projects/assets, real-time presence ("Jayden is viewing this project"), in-app onboarding tour
- **Polish**: bulk operations consistent across all list pages, saved filters per entity, print-friendly pages on every page, full keyboard nav, dark mode polish

---

# Wave 2 — User-flagged Fine-Tooth-Comb Items (added 2026-05-14)

The user explicitly added three items after seeing the plan. These belong to Wave 2 (audit cleanup) and are first-class scope, not nice-to-haves.

## 2.A. Error UX — every error shows CONTEXT, not raw exceptions

**Stated intent (user):** "When things error, like adding a project with a code that already exists, it should show the user the context, not just a random error. Remember fine tooth comb, make sure no random errors — everything should be wired together."

**Diagnosis:** Server actions currently throw `new Error("...")` with messages that may or may not surface as user-readable strings. React Query's onError handler then displays the message in a toast. Result is inconsistent: some errors are clear ("Project code 'ABC' already exists"), most are generic ("An error occurred" or untranslated Prisma errors like `Unique constraint failed on the fields: (\`code\`)`).

**Required pattern (Wave 2):**

1. **Define a `UserFacingError` class** in `src/lib/errors.ts` with structured fields:
   ```ts
   class UserFacingError extends Error {
     constructor(
       public title: string,           // "Project code already in use"
       public detail: string,           // "The code 'ABC-2026' is already used by project 'Spring Tour 2026'"
       public action?: { label: string; href?: string },  // optional CTA: "View existing project"
       public field?: string,           // optional form field to highlight
     )
   }
   ```

2. **Translate Prisma errors at the server-action boundary.** Every server action `try/catch`es around its core logic and converts:
   - `P2002` unique-constraint → `UserFacingError("...already in use", "...used by...", action: "View existing", field: "code")`
   - `P2003` foreign-key → `UserFacingError("Cannot delete — still referenced", "X uses this Y", action: "Remove the references first")`
   - `P2025` record-not-found → `UserFacingError("Not found", "The X you tried to update no longer exists")`
   - Permission denied → `UserFacingError("Not allowed", "Your role doesn't have permission to do this; ask an admin")`
   - Org-scope mismatch (multi-tenancy) → log + 404 (don't leak existence)

3. **Client side: `useMutation` `onError` handler** in `src/lib/error-toast.ts`:
   - If error is `UserFacingError` (shape-detected from serialized response): render structured toast with title + detail + optional action button + optional field highlight on the form
   - If error is anything else: log to Sentry + show "Something went wrong" toast with a "Report" button — but ALSO log enough context to triage
   - Form-level field errors set via RHF `setError(field, { message: error.detail })`

4. **Specific error contexts to wire (concrete checklist, generated from server-action audit):**
   - Project: duplicate code, duplicate name within org, missing client, missing dates, end-before-start
   - Asset: duplicate asset tag, duplicate serial number within model, T&T-block at checkout (show test status + next-due), maintenance-block at checkout
   - Kit: duplicate kit tag, member-scan-instead-of-kit (already friendly — keep), nested-circular reference
   - Bulk asset: insufficient quantity for checkout (show requested vs available, link to availability calendar)
   - Sub-hire: supplier not found, item quantity exceeds order, payment-status transition invalid
   - Crew: assignment conflict (show conflicting project + dates), time entry overlap, certification expired (show cert + expiry date)
   - Maintenance: cannot start maintenance on already-IN_MAINTENANCE asset (show existing record + link)
   - Check items: cannot delete check item used in N templates (show usage)
   - Group template: cannot delete used in N projects (show usage)
   - Settings: SSO config invalid (show provider field + remediation), branding upload too large
   - Org transfer: import schema mismatch (show diff + manifest version), file format invalid

5. **Eng spec:**
   - All 66 server actions in `src/server/*.ts` get a try-catch wrapping the main logic
   - Server actions return `{ data?, error? }` shape (or throw `UserFacingError` — pick one and apply uniformly; recommend throw + Next.js server-action error serialization)
   - The AST scanner (from multi-tenancy sweep) gets a second check: every `throw new Error(...)` in `src/server/*.ts` is flagged unless paired with `UserFacingError`
   - Tests: every Prisma-error code we map has at least one regression test (insert duplicate, assert UserFacingError shape)

**Definition of done:** A user can hit any error in the app and see a sentence that tells them (a) what went wrong, (b) what context they need to fix it, and where useful (c) a button or link to resolve. No `[object Object]`, no raw Prisma stack, no "An unknown error occurred."

**Estimated effort:** 1 week CC. Touches every server action but the per-action change is small (10-line wrap + map specific Prisma codes).

---

## 2.B. Custom line items — prices must be settable

**Stated intent (user):** "Make sure prices can be set for custom items."

**Diagnosis from audit:** `addCustomLineItem` exists (server action added in commit 1035ba0, dialog in 8a5c466) and creates a `ProjectLineItem` with `isCustomItem: true`. Audit Section A flagged: *"Custom items not filtered by `isOptional` in `recalculateProjectTotals` — optional customs inflate revenue."* The pricing-fields question is adjacent: the custom-item form may not expose `unitPrice`, `quantity`, or daily/weekly/monthly rates the way regular line items do, OR it may save them but not roll them up correctly.

**Wave 2 work:**

1. **Audit `customLineItemSchema`** (`src/lib/validations/line-item.ts`): confirm fields exist for `unitPrice`, `quantity`, `dailyRate`/`weeklyRate`/`monthlyRate` (or whatever pricing-optimization expects), `taxRate` override, `discount` override, `isOptional`, `description`. If any are missing, add to schema + form.

2. **Confirm `CustomLineItemDialog`** exposes:
   - `description` (required, free text)
   - `category` placement (already added in commit c2f7162)
   - `quantity` (numeric)
   - **`unitPrice` (REQUIRED — currently the gap)**
   - **`dailyRate` / `weeklyRate` / `monthlyRate` (optional, for items billed by duration)**
   - `taxRate` override (optional, inherits project default)
   - `discount` override (optional)
   - `isOptional` flag

3. **Confirm `addCustomLineItem` server action** writes all these fields onto the created `ProjectLineItem` row (the model already supports them since custom items are stored as regular `ProjectLineItem`s).

4. **Confirm `recalculateProjectTotals`** includes custom items in the equipment revenue line (verified — they're picked up via `groupId: null, isKitChild: false`), **AND filters by `isOptional: false`** (audit-flagged bug — fix in Wave 2).

5. **Confirm pricing-optimization picks up custom items** if user supplies rates. If custom items are excluded from min-cost rate selection by design, document it; otherwise wire them through.

6. **PDF rendering:** verify custom items show price columns on quote/invoice/delivery-docket PDFs (delivery docket is the client-facing one — must be right).

7. **CSV export:** custom items appear in line-items export.

8. **Test:** Add custom item with each pricing field combination → confirm appears on PDF + project totals + reports.

**Estimated effort:** ~2 hours CC if schema + dialog have all fields wired (mostly verification); ~1 day CC if pricing fields are genuinely absent and need addition.

---

## 2.C. Project page — TOTAL column shows the rolled-up job total

**Stated intent (user):** "In the project page the job total from services and items and such should be shown in the total column, right now it isnt."

**Diagnosis:** This appears to be about the **projects list page** (`src/app/(app)/projects/page.tsx` and `src/components/projects/project-table.tsx`), where the table has a Total column. Today that column likely shows `Project.equipmentTotal` or similar denormalized field, NOT the full rolled-up job total (`equipmentTotal + serviceCostTotal + labourCostTotal + subHireCostTotal + adjustments − discount + tax`).

**Wave 2 work:**

1. **Locate the column.** Check `src/components/projects/project-table.tsx` (or `project-list-table.tsx`). Identify which field the Total column currently reads.

2. **Define the canonical "Job Total" computation.** Per `recalculateProjectTotals` in `src/server/line-items.ts:540`:
   ```
   JobTotal = equipmentTotal
            + serviceCostTotal     (internal labour, delivery services)
            + labourCostTotal      (crew assignments — estimated)
            + subHireCostTotal     (third-party gear)
            + adjustmentsTotal     (manual adjustments if any)
            − discountAmount        (project-level discount applied)
            + taxAmount            (computed from taxable subtotal × taxRate)
   ```
   Confirm this matches what `recalculateProjectTotals` writes to `Project.total` (or whatever the final denormalized field is). If `Project.total` is correct → just point the column at it. If it doesn't exist → add it to the recalc.

3. **Update the table column** to read the job total field.

4. **Format consistently:** currency formatter, AUD by default (per organization settings), aligned right.

5. **Confirm sort works** on the new column — Prisma sort needs to reference the actual DB field.

6. **Confirm filter still works** — if there's a "total > X" filter, point it at the same field.

7. **Verify everywhere else the "project total" is shown** (project detail, dashboard widgets, reports) uses the same canonical computation — no drift between list view, detail page, and reports.

8. **Adjacent fixes to bundle (cheap wins):**
   - Operational P&L "right rail" view (separate scope, Wave 2 — see Design phase synthesis) should use the SAME canonical numbers — single source of truth
   - Reports that show "project total" use the same field — audit `src/server/reports.ts` for any that compute differently

**Estimated effort:** ~3 hours CC if `Project.total` already exists and recalc is correct; ~1 day CC if recalc needs to be extended to include adjustments + crew labour properly.

---

## 2.D. QR / Barcode scanner — full refresh

**Stated intent (user):** "A full refresh of the QR code scanner. It should work for QR Code, Mini QR, Barcodes. Should be able to choose what camera is being used, and make sure the whole image is looking for the QR code and that autofocus and everything is working — I have had issues on my iPhone scanning stuff. Ensure the scanner is properly implemented into all features (checks etc)."

**Current state (grounded):**
- Library: `html5-qrcode` v2.3.8
- Two components: `src/components/ui/scan-input.tsx`, `src/components/ui/barcode-scanner.tsx`
- 15+ consumers: warehouse pick-prep tab, warehouse return tab, kit form, kit detail, maintenance form, asset form, bulk asset form, asset QR display, test-and-tag new + quick-test, mobile nav, warehouse main page, warehouse `[projectId]` page
- Known issues (user-reported): unreliable on iPhone, scan box doesn't cover full frame, no camera picker, autofocus unclear

### Required capabilities (Wave 2 spec)

**Format support:**
- QR Code (standard)
- **Micro QR (M1-M4)** — common on smaller labels
- Code 128 (most warehouse barcodes)
- Code 39 (industrial, AS/NZS labels)
- EAN-8 / EAN-13 (retail products)
- UPC-A / UPC-E (US retail)
- ITF-14 / Interleaved 2 of 5 (shipping cartons)
- Data Matrix (component-level)
- PDF417 (long-form barcodes, sometimes on driver licenses)
- Aztec (transport tickets — rare in our domain but cheap to enable)

Decision (auto-decided per P3): **stay on `html5-qrcode`** for now (it's already integrated, supports all the above via the bundled zxing). If iOS reliability remains poor after the refresh, the fallback is **native `BarcodeDetector` API** where available (Chrome, Edge, Safari 17+ partial) with html5-qrcode as universal fallback. Don't migrate to `@zxing/browser` directly — same engine, more rewriting.

**Camera selection:**
- Enumerate via `navigator.mediaDevices.enumerateDevices()` → filter `videoinput`
- Persist last-selected camera per device in `localStorage` (`scanner.preferredCameraId`)
- Default heuristic on first use: prefer "back"/"rear"/"environment" label substring on mobile; fall back to first available on desktop
- Camera picker UI: dropdown in the scanner component header, switches device without remounting the video stream
- Show camera label + a tiny pill ("Rear / Wide" etc.)

**Full-image scanning:**
- Current `html5-qrcode` `Html5QrcodeScanner` defaults to a centered `qrbox`. Switch to **full-viewfinder scanning** via `Html5Qrcode` (the lower-level API) with `qrbox: undefined`. The whole video frame is scanned each tick.
- Visual hint overlay: a faint corner-bracket indicator at the center for user aiming, but scanning is NOT bounded to that area
- Scan rate: default 10fps is fine for QR; bump to 15fps for harder targets

**Autofocus + iOS specifics:**
- Pass `MediaTrackConstraints` with `focusMode: "continuous"` (where supported)
- iOS Safari requires `playsInline` on the video element (verify scanner has this)
- iOS requires user-gesture-triggered camera permission — confirm the scan button doesn't accidentally auto-request before user click
- Add `torch` (flashlight) toggle on supported devices — huge UX win in dim warehouses
- Add **zoom slider** on supported devices (`MediaTrackCapabilities.zoom`) — iPhone 13+ supports it and makes Mini QR codes readable that otherwise aren't
- Add **macro-mode hint** on iPhone — iPhone 13 Pro+ has macro mode but it doesn't always activate. Document the workaround (tap-to-focus pattern).

**Performance:**
- Worker-based decoding (html5-qrcode supports it via Web Worker option) to keep UI thread responsive
- Frame skipping when document is hidden (visibilitychange listener)
- Cleanup: properly stop the stream + revoke MediaStream tracks on unmount (verify current code — likely the source of "scanner won't stop" or "camera light stays on" complaints)

**Error UX (ties into section 2.A):**
- "Camera permission denied" → toast with instructions to enable in Settings → link to docs/help
- "No camera found" → clear message with retry button
- "Scan failed / unreadable" after N seconds → suggestion to clean the label, adjust angle, increase light, use torch
- "Multiple QR codes detected in frame" → pick the largest / center-most, log the others
- Vibration on successful scan (mobile) via `navigator.vibrate(50)`
- Audio beep on success (toggleable in user prefs)

### Coverage audit — every place scanner is used

For each consumer page, verify the refreshed component:

| Location | File | Purpose | Notes |
|---|---|---|---|
| Warehouse pick-prep | `pick-prep-tab.tsx` | Scan to add asset to prep | Critical path |
| Warehouse return | `return-tab.tsx` | Scan to check in | Critical path |
| Warehouse `[projectId]` page | `warehouse/[projectId]/page.tsx` | Top-level scan input | Persistent sticky scan |
| Warehouse main page | `warehouse/page.tsx` | Project lookup by scan? | Verify intent |
| Kit form | `kit-form.tsx` | Scan to add asset to kit | |
| Kit detail page | `kits/[id]/page.tsx` | Scan to verify members | |
| Maintenance form | `maintenance-form.tsx` | Scan to add asset to record | |
| Asset form | `asset-form.tsx` | Scan asset tag during create | |
| Bulk asset form | `bulk-asset-form.tsx` | Scan bulk barcode | |
| Test & Tag new | `test-and-tag/new/page.tsx` | Scan to start new test | |
| Test & Tag quick-test | `test-and-tag/quick-test/scan-step.tsx` | Scan for re-test cycle | |
| Mobile nav | `mobile-nav.tsx` | Global scan shortcut from any page | |
| **Check items (NEW — user explicit)** | `src/app/(app)/check/[assetTag]/` and `check-records.ts` | Scan to find/start a check record | Verify the entry point exists and is wired |

For each: confirm the refreshed scanner is used (single source — no per-page bespoke implementation), confirm error states render via `UserFacingError` toasts, confirm camera picker + torch + zoom are all available.

### "Check items" specific wiring (the user named this)

The `/check/[assetTag]` route exists but is hidden from the sidebar (per cross-cutting audit). Verify:
1. Scanning a barcode from anywhere (mobile nav, warehouse) when in "check" mode routes to `/check/[assetTag]` with the scanned tag
2. The check flow itself uses the refreshed scanner for any in-flow scans (sub-scanning components, attached assets, etc.)
3. The "scan to find existing check record" flow works end-to-end

### Eng spec

1. **Refactor `scan-input.tsx` + `barcode-scanner.tsx`** into a single `Scanner` primitive component with props:
   ```ts
   <Scanner
     formats={["QR_CODE", "MICRO_QR_CODE", "CODE_128", "CODE_39", "EAN_13", "UPC_A", "DATA_MATRIX", "ITF", "PDF_417", "AZTEC"]}
     onDetect={(result) => ...}
     onError={(error) => ...}      // UserFacingError-compatible
     mode="continuous" | "single"
     showCameraPicker={true}
     showTorch={true}
     showZoom={true}
     hapticFeedback={true}
     soundFeedback={true}
     defaultCameraPreference="environment"
   />
   ```
2. **Keep `scan-input.tsx`** as a higher-level wrapper that combines the `Scanner` with a manual-entry input (`<input type="text">`) for power users — type the tag if scanning fails
3. **Remove** `barcode-scanner.tsx` as a separate component once all consumers use `Scanner`
4. **Add a Scanner playground page** at `/admin/scanner-test` for diagnosing iPhone-specific issues — shows live frames, FPS, last 5 detection attempts, raw decode results, MediaTrackSettings for the active camera
5. **Persist user prefs** in `localStorage` (camera ID, torch on/off, sound on/off) and respect them on every scanner mount

### Testing

- **Manual cross-device matrix** (Wave 2 acceptance test):
  - iPhone 12+ (Safari)
  - iPhone Pro models with macro (verify Mini QR readability)
  - Android Chrome
  - Desktop Chrome with USB barcode gun emulating keyboard input — must still work via `scan-input.tsx` text fallback
  - Desktop Safari (laptop camera)
- **Unit tests** on the `Scanner` props/state machine
- **No E2E for camera** — Playwright can't easily simulate camera, but it can test the manual-entry fallback in `scan-input.tsx`

### Estimated effort

**~1 week CC** — bulk of the work is the single `Scanner` primitive + the consumer-page refactor pass (15+ files, mostly mechanical). Camera picker + torch + zoom + autofocus tuning is concentrated in the primitive. iPhone reliability tuning is iterative — the diagnostic playground page makes that loop fast.

### Definition of done

- One `Scanner` primitive, used everywhere
- Camera picker visible, persisted, working on iOS + Android + desktop
- Torch + zoom + autofocus all wired and working on iPhone
- Whole-frame scanning (no centered qrbox)
- Mini QR + all listed barcode formats decode correctly
- All 15+ consumer pages use the refreshed component
- Check-items flow wired to the scanner end-to-end
- Diagnostic playground page exists at `/admin/scanner-test`
- iPhone scans Mini QR codes that Two Toned currently can't scan

---

# PHASE 3 — Engineering Review

## Eng Dual Voices — Consensus

```
═══════════════════════════════════════════════════════════════════════════════
  Dimension                                Claude        Codex         Consensus
  ──────────────────────────────────────── ────────────  ────────────  ──────────
  1. Wave 1 bug-fix sufficiency            under-spec    under-spec    CONFIRMED (need more)
  2. Multi-tenancy enforcement strategy    AST scanner   4-layer       CONFIRMED-EXPANDED
  3. Operational P&L architecture          compute-read  compute-read  CONFIRMED
  4. Integration checklist mechanism       manifest+AST  manifest+AST  CONFIRMED
  5. Test DB strategy                      docker+trunc  docker+trunc  CONFIRMED
  6. Mobile warehouse migration            extract-first extract-first CONFIRMED
  7. Sub-hire isSubhire migration          spot-check    spot-check    CONFIRMED
  8. Sentry + env-validation order         env→sentry→fx env→sentry→fx CONFIRMED
  9. Asset-status priority model           gap           gap           CONFIRMED-GAP
  10. Inventory as ledger                  not raised    flagged Wave3 NEW-INSIGHT
═══════════════════════════════════════════════════════════════════════════════
8/10 CONFIRMED, 2 expanded/new (priority model + inventory ledger).
```

## Eng synthesis (auto-decided per P5/P6)

### Wave 1 bug fixes — required additions to plan

**1a. Kit checkout/checkin bulk availability** — the plan said "fix it"; both reviewers add:
- **Reconcile-script first.** Live data is already drifted. Compute true `availableQuantity` from authoritative joins, run a one-shot reconcile *before* deploying the forward fix.
- **Extract a shared transactional inventory-mutation helper.** Called from `checkOutKit`, `checkInKit`, regular line-item checkout, kit composition. The same logic applies in all four places; today it's inconsistent.
- **Guarded `updateMany`** for concurrent kit checkouts: `where: { id, organizationId, availableQuantity: { gte: qty } }`. If affected count is 0, abort the transaction. This is row-level optimistic locking via the where clause — cleaner than `SELECT FOR UPDATE` and works in Prisma without raw queries.
- **Nested kits recursion.** Current `warehouse.ts:650` handles one level deep. Fix recursively, not by adding a grandchild branch.
- **Partial returns** — known limitation, not in scope for Wave 1. Document in code comment + FEATUREDOCS update.

**1b + 1d. Maintenance transaction + asset-removal stuck IN_MAINTENANCE — same PR.** Both reviewers say these collapse into one fix:
- Wrap record create/update + asset status updates in single `prisma.$transaction`
- Asset status update logic must consider `toRemove` set (currently ignored at `maintenance.ts:181`)
- **Guarded updates only flip status from `IN_MAINTENANCE` → `AVAILABLE`** — never overwrite `CHECKED_OUT`, `LOST`, `RETIRED`
- Document state-machine invariant: `SCHEDULED` doesn't hold, `IN_PROGRESS` holds, `COMPLETED PASS` releases, `COMPLETED FAIL` holds, `CANCELLED` releases

**1c. T&T FAILED/OVERDUE blocking** — both reviewers say:
- **Lookup-only block is UI validation, not compliance.** Enforce at every mutation point: `lookupAssetForScan`, `checkOutItems`, `checkOutKit`, `quickAddAndCheckOut`.
- **Hard block, no override in Wave 1.** Override is a separate feature later (mandatory reason + permission + activity log).
- Log denied scans as `action: "CHECK_OUT_BLOCKED"` with T&T status, test date, next-due, operator.

### Wave 1 sequence (revised)

```
1. Env validation lands first (custom Zod, no new deps — Zod already present)
2. Sentry lands second (so the bug fixes are observed)
3. BulkAsset reconcile script (one-shot data fix on prod)
4. Shared inventory-mutation helper extracted
5. Kit checkout/checkin fix using the helper + recursion + guarded updates
6. Maintenance transaction wrap + asset-removal handling (one PR)
7. T&T enforcement at all 4 mutation points + denied-scan logging
8. Regression tests on every fix (P6 — REQUIRED, not aspirational, per Eng review)
```

### Multi-tenancy enforcement (Wave 2) — revised per P10

**Revised 2026-05-14**: The original Eng-review recommendation was a four-layer defense (AST scanner, Prisma query scanner, manual audit, runtime probe tests) treating cross-tenant leaks as critical. Per P10, GearFlow operates single-tenant — the multi-tenancy harness is defense-in-depth dead plumbing, not a live security boundary. There is no second tenant to leak to.

**What stays:**
1. **AST scanner CI script (soft warn-only)** (`scripts/audit-server-actions.ts`, ~150 LOC, ts-morph): every exported async in `src/server/*.ts` must call `getOrgContext` or `requirePermission` or be allowlisted with a documented reason. **Warn in PR review, do not block CI.** This is documentation + regression guard, not enforcement. ~1 day to build.

**What was cut:**
- ~~Prisma query scanner~~ — overkill for single-tenant
- ~~Manual audit pass with written report~~ — unnecessary
- ~~Two-org runtime probe tests~~ — no second tenant exists

The original audit's worst-leak suspects (child entities like `SubHireItem`, `ModelMedia`, `CheckRecord`, `ProjectGroup`, `KitBulkItem`) still apply as code-quality concerns — the soft lint will surface them in future PRs. Won't be retroactively audited.

### Operational P&L architecture (Wave 2)

- **Compute on read.** No denormalization (drift kills trust). React Query caches at 60s stale.
- **New optional FK: `MaintenanceRecord.projectId`** (with `@@index([projectId])`). Not a join table — a maintenance record is caused by one project (or zero, for preventive maintenance).
- **Promote damage to first-class `DamageEvent` model:**
  ```
  DamageEvent {
    id, projectId, lineItemId?, assetId?, bulkAssetId?,
    severity (MINOR/MAJOR/TOTAL), photos[], notes,
    chargedBack: Boolean, estimatedCost?, actualCost?,
    status, maintenanceRecordId?, createdAt
  }
  ```
  `ProjectLineItem.returnCondition` stays for fast filtering but `DamageEvent` is source of truth.
- **Crew actuals from approved `CrewTimeEntry`, NOT `CrewAssignment.estimatedCost`.** Separate estimates from actuals in the P&L view (Codex insight: "P&L will be trusted only if it separates estimates from actuals").
- **Name it `ProjectOperationalSummary`, not "P&L".** Avoids finance-semantics confusion (Codex flag, aligns with P9).

### NEW INSIGHTS surfaced by Eng review

**A. Asset status priority model gap [HIGH]**
`Asset.status` is one mutable enum, but multiple workflows mutate it (maintenance, checkout, T&T, lost/retired). Without a priority model, fixes will keep overwriting each other. The Wave 1 guarded-update pattern is a partial mitigation, but the proper architectural fix is a derived-status pattern (multiple "hold" rows in a `AssetHold` table, status computed from active holds). **Recommendation:** Wave 1 keeps the enum + guarded updates (sufficient to fix the bugs); flag this as a Wave 3+ architectural improvement item.

**B. Inventory as ledger gap [MED]**
Bulk-asset availability is a field update, but really should be an `InventoryMovement` ledger (every check-out, check-in, kit-pack, maintenance-pull is a movement; current quantity is a sum). The Wave 1 fix is sufficient for now, but the right long-term shape is a ledger. **Recommendation:** Flag for Wave 3+ if reconciliation pain persists.

### Integration-checklist CI gate (Wave 2)

Both reviewers: **manifest file per feature + AST static enforcement.**
- `features/<name>.manifest.yaml` (or `src/config/feature-manifest.ts`) — one file per feature, declares: model name(s), sidebar route, search.ts case, org-export include, activity-log entityType, notification types, CSV import/export paths, permission resource
- CI script asserts each manifest claim resolves to real code
- AST check on `src/server/search.ts` and `src/lib/org-export.ts`: every Prisma model must appear OR be in an allowlist with documented reason

### Test DB strategy (Wave 1 onward)

- **Docker Postgres + Vitest globalSetup with per-file TRUNCATE CASCADE**, not per-test rollback (Prisma's nested-transaction model fights rollback-per-test)
- `prisma migrate deploy` once per test job
- Per-file fixtures (one org, one user, ~20 assets, 1 project)
- New convention: `src/server/**/*.int.test.ts` (separate from unit tests)
- Vitest `--pool=forks` for connection isolation
- **REQUIRED on Wave 1 bug fixes — not deferred.** Both Eng voices upgraded P6 from "alongside" to "regression tests MANDATORY for the 4 bugs."

### Mobile warehouse refactor (Wave 2)

Both reviewers: **extract primitives first, split layouts later.** No big-bang. No feature flag (just viewport-based component split).
1. Extract pure helpers and types (no UI change)
2. Extract `ScanInput`, `AssetLookup`, `ConditionPicker`, `KitGroupRow`, tab components — one PR per primitive
3. Extract `WarehouseDesktopFlow` rendering the same UI
4. Add `WarehousePhoneFlow` for narrow viewport
5. Run for a week internally before deleting old code paths

### Sub-hire `isSubhire` backfill (Wave 2)

Both reviewers: **spot-check production first.**
```sql
SELECT
  COUNT(*) FILTER (WHERE "isSubhire" = true AND "subHireId" IS NULL) as legacy_only,
  COUNT(*) FILTER (WHERE "subHireId" IS NOT NULL AND "isSubhire" = false) as new_only,
  COUNT(*) FILTER (WHERE "isSubhire" = true AND "subHireId" IS NOT NULL) as both
FROM project_line_items;
```
- If `legacy_only = 0` → just drop the column
- If `legacy_only > 0` → backfill: group by `projectId, supplierId, subhireOrderNumber`, create `SubHire` + `SubHireItem` rows, link line items, then drop legacy writes (in `line-items.ts:132`, `project-categories.ts:240`)
- Then drop the column in a follow-up migration

### Sentry + env validation (Wave 1 day 0)

- **Env validation FIRST** — custom Zod wrapper (Zod already in package.json:63, avoid t3-env dep churn). Validate at module load in `src/env.ts`, imported at every entry point
- **Sentry SECOND** — `@sentry/nextjs`, `tracesSampleRate: 0.1` prod / `1.0` dev, ignore `NEXT_NOT_FOUND` / `NEXT_REDIRECT` / Better-Auth flow-control errors, source maps via Sentry webpack plugin, release = git SHA from CI, `beforeSend` drops PII, no session replay (internal app)
- **THEN bug fixes** — observability is in place before changes ship

## Engineering Scorecard

| # | Dimension | Current | Wave-1/2 target | What makes it a 10 |
|---|---|---|---|---|
| 1 | Architecture soundness (Wave 1 fixes) | 5/10 | 9/10 | Shared inventory-mutation helper + reconcile-then-fix + guarded updates + recursive nested kits + collapsed bug #4 into #2's PR + tests REQUIRED |
| 2 | Test coverage strategy | 4/10 | 8/10 | Docker PG + truncate + `*.int.test.ts` convention + 80% gate on new code + regression tests on the 4 Wave-1 bugs |
| 3 | Performance/scaling risk | 6/10 | 8/10 | Query-cost budget per page (≤20 queries, P95 ≤500ms), EXPLAIN ANALYZE on operational-summary query in CI, composite `[orgId, action, createdAt]` index on ActivityLog |
| 4 | Security/multi-tenancy | 5/10 | 9/10 | AST scanner + Prisma query scanner CI gate, manual audit produces written report, two-org runtime probe tests, server-action-audit allowlist with documented reasons |
| 5 | Migration safety | 5/10 | 8/10 | Spot-check before isSubhire migration, extract-primitives-first for warehouse refactor, rollback path for notification-dismissal localStorage→DB migration |
| 6 | Operational readiness | 4/10 | 9/10 | Env validation → Sentry → fixes sequence; named libraries; ignored-errors list; sample rates per env; source-map upload from CI; release tagging |

Current ~4.8/10, Wave 1+2 target ~8.5/10.

---

# PHASE 2 — Design Review

## Design scope (per CEO P9 — internal-only)

GearFlow is a back-office operations console. Density-per-click > onboarding gradient. The user is the ops team (warehouse staff, project managers, crew coordinators, admins). The ONLY client-facing surface is the delivery docket.

## Design Dual Voices — Consensus

```
═══════════════════════════════════════════════════════════════════════════════
  Dimension                                Claude        Codex         Consensus
  ──────────────────────────────────────── ────────────  ────────────  ──────────
  1. Project P&L placement                 sticky strip  right-rail    DISAGREE
  2. Sub-hire UX unification               kill legacy   kill legacy   CONFIRMED
  3. Audit-trail: per-entity + global      yes both      yes both      CONFIRMED
  4. Settings IA: 4-5 grouped sections     yes           yes           CONFIRMED
  5. Delete pattern split                  yes           yes           CONFIRMED
  6. Mobile warehouse: two layouts         yes           yes           CONFIRMED
  7. Workshop queue: kanban-first?         kanban        table-first   DISAGREE
  8. Damage capture: camera-first mobile   yes           yes           CONFIRMED
  9. Delivery docket additions             driver/photo  driver/photo  CONFIRMED
═══════════════════════════════════════════════════════════════════════════════
7/9 CONFIRMED, 2 DISAGREEMENTS → taste decisions at gate.
```

## Auto-decided design choices

### Project detail page — P&L placement [TASTE DECISION]
Both reviewers reject "add another tab" and "use a separate route." They split on:
- **Claude:** sticky 2-row top strip with clickable source chips
- **Codex:** collapsible right-rail panel + compact stat strip near existing summary

**Auto-decide → Codex's right-rail approach (P5 explicit-over-clever, P3 pragmatic):** the project page already has a right rail with `FinancialSummary` at `projects/[id]/page.tsx:739`. Reusing that surface beats adding a third sticky element at the top. A new "Costs" right-rail panel slots in beside FinancialSummary without crowding the main column. Surface at gate.

### Sub-hire UX unification [CONFIRMED]
**Decision:** Wave 2 day 1 — kill the legacy `ProjectLineItem.isSubhire` field. Backfill: one-shot migration script (no UI prompt — Two Toned is the only tenant, per P3). One entry point ("Add sub-hire" on equipment tab), one entity (`SubHire`), one drawer dialog. Sub-hire items render under equipment tab grouped by supplier with an amber left-edge accent. Cross-supplier coordination at `/sub-hires` route (per ops admin's morning view).

### Audit-trail UI [CONFIRMED]
**Decision:** Both surfaces. Per-entity history tab (collapsed by default, last 5 events with "view all" → existing `ActivityTimeline` component at `src/components/activity/activity-timeline.tsx`) + global firehose at `/activity` (already exists per Codex, has filters and CSV export). Wave 2 work: tighten the per-entity surface, ensure both feeds use the same `ActivityLog` source.

### Settings IA [CONFIRMED]
**Decision:** Group the flat 14-item settings nav into 4-5 sections with overline labels. The settings layout sidebar already exists at `settings/layout.tsx:25` — turn it from a flat list into grouped sections:

```
ORGANIZATION       Business: general, billing, branding, team, SSO
OPERATIONS         Assets, Test & Tag, Check Items, Group Templates, Services
DOCUMENTS          Documents, brand templates, calendars, displays
INTEGRATIONS       WooCommerce
```

5 minutes of work, fixes IA permanently. Add `cmd+K` over settings titles.

### Delete confirmation pattern [CONFIRMED]
**Decision:**
- Row-level / single-item destructive → `ConfirmActionMenuItem` (inline dropdown 2-click)
- Cascading / project-level / asset-level → `Dialog` with consequence summary
- Bulk (>10 items) → `Dialog` with count + typed confirm
- Kill every `window.confirm()` in the codebase (currently at least one at `projects/[id]/page.tsx:413/426`)

### Mobile warehouse [CONFIRMED]
**Decision:** Split into `WarehousePhoneFlow` and `WarehouseDesktopFlow` components inside one route. Share primitives: `ScanInput`, `AssetLookup`, `ConditionPicker`, `KitGroupRow`, `PickPrepTab`, `DeployTab`, `ReturnTab`, `CloseOutTab`, server-action hooks. Phone gets bottom sheets (not Dialog), sticky scan input pinned with safe-area, haptic on scan success, swipe-to-check-in. Desktop stays dense/tabular. No `isMobile` branches inside leaf components.

This is significant work — likely deserves its own `/autoplan` inside Wave 2.

### Workshop / repair queue visualization [TASTE DECISION]
- **Claude:** kanban-first (5 status columns with drag-to-advance, AV ops staff visual mental model)
- **Codex:** table-first (sortable by due date, asset tag, project, severity, status, parts, cost — kanban as optional toggle)

**Auto-decide → Codex's table-first (P3 pragmatic, P5 explicit-over-clever):** maintenance teams already think in tables (the existing `/maintenance` route is table-based). Kanban is a second view, not the primary view. Power-user ops admins want sort/filter/bulk-select on maintenance records, not drag-and-drop. Surface at gate.

### Damage capture at checkin [CONFIRMED]
**Decision:** Camera-first on phone, form-first on desktop. Phone flow: scan → condition button (Minor/Major/Total) → photos → optional notes → done. No long forms mid-return.

### Asset utilization metrics [CONFIRMED]
**Decision (5 metrics on model detail, aggregate; per-instance on asset detail):**
1. Booking rate (% available-days reserved in trailing 90 days)
2. Revenue per asset (lifetime, sum of containing-project totals proportionally)
3. Maintenance cost ratio (maintenance / revenue — >15% flags retirement candidates)
4. Damage frequency (incidents per 100 checkouts)
5. Last-used date (flags dead inventory)

Org-level "top earners / dead weight" leaderboard on dashboard. No utilization dashboard route — these belong at the asset/model level.

### Delivery docket polish (THE client-facing artifact) [CONFIRMED]
Adds for Wave 2:
- Driver name + phone + vehicle rego + dispatch time
- Load photo (top-right thumbnail of the assembled gear)
- Case-count summary at the very top ("3 cases · 47 items") — drivers count cases before leaving
- Asset condition snapshot column (clean / scratch / etc.)
- Discrepancy reason-code legend (M=missing, D=damaged, W=wrong)
- Multi-page repeating header (project ref + page X of Y)
- QR code → static read-only return-instructions page (NOT a client portal — just a one-pager)
- Verify logo DPI rendering
- "Prepared by / checked by" fields
- Site access notes, delivery window, return instructions, project manager contact

### DESIGN.md adherence sweep [CONFIRMED]
Top 5 violation areas to target in Wave 2:
1. Inline `text-2xl font-bold` / `text-xl font-semibold` instead of `t-title` class
2. `window.confirm()` survivals
3. Card-per-section forms (DESIGN.md says flat with dividers)
4. Status pills missing dot + text pattern
5. Generic icons in empty states instead of spot illustrations

## Design Scorecard

| # | Dimension | Current | Wave 2 target | What makes it a 10 |
|---|---|---|---|---|
| 1 | Project P&L placement | 5/10 | 8/10 | Right-rail collapsible Costs panel + source-chip drilldowns + `/projects/[id]/costs` deep view |
| 2 | Sub-hire UX unification | 3/10 | 9/10 | Single entity, single entry point, legacy column dropped same release |
| 3 | Audit trail | 6/10 | 8/10 | Per-entity collapsed-by-default + global firehose with bookmarkable URL state |
| 4 | Settings IA | 6/10 | 9/10 | Grouped sections + cmd+K + consistent icon weight |
| 5 | Delete patterns | 3/10 | 9/10 | Inline confirm for rows / Dialog for cascading / typed confirm for bulk / no window.confirm |
| 6 | Mobile warehouse | 2/10 | 7/10 | Two layouts, shared primitives, no isMobile leaf branches, bottom-sheet pattern, haptics |
| 7 | Delivery docket | 6/10 | 9/10 | Driver/vehicle/photo/case-count/QR/multi-page header all in |

Wave 2 lifts the average from ~4.4/10 to ~8.4/10.

---

# PHASE 1 — CEO Review

## Step 0A — Premise Challenge

**The audit's framing premise is: "Fine-tooth-comb the whole app, fix everything, dream big on missing features." Both reviewing voices reject this framing.**

The audit catalogues the codebase accurately but draws the wrong conclusion. GearFlow's CRITICAL findings cluster overwhelmingly into one place: **the commercial transaction spine**. There is no `Quote` model, no `Invoice` model, no `Payment` model, no Stripe, no quote acceptance, no payment reconciliation, no AP for sub-hires, no maintenance cost flow into project P&L, no platform billing/subscription, no email delivery for documents/notifications. The product can track inventory and produce PDFs. It cannot complete a financial transaction.

Every other finding — DESIGN.md typography drift, naming consistency, `groupTemplate` not in search, integration checklist gaps — is a rounding error against "the product has no financial spine."

### Premises to confirm (THIS IS THE GATE)

| # | Premise | Stance | Implication |
|---|---|---|---|
| P1 | The product's CRITICAL gap is the **quote-to-cash financial spine**, not feature completeness | **Adopt** | Reframe work as "Q2C + SaaS-readiness", not "audit everything" |
| P2 | Accounting-grade ledgers belong in **Xero/MYOB/QBO**, not in GearFlow. GearFlow owns operational rental truth and syncs finalized invoices/payments outward | **Adopt** (requires user confirmation of accounting system Two Toned uses) | Build minimal `Invoice/Payment` models as cache + sync layer, not source of truth |
| P3 | GearFlow's wedge is **AV/theatre-specific workflow density + modern UX + Two Toned dogfooding moat**, not feature-by-feature parity with Rentman/HireHop/Current RMS | **Adopt** | Kill features outside the wedge. Buy don't build for: e-signature (DocuSign), routes (Onfleet), payments (Stripe), accounting (Xero), SMS (Twilio when ready) |
| P4 | SaaS-platform plumbing (Stripe Billing for tenants, feature flags, multi-tenant org-export polish, public API, i18n) is **premature** until there is a second paying tenant | **Adopt** | Defer all SaaS plumbing. Keep: Sentry, env-validation, structured logging (cheap + always pays off) |
| P5 | The 4 CRITICAL data-integrity bugs (kit bulk-asset availability, maintenance non-transactional, T&T-FAILED checkout-block, maintenance asset-removal stuck IN_MAINTENANCE) must be fixed **first** — they are corrupting live data right now | **Adopt** | 2-week bug-fix sprint before any rebuild |
| P6 | Test coverage should be written **alongside the financial spine rebuild**, not retroactively on the existing 19k LOC of server actions | **Adopt** | Locks the next 19k in well-tested form; existing buggy code gets replaced not tested |
| P7 | "Dream big" is **selectively** invited — the user wants the most feature-full RMS *that ships and works*, not "everything imaginable." We hold scope on the platform plumbing wishlist and expand only inside the AV-specific wedge | **Adopt** | Mode = SELECTIVE EXPANSION (auto-decided per /autoplan rules) |

---

## Step 0B — Existing Code Leverage Map

For each sub-problem in the reframed plan, what exists vs what's new:

| Sub-problem | Existing code we can leverage | What's new |
|---|---|---|
| Quote acceptance | `Project.status` enum already includes `QUOTED`; PDFs generate via pdfme | `Quote` + `QuoteVersion` + `QuoteAcceptance` models; signature capture (use a hosted e-sign vendor); client-facing accept page |
| Invoice | `Project.invoicedTotal` field; `recalculateProjectTotals` in `line-items.ts:540` | `Invoice` + `InvoiceLine` models; invoice numbering scheme; Xero sync adapter |
| Payment | Nothing | `Payment` model; Stripe Payment Links integration; reconciliation UI |
| Deposit flow | Unused `Project.depositPercent / depositPaid` fields | Wire to Invoice; deposit-percentage UI; partial-payment support |
| Sub-hire AP | `SubHire` + `SupplierOrder` tables | `SupplierInvoice` linking; payable aging report |
| Maintenance → P&L | `MaintenanceRecord.cost` field; `recalculateProjectTotals` | Link `MaintenanceRecord` to `Project` (the one that incurred damage); roll cost into margin |
| Damage cost-back | `ProjectLineItem.returnCondition` | New `DamageCharge` line-item type; rolls to invoice |
| Crew time → billing | `CrewTimeEntry` + `CrewAssignment` | Wire to project totals; bill rate vs cost rate distinction |
| Bug fixes (Stream 1) | All 4 critical bugs have isolated repro paths | Wrap maintenance in transaction; decrement bulk in kit ops; T&T status check in `lookupAssetForScan` |
| Sentry + env validation + structured logging | None | Standard middleware/instrumentation |
| Document email delivery | Existing Resend integration in `crew-emails.ts`; pdfme generation pipeline | Generic `sendDocument(documentId, recipient)` server action |

**Insight: ~60% of the leverage exists.** The financial spine isn't a green-field rebuild — it's mostly model additions plus 3-4 server-action rewrites.

---

## Step 0C — Dream State Delta

```
CURRENT STATE                  →  THIS PLAN'S DELTA              →  12-MONTH IDEAL
─────────────────────────────────────────────────────────────────────────────
Inventory + PDF tracker        →  Quote-to-cash SaaS              →  Best-in-class AV-RMS
  (no Quote/Invoice/Payment)   →    (Q2C spine + Xero sync)        →    (proven on 5+ tenants)
                               →    (4 critical bugs fixed)        →    (RFID + venue/load-in)
                               →    (Sentry + observability)       →    (AV-vendor marketplace)
                               →    (email delivery for docs)      →    (recurring/retainer mgmt)
                               →    (one sub-hire system)          →
                               →    (test coverage on new code)    →
```

**Where this plan leaves us:** GearFlow that can take a quote from inquiry through payment, with audit trails and observable failures. NOT feature-complete. Not multi-tenant ready in the SaaS sense. But: **commercially complete for one tenant (Two Toned), with the option to sell to a second tenant when one materializes.**

---

## Step 0C-bis — Implementation Alternatives

**Three approaches to the financial spine:**

| Approach | Effort (CC) | Risk | Pros | Cons |
|---|---|---|---|---|
| **A. Build internal source-of-truth Invoice/Payment** | 6-8 weeks | High | Full control, no vendor lock-in | Parallel ledger to Two Toned's accounting software; reconciliation nightmare; compliance gap (AU GST/BAS) |
| **B. Stripe Payment Links + Xero source-of-truth (RECOMMENDED)** | 4-5 weeks | Med | Xero owns accounting; Stripe owns payment collection; GearFlow owns operational state | Vendor dependency on Xero/Stripe; need Xero connector reliability |
| **C. Stripe Billing for everything** | 5-6 weeks | Med-High | Stripe owns invoicing too; minimal code | Stripe Billing is awkward for rental (variable per-event invoicing); doesn't replace Xero for BAS |

**P2-aligned pick: B.** Validate first that Two Toned uses Xero (highly likely for AU). If MYOB or another system: same pattern, different adapter.

---

## Step 0D — Mode Analysis: SELECTIVE EXPANSION

Per /autoplan rules, mode is SELECTIVE EXPANSION (auto-decided). The expansion targets:

**Inside the AV wedge — EXPAND:**
- AS/NZS 3760 enforcement at checkout (compliance differentiator)
- Damage cost-back workflow (operational pain Two Toned lives with)
- Sub-hire AP + supplier payable aging (real Two Toned problem)
- Crew time → project billing (T&M margin visibility)
- Workshop / repair queue (existing maintenance + check-items can unify)

**Inside the financial spine — EXPAND:**
- Quote acceptance with e-signature (DocuSign-hosted)
- Stripe Payment Links for deposits + balance
- Email delivery for quotes/invoices/payment receipts
- Project P&L unified across rental + crew + sub-hire + damage + maintenance

**Outside the wedge — HOLD or DEFER:**
- Customer portal (defer until Q2C spine works + 2nd tenant)
- Public API, webhooks, i18n, multi-currency (defer indefinitely)
- BI dashboards (defer until finance state is trusted)
- SMS notifications, route optimization, RFID, 3D models (defer indefinitely)
- Stripe Billing for SaaS subscription (defer until 2nd paying tenant exists)

**Inside the integration checklist — SELECTIVELY EXPAND:**
- `crew`, `checkItem`, `groupTemplate`, `subHire` get the search + activity-log + org-export gaps closed. This is genuinely cheap and matches the user's "nothing forgotten" intent.

---

## Step 0E — Temporal Interrogation

| Time horizon | What we need to be able to say |
|---|---|
| HOUR 1 | "The 4 critical data-integrity bugs are fixed and tests are passing on the fixes" |
| WEEK 1 | "Two Toned's live data stopped corrupting; Sentry is on" |
| WEEK 4 | "Quote model + Invoice model exist. Stripe Payment Link can be generated from an Invoice. Xero adapter is scaffolded." |
| WEEK 8 | "End-to-end Q2C works for one project type. Email delivery works. P&L is trustworthy." |
| WEEK 12 | "Sub-hire AP closed loop. Crew time → billing. Damage cost-back. Integration checklist gaps closed for the recent features." |
| 6 MONTHS | "GearFlow has been used to invoice and collect payment for $X of Two Toned revenue. A second rental company has agreed to evaluate it." |

---

## Step 0.5 — Dual Voices

### CEO DUAL VOICES — CONSENSUS TABLE

```
═══════════════════════════════════════════════════════════════════════════════
  Dimension                                Claude        Codex         Consensus
  ──────────────────────────────────────── ────────────  ────────────  ──────────
  1. Premises valid?                       NO (reframe)  NO (reframe)  CONFIRMED-NO
  2. Right problem to solve?               Q2C spine     Q2C spine     CONFIRMED
  3. Scope calibration correct?            No, too broad No, too broad CONFIRMED-NO
  4. Alternatives sufficiently explored?   No (Xero!)    No (Xero!)    CONFIRMED-NO
  5. Competitive/market risks covered?     Partial       Partial       CONFIRMED-PARTIAL
  6. 6-month trajectory sound?             NO            NO            CONFIRMED-NO
═══════════════════════════════════════════════════════════════════════════════
6/6 dimensions: Codex and Claude subagent agree. Cross-phase signal is very strong
that the audit framing needs to be reframed before any execution decision.
```

### CODEX SAYS (CEO — strategy challenge):
- "Reframe the next release as 'GearFlow quote-to-cash and SaaS-readiness release.'"
- "If finances are foundationally wrong, rip-and-replace the finance domain deliberately instead of patching PDFs and denormalized totals."
- "Accounting should probably be integrated, not rebuilt. Xero or QuickBooks should own accounting-grade ledgers."
- "Building Customer Portal before invoices/payments are real would be premature."
- "Adding SMS before email delivery exists is almost certainly wrong."
- "Building BI dashboards before the finance model is fixed will produce attractive but untrusted numbers."

### CLAUDE SUBAGENT (CEO — strategic independence):
- "This plan is rearranging furniture in a house with no plumbing."
- "Stop trying to be feature-complete. Stop building SaaS plumbing for one customer. Build the financial spine, ship a customer-facing quote-to-payment flow."
- "The real problem to solve is: Rebuild the financial spine — Quote → Acceptance → Invoice → Payment → AP → P&L — and treat everything else as either a blocker for that or a distraction from that."
- "If the answer to 'where do you win' is anything other than AV-specific workflow density + modern UX + Two Toned's dogfooding moat, do not build a SaaS. Stay an internal tool."
- "Retrofit tests calcify the current (buggy) behavior. You want tests on the next 19k LOC, not the last 19k."
- Top 3 premise risks: (1) Source-of-truth vs Xero cache; (2) SaaS for an audience of one; (3) No defined wedge.

---

## Step 0F — Premises CONFIRMED (final, after user clarification)

**Major user clarification at the premise gate: "I don't want the financial spine. Xero is the finance platform. GearFlow is the operations platform."**

This is the load-bearing pivot. GearFlow is **NOT** a finance system. It does not own Invoice, Payment, or CreditNote. Xero owns ALL of that — including payment collection (Xero has native Stripe support; invoices delivered through Xero include Stripe Pay buttons). GearFlow's job is purely: projects, kits, warehouse, maintenance, crew, check-items, reports, documents-as-PDFs. Quote acceptance stays as the existing PDF + email + "Mark as accepted" button flow. No GearFlow-side Stripe. No GearFlow-side Xero integration.

| # | Premise | Final position |
|---|---|---|
| P1 | ~~Q2C spine in GearFlow~~ → **GearFlow is operations-only. Xero is finance.** | REJECTED in favor of stronger position: no GearFlow-side finance models at all |
| P2 | Xero owns accounting | ACCEPT — **and Xero also owns invoicing + payment collection** (Two Toned operates Xero independently) |
| P3 | AV-specific wedge over feature parity | ACCEPT |
| P4 | SaaS plumbing deferred until 2nd paying tenant | ACCEPT — keep cheap wins (Sentry, env-validation, structured logging) |
| P5 | Fix 4 CRITICAL bugs first | ACCEPT |
| P6 | Tests alongside new code | ACCEPT |
| P7 | Wedge + cheap wins | ACCEPT |
| **P8 (new)** | **GearFlow stays an operations platform. Period.** No invoicing, no payments, no accounting integration. | **ACCEPT (user's explicit direction)** |
| **P9 (new)** | **GearFlow is fully back-of-house / internal-only.** The operations team is the user. Clients see only ONE artifact: the **delivery docket**. No client portal, no quote-to-client email flow, no client-facing acceptance UI, no invoice emails. Quote/Invoice PDFs (if any) are *internal* documents — Xero produces the real client-facing finance documents. | **ACCEPT (user's explicit direction)** |
| **P10 (new)** | **Single-tenant operational reality.** The multi-tenancy harness exists in code (`organizationId` columns, `getOrgContext`, `requirePermission`, Better Auth Organization plugin) but only one tenant will ever exist at a time. Cross-tenant leaks are theoretical, not real — no second tenant to leak to. The harness stays (ripping it out is enormous; defense-in-depth is harmless), but multi-tenant-specific investment stops. Org-export/import remains valid as a **backup/DR mechanism**, not as a tenant-migration feature. | **ACCEPT (2026-05-14, user-directed)** |

## Final execution plan — THREE WAVES (revised: no finance rebuild)

```
WAVE 1 — STOP THE BLEEDING (~2 weeks)
  ▸ Fix kit checkout/checkin bulk-asset availability (warehouse.ts:615)
  ▸ Wrap maintenance create/update in prisma.$transaction (maintenance.ts:101, 158)
  ▸ Fix maintenance asset-removal: removed assets must revert AVAILABLE
  ▸ Block checkout for T&T FAILED/OVERDUE in lookupAssetForScan
  ▸ Integration tests on these specific fixes (per P6)
  ▸ Land Sentry + env validation at the same time (cheap, prevents future blind spots)

WAVE 2 — AUDIT CLEANUP / "NOTHING FORGOTTEN" (~3-4 weeks)
  Integration checklist enforcement (FEATUREDOCS/29):
  ▸ groupTemplate → add to search, add CSV export, add to org-export, add activity log, link from /settings
  ▸ crew → add to org-export (full module: crew, role, skill, certification, time, etc.) — needed for backup/DR round-trip per P10
  ▸ checkItem + checkRecord → add to org-export, CSV import/export, full search, link from /settings — needed for backup/DR
  ▸ subHire → add to search, expand activity log coverage
  ▸ Missing permission/audit calls (group-templates writes, crew reads, check-items reads)
  Multi-tenancy harness lint (revised per P10 — single-tenant operational reality):
  ▸ Soft warn-only AST scanner in CI: flags any new server.ts export missing getOrgContext/requirePermission. Documentation + regression guard, not a sales-blocker. ~1 day.
  ▸ Cross-tenant probe tests, manual pen-test audit, hard CI block: REMOVED. No second tenant to leak to; defense in depth is sufficient.
  Dead-code & inconsistency sweep:
  ▸ Kill legacy ProjectLineItem.isSubhire path (route everything through SubHire entity)
  ▸ Consolidate "staff" role into "member" (or document distinction)
  ▸ Standardize delete dialogs (Dialog not AlertDialog everywhere)
  ▸ DESIGN.md violations: standardize on t-micro/t-body/t-label scale, audit color/spacing
  ▸ Naming drift: align enum casing for status fields
  Operational P&L visibility (Xero-OUT — GearFlow shows what it owns):
  ▸ Project "operational cost view": equipment revenue (already computed) + crew time cost + sub-hire cost + maintenance cost + damage events
  ▸ This is for decision-making, NOT for invoicing. Xero owns the actual invoice/payment.
  ▸ Link maintenance records to the project that incurred the damage (so cost can attribute)
  ▸ Sub-hire payment status remains operational metadata (Two Toned can mark "yes Xero shows this paid")
  Cheap-win operational plumbing (per P7+P9):
  ▸ Email delivery of **internal notifications** to ops-team users (the 9 notification types) — Resend already integrated
  ▸ Delivery docket polish (the only client-facing artifact — make it look right, support partial deliveries, mobile-friendly print)
  ▸ Audit-trail timeline UI on top of existing ActivityLog — internal ops view
  ▸ Scheduled reports (cron + Resend, leverages existing report engine) — internal recipients only
  ▸ Persistent notification read state (move dismissal from localStorage to DB)
  User-flagged fine-tooth-comb items (Wave 2 additions, 2026-05-14):
  ▸ Error UX overhaul — every user-facing error must show CONTEXT not raw exceptions
  ▸ Custom line items: pricing fields must be settable (current addCustomLineItem flow is incomplete)
  ▸ Project list page: TOTAL column must reflect rolled-up job total (services + line items + sub-hire + adjustments)
  ▸ QR / Barcode scanner full refresh — single Scanner primitive (QR + Micro QR + 8 barcode formats), camera picker, full-frame scanning, autofocus + torch + zoom, iPhone reliability, wired into all 15+ consumer pages including check-items

WAVE 3 — DREAM BIG INSIDE THE WEDGE (ongoing — formerly Wave 4)
  AV-specific differentiators (the moat):
  ▸ Workshop / repair queue (status: In Repair → Awaiting Parts → QA → Back in stock); unify with check-items + maintenance
  ▸ Asset utilization dashboards (booking rate, revenue per asset based on what Two Toned tells us; lifetime maintenance cost)
  ▸ Damage capture at checkin (photos, severity rating, free-text); creates a Damage record linked to the project — operational, not financial
  ▸ Calibration / certification tracking beyond Test & Tag (custom profiles)
  ▸ Stocktake / inventory audit (merge feat/stocktake if not yet merged)
  ▸ Cross-warehouse transfers
  ▸ Maintenance photos
  ▸ Reorder points / configurable low-stock alerts for bulk
  Operational quality-of-life:
  ▸ Self-service crew portal (view offers, log time, accept assignments)
  ▸ Saved filters per entity (consistent UX across all list pages)
  ▸ Bulk operations across list pages
  ▸ In-app onboarding tour
  ▸ Comments / @mentions on projects + assets
  ▸ Custom fields per entity (without schema migration)
  ▸ Reservation conflict resolution UI (swap proposals)

EXPLICITLY DEFERRED / EXCLUDED — NOT IN ANY WAVE (per P8: operations-only, P9: internal-only)
  Finance (Xero owns these — GearFlow never builds them):
  ▸ Invoice, InvoiceLine, Payment, CreditNote, Refund models in GearFlow
  ▸ Stripe integration of any kind (Xero invoices include Stripe Pay buttons natively)
  ▸ Quote model / acceptance state machine (existing PDF + status flag is sufficient; client gets the real quote via Xero)
  ▸ AU GST/BAS reporting (Xero handles)
  ▸ Multi-currency (Xero handles)
  ▸ E-signature service (Xero handles client signatures if needed)
  ▸ Tax line items, discount codes, late fees, deposits-as-state-machine
  Client-facing surfaces (out of scope per P9 — except delivery docket):
  ▸ Client portal of any kind
  ▸ Public booking widget / embeddable
  ▸ Quote-email-to-client flow (the client gets a quote from Xero, not GearFlow)
  ▸ Invoice-email-to-client flow (Xero)
  ▸ Client-facing accept link
  ▸ Customer-facing dashboards or status pages
  ▸ Public API for client use
  SaaS plumbing (defer until 2nd paying tenant):
  ▸ Stripe Billing for SaaS subscription
  ▸ Feature flags
  ▸ Public API + API keys
  ▸ Outbound webhooks
  ▸ Multi-language UI (i18n)
  ▸ Customer-facing portal (defer indefinitely — not the wedge)
  ▸ Public booking widget (embeddable)
  Out-of-wedge "dream big" items:
  ▸ BI dashboards (operational P&L view in Wave 2 covers immediate need)
  ▸ SMS notifications, Twilio integration
  ▸ Route optimization, vehicle assignment, fuel/mileage logs
  ▸ RFID, 3D model catalog, IoT integration, predictive maintenance
  ▸ Real-time presence, two-way email integration, calendar sync, GDPR data export
```

---

## CEO Review — Sections 1-10 (auto-decided)

### Section 1: Premises & Mode

Mode: **SELECTIVE EXPANSION** (per /autoplan rules + user confirmation of P7-modified).
Premises: see Step 0F above. Both reviewers and user converged on a four-wave plan with Q2C spine as Wave 3 (not Wave 1).

### Section 2: Error & Rescue Registry (revised — no Xero/Stripe risk surface)

| Failure Mode | Wave | Rescue Strategy |
|---|---|---|
| Critical bug-fix regresses existing flow | 1 | Integration tests on each fix; staged rollout to Two Toned data first |
| MT harness violation in new PR | 2 | Soft AST lint warns in PR review (per P10 — single-tenant; no live security boundary) |
| Email delivery fails silently | 2 | Resend webhook + Sentry alert + retry queue |
| Notification read-state migration corrupts user state | 2 | Backfill from localStorage on first login post-migration; preserve a 30-day rollback window |
| Operational P&L shows wrong number | 2 | The view is for decision-making, not for tax; show "estimated, source-of-truth Xero" disclaimer; per-line breakdown visible |
| Sub-hire payment-status stays stale | 2 | Mark as operational metadata only; never trust as source of truth; Xero reconciles |
| Wave 3 wedge feature scope creeps | 3 | One-feature-per-/autoplan; each gets its own review pipeline |
| Test coverage gates slow PRs | 1-3 | Run only changed-area tests in pre-merge; full suite nightly |
| DESIGN.md violation introduced | 2/3 | Add storybook + visual diff check for new components |
| Sentry rate-limits or noise | 1 | Configure ignored errors list; sample non-production envs |

### Section 3: Failure Modes Registry (revised)

| Failure | Severity | Detected by | Wave |
|---|---|---|---|
| BulkAsset availability shows wrong count after kit checkout | CRITICAL | Manual count vs prisma query | 1 |
| Maintenance record exists without status sync | CRITICAL | Asset list shows wrong status | 1 |
| Asset stuck IN_MAINTENANCE after edit | CRITICAL | Asset availability mismatch | 1 |
| T&T FAILED asset checked out | CRITICAL | Compliance audit / accident | 1 |
| Tenant A reads tenant B data via missing getOrgContext | CRITICAL | Pen test or customer report | 2 |
| Production error in server action invisible | MED→OK | Sentry catches | 1 |
| Email delivery failure on quote | HIGH | Client never received quote, missed event | 2 |
| groupTemplate / crew / checkItem lost on org export | HIGH | Org transfer drops data silently | 2 |
| Search results miss recent features | MED | User feedback | 2 |
| DESIGN.md drift accumulates | MED | Visual audit on each new component | 2/3 |

### Section 4: NOT in scope

The "EXPLICITLY DEFERRED" list in the Final execution plan is the authoritative not-in-scope set. Each item has a rationale tied to P3 (wedge) or P4 (SaaS plumbing premature) or P7 (cheap wins only).

### Section 5: What already exists (leverage map)

See Step 0B above. ~60% of the Q2C spine is leveragable from existing code; the gaps are model additions (Quote, Invoice, Payment, CreditNote, SupplierInvoice) and 3-4 server-action rewrites (one sub-hire path, P&L unification, Xero adapter).

### Section 6: 6-month trajectory (revised)

After Wave 1 (~2 weeks): 4 critical bugs fixed, Sentry catching errors, env validation in place, integration tests passing on the fixes.

After Wave 2 (~6 weeks total): audit-debt closed. Integration checklist enforced. Multi-tenancy pen-test clean. Dead code removed. DESIGN.md violations resolved. Operational P&L view shows project costs for decision-making. Email delivery works for quotes + notifications. Audit-trail timeline UI is live.

After Wave 3 onwards: each wedge feature ships independently with its own /autoplan. Damage capture, workshop queue, asset utilization, stocktake, cross-warehouse transfers all become individual sprints.

**Notably NOT in any wave:** any invoicing or payment logic. Xero handles all of it. GearFlow does operations.

### Section 7: Competitive risk (re-confirmed)

GearFlow wins on AV/theatre workflow density (kits/cases/preps/AS-NZS 3760/crew) + modern UX + Two Toned dogfooding. Loses on feature breadth. Strategy: stay opinionated, refuse to compete on every feature, **be the best tool for AV/theatre rental companies that find Rentman/HireHop too heavy and Current RMS too dated**.

### Section 8: Pricing model

Per P8, pricing-engine sophistication is **deferred** along with the rest of the finance work. GearFlow continues to produce per-day rate × duration totals (with discountPercent and taxRate as today). Anything more complex (dry-hire vs wet-hire, weekend rules, long-term discounts, package pricing, damage waivers) becomes a Xero-side concern OR a future wedge feature inside Wave 3 if Two Toned needs it operationally.

### Section 9: Security / Multi-tenancy (revised per P10)

The audit framed cross-tenant leaks as "customer-killing." With P10 locked (single-tenant operational reality), this is no longer a security severity — there is no second tenant to leak to. The multi-tenancy harness stays in place as defense-in-depth dead plumbing, and a soft warn-only AST lint flags new harness violations in PRs. No retroactive pen-test sweep, no two-org runtime probes. If GearFlow ever onboards a second tenant, lift the lint to hard-block first.

### Section 10: Success metrics (revised)

| Wave | "Done" looks like |
|---|---|
| 1 | Zero CRITICAL bugs open. Sentry catches errors. Tests pass on every fix. Two Toned's live data stops drifting. |
| 2 | All 4 recent features (crew/checkItem/groupTemplate/subHire) pass the FEATUREDOCS/29 checklist. Integration checklist becomes a CI gate. No legacy `isSubhire` path. MT harness soft-lint live in CI (warn-only per P10). DESIGN.md drift cleared. Operational P&L view ships. Email delivery for internal notifications. Org-export round-trips crew + checkItem + groupTemplate (for backup/DR per P10). |
| 3 | One wedge feature ships per 1-2 week iteration with its own /autoplan. Workshop queue, damage capture, asset utilization, stocktake all land within 6 months. |

---

## Themes & Top-of-Sheet Priorities (pre-CEO-review synthesis)

**The financial pillar is the weakest part of the product.** No formal Invoice/Payment models, no Stripe, no quote acceptance, no payment reconciliation, no sub-hire AP, no maintenance cost flow-back. This is the single biggest cluster of CRITICAL findings — and it's exactly where the user asked us to look.

**The integration checklist (FEATUREDOCS/29) has not been followed for recent features.** `crew`, `checkItem`, `groupTemplate`, `subHire` are all missing one or more of: sidebar nav entry, search index, activity log, notifications wiring, CSV export, org transfer support. This is the "things you've forgotten" the user named.

**There are real bugs with data-integrity consequences.** Kit checkout doesn't decrement bulk-asset availability. Maintenance updates aren't transactional. T&T failures don't block checkout. These will silently corrupt availability/compliance/inventory state.

**Test coverage is the biggest "future regression" risk.** 19k LOC of server actions has zero integration tests. The first major refactor (e.g., adding `Invoice`) will be terrifying without coverage.

**The SaaS-platform layer is incomplete.** No Stripe, no observability, no feature flags, no env validation, no email delivery for documents/notifications. These are table stakes for a sellable product.

---

## Proposed shape of work

**Stream 1 — Cleanup (the lake to boil)**
Every bug fixed, every dead code path removed, every DESIGN.md violation corrected, every integration gap closed. Atomic commits, one logical change per commit per CLAUDE.md.

**Stream 2 — Unification**
Two-ways-to-do-the-same-thing → one. Naming drift normalized. Module A wired to module B where the user would expect it to be (e.g. maintenance cost flows to project P&L).

**Stream 3 — Feature completeness (the dream)**
Missing-feature list with priority. Things competitors have that we don't, plus things users would expect from a "most feature-full bug-free rental management system."

---

## Constraints

- Must adhere to CLAUDE.md: branching, atomic commits, FEATUREDOCS updates, conventions
- Must respect DESIGN.md
- Cannot break existing data — must be additive or include migrations
- Cannot break the Phase 1–6 + User Management flows already shipped

---

## Open questions for review phases to settle

1. **Sequencing** — fix bugs first, then unify, then add features? Or interleave?
2. **Scope of "dream big"** — what's the bar for "missing" vs "nice-to-have"?
3. **Migration strategy** — for schema changes the audit surfaces, how invasive can we be?
4. **Test coverage uplift** — is this the moment to retrofit tests on existing features?
5. **Performance budget** — is there a page-load / query-count target we should hit?
6. **Mobile experience** — warehouse staff scan on phones. Is this a first-class concern?
