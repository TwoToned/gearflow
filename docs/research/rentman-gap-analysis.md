# Rentman ↔ RVLT Flow — feature gap analysis

**Status:** Research/analysis (not a spec, not a roadmap). **Date:** 2026-07-26
**Inputs:** [`docs/research/rentman.md`](./rentman.md) (hands-on Rentman demo walkthrough,
2026-07-26) cross-referenced against RVLT Flow's `FEATUREDOCS/`, `convex/schema.ts`, and
`docs/designs/app-cleanup-unification.md`, with code-level verification of every
"does not exist" claim (grep/route checks, 2026-07-26).

**Follow-up:** [`rentman-gap-priorities.md`](./rentman-gap-priorities.md) rates every gap
below by severity/worth and recommends build/defer/skip verdicts.

**How to read this:** §1 is what Rentman has that we don't. §2 is what we have that
Rentman doesn't. §3 is features both products have, where the *shape* differs enough to
matter. A ⚠️ marks places where we **built the thing and then deleted it** — those are
cheap(er) to reinstate than greenfield gaps.

**Caveat:** the Rentman side is a one-day demo walkthrough. Features not observed there
(SSO, crew certifications, granular permissions detail) may exist in Rentman anyway —
absence from `rentman.md` is not proof of absence from Rentman. The RVLT Flow side is
code-verified and reliable.

---

## 0. Executive summary

Rentman and RVLT Flow agree on the spine of the domain: projects with statuses,
serialized + bulk + kit inventory, an availability engine, sub-hire to cover shortages,
scan-driven warehouse prep/return, crew assignment, and PDF documents.

The divergence is directional:

- **Rentman is commercially complete and logistically wide.** Real quotation/invoice/
  contract entities, tiered pricing, per-line tax/ledgers, accounting export, purchase
  orders, multi-warehouse with internal transfers, vehicles + transport planning, a
  shortages command centre, a statistics module, a public API + webshop. It monetises
  the *office*.
- **RVLT Flow is operationally deep and compliance-differentiated.** Per-unit
  fulfillment with bidirectional stage moves, a check-item/quality system with
  predictive maintenance, AS/NZS 3760 Test & Tag (no Rentman analogue at all),
  revenue-allocation ROI down to the model inside a kit, realtime collaboration with
  blocking gates, enterprise SSO. It wins the *warehouse floor and the AU compliance
  wedge*.

Biggest structural holes on our side, in rough order of architectural weight:
**(1)** no two-clock scheduling (usage vs planning period), **(2)** no real
multi-warehouse stock, **(3)** no quote/invoice/payment entities (deliberate — ROADMAP
says "Xero owns finance", but the Xero integration itself is also unbuilt),
**(4)** no vehicles/transport, **(5)** no cross-project shortages surface,
**(6)** reporting/statistics removed.

---

## 1. Rentman has it — RVLT Flow doesn't

### 1.1 Commercial / financial

| # | Rentman capability | Our state |
|---|---|---|
| 1 | **Quotation, contract, invoice as real entities** — versioned quotes with view tracking and due dates, contracts alongside, invoices with numbering (rentman.md §5) | **No `Quote`, `Invoice`, or `Payment` model.** A "quote"/"invoice" is a PDF rendered on demand from current project state; `INVOICED` is just a project status; `Project.invoicedTotal` is one denormalized number (`app-cleanup-unification.md`: "[CRITICAL] No Invoice model. No Payment model. No Quote model.") |
| 2 | **Partial invoicing via invoice moments** (e.g. 50/50) + **refundable deposits** | Nothing. `depositPercent`/`depositPaid` fields exist unused |
| 3 | **Quote acceptance workflow** — publish state, view tracking, digital signing add-on | No expiry, no accepted-at/by, no e-signature, no client portal. Projects advance to CONFIRMED arbitrarily via a status button |
| 4 | **Tiered/multi-day pricing via factor groups** (line price = unit × factor, factor from a graduated table) | Flat `unitPrice × qty × duration − discount`. `duration` is a hand-typed multiplier; no degressive multi-day tiers, no rate tiers, no client-specific rate cards. (The old billing-weeks optimizer was **removed** June 2026) |
| 5 | **Discount groups + per-line GST class + dual credit/debit ledgers** flowing to accounting | One tax rate per project (fallback org default → hardcoded 10% GST); discounts are flat $ per line/group + one project %; `Client.defaultDiscount` is stored but wired to nothing; no ledger concept; AUD hardcoded |
| 6 | **Financial overview by category (Rental/Sale/Crew/Transport/…) with Estimated / Planned / Actual + profit at each stage** | We have a margin summary + an operational P&L panel, but a single actuality level — no estimated-vs-planned-vs-actual reconciliation. Crew cost is estimate-only (`CrewTimeEntry` never posts to project totals) |
| 7 | **Accounting connectors (QuickBooks, Xero) + "To be invoiced" queue** | **Zero code.** Xero appears only in ROADMAP/TODO prose. No payable tracking on the supplier side either (sub-hire costs never reach any AP concept) |
| 8 | **Sales/consumable track** — rental vs sale items, sales shortages, sale pricing | No sale-item concept anywhere; everything is rental or a free-text line |
| 9 | **Purchase orders wired into the flow** — subrentals link to POs; PO approval permission | We have `SupplierOrder` CRUD, but: **no link from `SubHire` to a PO** (verified, no FK), no supplier-facing PO document/email, no header editing after creation, no receiving-into-stock workflow |

### 1.2 Scheduling & planning

| # | Rentman capability | Our state |
|---|---|---|
| 10 | **Two-clock scheduling** — usage period vs planning (warehouse) period, tracked per project *and per line*, with a calculated roll-up (rentman.md §2) | **One clock.** Single `rentalStartDate/rentalEndDate`; load-in/out are derived display fields; **line items have no dates at all** (deliberate — `59-bulk-operations.md`). Availability, conflicts, and ROI all key off the one window, so prep/travel days silently don't reserve stock |
| 11 | **Subprojects** (phases/variants under one job) with per-subproject documents | Does not exist. One level of grouping (`Category → Group → LineItem`); the only optionality is a per-line `isOptional` flag |
| 12 | **Time schedule tab** — named time bands linked to equipment/function groups, project Gantt | No project Gantt anywhere. Services have dates and render as a grouped list; the only Gantt in the product is the 14-day crew planner |
| 13 | **Cross-project Shortages module** — per-item shortage qty, typed reasons (`Shortage`, `Invalid reservations`, `Shortage solved`…), start date, one screen for the whole business (§4) | **No shortages screen.** Overbooking surfaces only as per-row badges on the project and PDFs, plus a per-add sub-hire pre-check. Nobody can answer "what is short next week, across all jobs" without opening every project |
| 14 | **In-option bookings** (`Optie`) — hold gear without hard-booking it | Closest is line-level `isOptional` (excluded from revenue) — but it does not interact with availability as a soft hold |
| 15 | **Equipment alternatives** (substitute items on the equipment record) | Does not exist; a shortage's only remedies are overbook-with-confirmation or sub-hire |

### 1.3 Multi-warehouse & stock control

| # | Rentman capability | Our state |
|---|---|---|
| 16 | **Multiple warehouses with per-warehouse stock levels**, warehouse-scoped availability and prep (§1, §3) | **Location tagging, not multi-warehouse.** An asset/bulk row has one `locationId` = current whereabouts; availability is org-wide and location-blind (verified: zero `locationId` references in `overbooking-core.ts`). "How many available at Warehouse B" is unanswerable |
| 17 | **Internal transfers between warehouses**, modelled as first-class "Transferprojects" with the same tooling as subrentals | No transfer entity, mutation, or route. Location changes happen implicitly at checkout/check-in (check-in resets to the single org default location) |
| 18 | **Shelf locations** (`WarehouseShelf`) | No shelf/bin/rack field (location `parentId` nesting is the only approximation) |
| 19 | **Inventory counts / stocktakes** | ⚠️ **Built, then deliberately deleted** (June 2026 feature-removal cluster — models, routes, permission, docs all gone). No cycle count or reconciliation exists today |
| 20 | **Lost equipment register** (removes from stock, worklist) | `LOST` is only an asset status set by a MISSING return or close-out; no register page, no write-off/claim workflow, no loss-value reporting |
| 21 | **Stock mutations ledger** (`Voorraadmutatie`) | Bulk quantities mutate in place; the append-only `assetScanLogs` covers physical scans only and has no standalone page or export |

### 1.4 Crew & transport

| # | Rentman capability | Our state |
|---|---|---|
| 22 | **Vehicles as first-class resources** + **transport planning tab** + transport functions with capacity (m³) + the transports timeline on the warehouse board (§2, §6, §7) | **Not modelled at all.** No vehicle entity (verified). `Location.type=VEHICLE`, a free-text `vehicleDescription` + `numberOfTrips` on delivery services — that's everything. Explicitly out-of-wedge in `app-cleanup-unification.md` |
| 23 | **Crew planner with availability matching** — for a selected function, ranks crew as Planned/Available/Matching by skill + free time, grouped Own/Preferred-Freelancer/Other | Our 14-day planner shows assignments + availability blocks and the assignment dialog flags conflicts, but there is no "find me matching crew for this slot" ranking — and the *service* crew picker (the primary add path) shows no conflict badges at all (documented gap, #796 follow-up) |
| 24 | **Crew self-service** — "My schedule", a job board, native crew apps | ⚠️ Largely absent (explicitly "Phase 7, not implemented"). Crew respond to offers via tokenised email links and get a read-only iCal feed; a linked user can view their own profile page. No in-app offer inbox, no self-serve hours logging |
| 25 | **Leave requests** (request/approve workflow, part of Time registration) | Does not exist (verified — no model/UI). Only an `ON_LEAVE` member status and manually entered availability blocks |
| 26 | **Crew sell/charge rates** — functions carry *cost and price*; crew revenue is a category in the financial overview | Cost side only (rate cascade → estimated cost). Charging the client for labour is a manually priced service line; no per-role/per-crew charge rate, no crew margin |
| 27 | **Per-person expense columns** on crew scheduling (catering, travel, accommodation) | Does not exist |

### 1.5 Warehouse operations

| # | Rentman capability | Our state |
|---|---|---|
| 28 | **Project-less "Scan return" station** — scan whatever comes back, no project context needed (§7) | Does not exist. Every check-in is project-scoped; the warehouse-hub scan box is a project *search filter*. ⚠️ Adjacent: project-wide bulk check-in totals was built, UI removed, backend dormant (`52-bulk-checkin.md`) |
| 29 | **Camera scanning + native warehouse/crew mobile apps** | ⚠️ Camera scanning was built (`html5-qrcode`) and **removed** — "never worked reliably on iPhone". Today: typed tags or Bluetooth/USB HID wedge only; no native apps; PWA has no offline data/scan queue |
| 30 | **Scan audio feedback** in warehouse booking | Only exists in the Test & Tag quick-test wizard, not the warehouse |
| 31 | **Custom, reorderable warehouse statuses** (Prepped is user-defined) | Fixed five-stage lifecycle; no user-defined stages |
| 32 | **Per-project QR on warehouse cards** (scan card → open booking) | Not present (QR generation exists per-asset only) |
| 33 | **Cross-docking overview** | No equivalent (also unexplored in the demo) |

### 1.6 Maintenance

| # | Rentman capability | Our state |
|---|---|---|
| 34 | **Periodic inspection schedules** — recurrence configured on the equipment record + Configuration, generating an "Equipment to inspect" worklist (§8) | General maintenance has a manual `nextDueDate` only — **nothing recurs or auto-generates** (verified). Recurring inspection generation exists solely inside Test & Tag |
| 35 | **Repair pipeline** — repair register per serial, raise-from-scan, status filter | ⚠️ Maintenance records hold/release stock properly, but the Workshop Kanban (repair board) and Damage Capture were **deleted**; `AWAITING_PARTS`/`QA` survive as dormant enum values. No raise-repair-from-warehouse-scan shortcut |

### 1.7 Reporting & platform

| # | Rentman capability | Our state |
|---|---|---|
| 36 | **Statistics module** — saved report definitions (crew, revenue per account manager / project type / supplier, repair history), date-ranged List + Chart tabs, download (§9) | ⚠️ The general report builder (~30-report library, saved/pinned/shared reports) was **removed entirely**. What's left: T&T reports, per-project P&L panel, gear-ROI module. No charts, no saved reports, no export-any-list |
| 37 | **Customisable dashboard widget boards** (revenue, open invoices, quotations) | Fixed dashboard (my-projects cards, needs-attention chips, four org counters, activity feed). No charts, no configuration |
| 38 | **Custom roles / permission sets** + **seat-based licensing** (only power users are paid; office/freelancer free) | Five fixed roles (`owner/admin/manager/member/viewer`); `CustomRole` was removed. No seat/plan concept — single-org deployment (n/a as a commercial gap for self-hosting, relevant if RVLT Flow goes multi-tenant SaaS) |
| 39 | **Public REST API** (token-based) + **Zapier** | ⚠️ Our 537-operation REST + MCP API was **removed 2026-07-14** (dormant, reinstatement blueprint exists). Today the only programmatic surface is 4 outbound webhook events |
| 40 | **Webshop plugin** (public rental catalog) + **Rental requests** (from other Rentman users) | No public catalog or availability published outward; WooCommerce integration is inbound-only (order → project) |
| 41 | **Email integration** — auto-link inbound email to a project by `#number`; communication log per contact | No inbound email at all ("two-way email" is an explicit non-goal); no per-client communication log |
| 42 | **CRM depth** — companies + multiple contact persons, per-contact invoice moment / payment condition / tax schema | One flat `clients` table with a single embedded contact; `paymentTerms` is a free-text string; client detail = Projects/Notes/Files tabs only |
| 43 | **Tasks attachable to any entity** | Tasks are project-scoped only; no cross-project "my tasks" view (the query was never shipped) |
| 44 | **Document generator** — template + letterhead picker, editable rich-text body, merge variables incl. custom fields, reusable snippets, AI template generation (§2, §10) | ⚠️ Section-based template *data model* exists but the entire interactive builder (designer route, editors, all write actions) was **deleted** — `/settings/documents` is read-only over built-in defaults. Working: org brand templates (header/footer/accent), `{token}` titles. No merge-variable authoring, no letterheads, no per-client branding |
| 45 | **"Fill in with AI"** — quote text, equipment physical specs, template HTML (opt-in ChatGPT) | No AI features in-product (verified — no LLM SDK anywhere) |
| 46 | **History log with point-in-time saves + diff viewer** (paid add-on) | Partial — our activity log has field-level diffs per change, but no point-in-time snapshot/restore of a whole project |
| 47 | **Equipment physical properties** — L/W/H, transport volume (m³), packed-per, current (A) | Models carry `weight` + `powerDraw` + free-form specs JSON only; no dimensions/volume fields, so no rig weight/truck-volume totals per project |

---

## 2. RVLT Flow has it — Rentman doesn't (or wasn't observed to)

### 2.1 Clear differentiators

1. **Test & Tag — AS/NZS 3760:2022 compliance module** (`FEATUREDOCS/14`). No Rentman
   analogue at all. Equipment classes, appliance types, 12 seeded test profiles with
   electrical thresholds, per-outlet/phase sub-tests, a 5-step keyboard-driven quick-test
   wizard with audio feedback, failure workflow (→ maintenance / out-of-service /
   retire), label printing (89×36mm), auto-registration from model flags, due digests,
   10 report types, and a **tokenised external-auditor view** with no login. This plus
   GST/ABN defaults is the Australian compliance wedge.

2. **Check items / quality checks** (`FEATUREDOCS/37`). A model- and kit-assignable
   check library (pass/fail, notes, measurement-with-thresholds, dropdown), firing at
   prep and de-prep, with per-check failure-rate analytics and **predictive
   maintenance** (2 fails in last 3 → auto-create a preventative maintenance record).
   Rentman's warehouse flow scans state transitions; it does not run structured quality
   checks per item.

3. **Revenue allocation → per-model ROI** (`FEATUREDOCS/57`). Splits kit/bundle/group
   prices down to the models inside (integer-cent largest-remainder, IFRS-15-style
   relative standalone price), snapshotted at write time, surfaced as a model ROI tab
   and a fleet-wide payback leaderboard with an **idle-capital** stat. Rentman's rental
   equipment statistic reports revenue/utilisation per item but has nothing that
   allocates a bundle's price to its contents.

4. **Realtime collaboration substrate** (`FEATUREDOCS/55`). Presence avatars, heartbeat
   edit locks with stale takeover, threaded comments with **blocking gates that
   physically stop check-out/status-advance** while a blocker is open, review markers,
   live row pulse/flash, grouped activity feed. Rentman has socket-pushed liveness but
   nothing resembling blocking review gates.

5. **Bidirectional warehouse lifecycle + per-unit fulfillment** (`FEATUREDOCS/12`, `60`).
   Every stage past Pick has an exact mirror "move back" mutation; quantity-aware
   partial staging (one line legitimately in two stages at once); per-unit serial
   tracking with post-hoc **reassign** and kit-member **swap**; RETURNED unit history
   retained through close-out with an append-only scan-log backstop. Rentman's flow is
   forward-driven scan states; this reversibility + unit-level audit is finer-grained.

6. **Enterprise SSO** (`FEATUREDOCS/33`): SAML 2.0 + OIDC, three provisioning modes,
   IdP group→role mapping with unmapped-group discovery, enforce-SSO gated behind a
   test login — plus **passkeys** and TOTP 2FA. (Not observed in the Rentman demo;
   Rentman may have some of this at enterprise tiers.)

7. **Warehouse TV wall display** (`FEATUREDOCS/12`): token-authenticated, read-only,
   3-metre-readable dashboard (`/warehouse/display/{token}`) with three layouts,
   location scoping, 60s auto-refresh. Nothing similar observed in Rentman.

8. **WooCommerce order → project automation** (`FEATUREDOCS/35`): HMAC-verified
   webhook, fuzzy client matching (Dice ≥ 0.7), SKU/meta/name product matching,
   location fuzzy-match/auto-create, full project assembly. Rentman's webshop is its
   own storefront; it doesn't ingest an external store's orders.

9. **Command palette + global fuzzy search** (`FEATUREDOCS/16`): ⌘K palette with `@`
   page navigation, `/` context-aware slash commands (incl. generate-PDF), trigram
   fuzzy scoring across ~14 entity types in one round trip.

10. **Hardened outbound webhooks** (`FEATUREDOCS/58`): HMAC-signed with timestamped
    signatures, dual-secret rotation, exponential backoff, delivery log, auto-disable,
    and a serious SSRF policy. Rentman has webhooks; the demo showed nothing about
    signing/rotation/SSRF posture (unverifiable, but ours is a defensible
    implementation edge).

### 2.2 Smaller edges

- **Deployment-aware PDF filtering** — delivery docket renders only deployed gear,
  return sheet only deployed/returned, pull slip pre-ticks what's out (`FEATUREDOCS/13`).
- **Kit verification with partial deploy** — "X/Y verified, deploy verified only",
  enforced across all four scan/checkbox paths incl. nested grandchildren.
- **Crew data model depth** — skills, certifications with expiry alerts, per-day shifts,
  availability blocks, timesheets with approval workflow + CSV export, per-crew iCal
  feeds + org ICS feeds (projects/services/maintenance/crew). (Rentman has time
  registration; certifications/skills-with-expiry weren't observed.)
- **Service auto-generation** — org service templates spawn delivery/bump-in/bump-out/
  pickup + per-show-day labour lines from project dates, idempotently.
- **Prep containers** — ad-hoc case grouping at pick time that carries through deploy,
  return, and every PDF, with auto-deploy/auto-return of the case line.
- **Mobile-first web UI with enforced compliance** — card-list rendering of every
  operator table, 44px touch targets, and a CI test that statically fails
  hover-only/undersized-target regressions. (Rentman solves mobile with native apps
  instead; see gap #29 for our scanning weakness.)
- **PII-hardened observability** (PostHog, cuid-only identity, latency budgets) — an
  engineering posture, not a customer feature, but Rentman ships LogRocket + Segment +
  Zendesk by contrast.

---

## 3. Both have it — but differently

| Area | Rentman shape | RVLT Flow shape | Who's ahead |
|---|---|---|---|
| **Project lifecycle** | Status drives a doc-centric machine (Draft→Inquiry→Quotation→Confirmed) with quotations/contracts/invoices as separate versioned artifacts; subprojects; "project progress" nudge widget | 10-status linear enum on one row (`ENQUIRY→…→INVOICED`), kanban board + table, manual advance button, no sub-entities | Rentman commercially; ours is simpler to operate |
| **Project numbering** | Number series in Configuration; display number separate from id | Full token-template engine (`GIG/%YYYY/%SEQ`), reset periods, org timezone, atomic counter, live preview (`FEATUREDOCS/51`) | Ours is more flexible |
| **Kits/combinations** | *Virtual* combinations (derived stock, no own identity) **and** physical combinations with per-instance content status (Complete/Incomplete) tracked in a dedicated Warehouse→Combinations screen | Physical kit records only (own tag/status/case data, nested 2 levels, `INCOMPLETE` status exists); the virtual-bundle role is filled by **group templates** (model-or-kit items, applied per unit). Content verified at prep time rather than continuously | Rough parity; Rentman's standing per-serial content status is cleaner; our group templates + kit pricing modes (KIT_PRICE/ITEMIZED + discount) are richer commercially |
| **Accessories** | Accessory rules per item: Quantity / Automatic / Skip-if-present / Add-as-new-line / Free | Model-level + asset-level bulk accessory rules, `SHIPS_WITH` vs `DEDICATED` allocation, auto-add at three points, opt-out checkbox; known gaps: quantity edits don't rescale, no per-accessory pricing (`FEATUREDOCS/48`) | Parity, different vocab. Their "free" flag ≈ our unpriced children; we lack "skip if already present" |
| **Availability engine** | Demand vs stock across the *planning* window, per warehouse; feeds a shortages module with typed reasons; repairs/lost/inspections-due subtract from bookable stock | Overlap-window engine with reduced-stock nuance (maintenance/lost/retired subtract), sub-hires relieve demand, dateless fallback, per-row badges + PDF badges; **only current status subtracts — scheduled maintenance doesn't reserve**; no shortage rollup; org-wide only | Rentman — the multi-warehouse + shortage surface + planning-window trio compounds |
| **Sub-hire / subrental** | Shortage-driven; grouped by destination warehouse; internal transfers as sibling concept; linked purchase orders; supplier + status tracking | First-class `SubHire` with **dual cost/charge pricing, live margin, supplier rate memory, cross-supplier rate comparison**, attachments, order numbers, placement rules; dialog-only (no standalone list); no PO link, no partial returns, no transfers (`FEATUREDOCS/39`) | Ours is commercially richer per order; theirs is operationally wired into shortages/POs/transfers |
| **Warehouse scan flow** | Kanban of projects by status with QR cards; booking screen with two status columns, scan field with beep, serial-to-kit binding at pack, "book everything"; project-less scan return; every scan → tracking log | Five-stage per-project lifecycle with counts, urgency-grouped hub cards, batch close-out (25 projects), per-unit assignment/verification, T&T checkout gate (WARN/BLOCK policy), scan conflict detection naming the other project; HID-wedge only, project-scoped only | Split: theirs is the better *station* (any-direction scanning, beep, QR); ours the better *record* (per-unit, reversible, gated) |
| **Maintenance** | Repairs + Inspections + Equipment-to-inspect + Lost + Inventory counts, all feeding availability and repair-history reporting | One `MaintenanceRecord` model (6 types, multi-asset, photos, cost) with correct stock hold/release; T&T handles the inspection-recurrence story for electrical only; no lost register/counts/repair board (all removed or never built) | Rentman, except electrical inspections where our T&T is far deeper |
| **Documents/PDFs** | Generic generator: any template + letterhead + merge variables + snippets; AI template generation; digital signing | Eight fixed doc types with strong domain logic (collapse/expand line structuring, packer-walk sort, deployment filtering, per-unit checkboxes) + T&T reports; org brand templates; template *builder* deleted | Rentman on flexibility; ours on out-of-the-box correctness for warehouse docs |
| **Custom fields** | Per entity type, Hidden + Confidential flags, usable as document merge variables | 5 field types with library UI, but wired to **assets only** in practice (enum lists 4 entity types), stored as JSON blob, not exposed to PDFs (`FEATUREDOCS/46`) | Rentman |
| **Crew & services** | Functions/function-groups per show day; cost *and* price per function; cross-project planner with skill/free-time matching | Services (typed, dated, auto-generated) own the labour tab; crew assignments with offer→accept tokens, shifts, conflict detection; 14-day planner; timesheets + approvals; cost-only rates | Rentman on transport + charging + matching; ours on lifecycle (offers, shifts, timesheets, certs) |
| **Tasks** | Attachable to any entity, deadlines, assignable | Project tab with status/priority/due/checklists, user-or-crew assignee; no cross-entity attach, no my-tasks rollup, no notifications | Rentman slightly |
| **Audit trail** | Warehouse tracking log (every scan) + paid history-log add-on (point-in-time diffs) | Convex `activityLogs` (field-level diffs, ~47 entity types, CSV export, embedded timelines) + separate `assetScanLogs`; scan log surfaced in only two popovers, no unified view; some casing inconsistency breaks filters | Ours broader, theirs better surfaced for warehouse; our two logs are un-unified |
| **Realtime** | socket.io push refreshing grids | Convex reactive queries everywhere + the §2.1 collaboration layer | Ours |
| **Extensibility** | REST API + webhooks + Zapier + QuickBooks/Xero + webshop | 4 outbound webhook events (well-engineered); API/MCP removed-but-blueprinted; WooCommerce inbound | Rentman today, by a lot |
| **Tags** | `Tag`/`Taglink` entities | Free-string arrays on 11 entities, lowercase-normalised, org-wide autocomplete (9 of 11), search-matched; no colours/hierarchy/management screen | Parity-ish |
| **CSV / data I/O** | Import seen on inspections; broad grid exports implied by configurable views | Models/assets/bulk/rates import-export + timesheet + activity + T&T exports; whole-org JSON transfer; ~530ms/row import perf landmine; no projects/clients/suppliers/kits CSV | Mixed |
| **Dashboards** | Customisable widget boards | Fixed personal dashboard + needs-attention + counters | Rentman |

---

## 4. Notable ⚠️ built-then-removed inventory (cheapest reinstatements)

These gaps differ from greenfield ones — schema, logic, or blueprints already exist:

| Feature | State | Where |
|---|---|---|
| Public API + MCP (537 ops) | Removed 2026-07-14, `ApiKey` dormant, reinstatement blueprint | `FEATUREDOCS/56`, `docs/designs/archive/api-mcp-agent-access.md` |
| Stocktake / inventory counts | Fully deleted June 2026 | `docs/designs/archive/feature-removal-2026-06.md` |
| PDF template builder | Builder + write actions deleted; section data model + `DocumentTemplate` tables dormant | `FEATUREDOCS/13` |
| Report builder (~30 reports, saved views) | Removed entirely | `FEATUREDOCS/27` |
| Bulk check-in totals | UI removed, backend retained dormant | `FEATUREDOCS/52` |
| Camera barcode scanning | Removed (iOS reliability); props stubbed for drop-in return | `FEATUREDOCS/19` |
| Workshop Kanban (repair board) + damage capture | Deleted; enum values dormant | `FEATUREDOCS/15` |
| Billing-period pricing optimizer | Dropped by migration June 2026 | `FEATUREDOCS/10` (stale section), migration `20260617000000` |

---

## 5. Where this points (analysis only — no commitments)

1. **The scheduling substrate is the deepest architectural gap.** Two-clock periods
   (#10), per-line dates, multi-warehouse stock (#16-17), and the shortages surface
   (#13) compound into Rentman's core planning loop. Everything else (transfers,
   warehouse-scoped prep, planner views) hangs off those primitives.
2. **Finance is a decided wedge, but the decision is half-executed.** ROADMAP says
   "Xero owns invoices, payments, quotes, GST" — yet there is no Xero integration, so
   today *nobody* owns them. Either the connector (#7) or minimal quote/invoice
   entities (#1-3) is needed to close the loop the PDFs start.
3. **The warehouse floor is close to won** — the remaining Rentman edges there are the
   any-direction scan-return station (#28), camera scanning (#29), and beep feedback
   (#30), all small compared to what's already shipped.
4. **Transport (#22) and crew self-service (#24) are the people-side holes** most
   visible to an AV company evaluating both products side by side.
5. **Defend the differentiators in sales terms:** T&T compliance + auditor tokens,
   check-driven quality with predictive maintenance, per-model ROI/idle capital,
   blocking collaboration gates, SSO/passkeys. None of these were observed anywhere in
   Rentman.
