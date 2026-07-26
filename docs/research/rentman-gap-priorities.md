# Rentman gap analysis — severity/worth ratings & recommendations

**Status:** Research/prioritisation (not a spec, not a commitment). **Date:** 2026-07-26
**Inputs:** [`rentman-gap-analysis.md`](./rentman-gap-analysis.md) (gap #s below refer to
its §1 table), [`rentman.md`](./rentman.md), `docs/ROADMAP.md`.

> **⚠️ Superseded in part — decisions of 2026-07-26 (see tracking issue #934):**
> the "Xero owns finance" premise below is **redacted**. RVLT Flow now owns the
> quoting pipeline and invoice generation (deposit / partial / final invoices);
> Xero and other finance apps own the ledger, payments, and reconciliation.
> Outcomes per Tier-1 item: **1 (Xero push) accepted + expanded** into a full
> finance-model workstream; **2 (two-clock) accepted, reshaped** as a two-window
> simplification (rental + project dates, event dates deleted, load-in/out become
> the project window); **3 (shortages) accepted, widened** into an
> "Overbookings & Gaps" board covering gear + crew, with a two-layer
> hard/pencilled availability model; **4 (tiered pricing) accepted** as a
> unification/UX pass over the existing billing-weeks/days system with
> best-price capping; **5 (quote acceptance) rejected** — email trails suffice;
> **6 (scan return) accepted** as an org-wide returns screen.
>
> **Tier-2 outcomes (same date, tracking issue #936):** recurring preventative
> maintenance **accepted, explicitly non-blocking** (never subtracts from
> availability; model-wide schedules, per-unit check-off for serialised,
> quantity-sessions for bulk); canned reports **deferred**; supplier PO
> **accepted as data-only** (no outbound docs/emails — RVLT as data-rich hub);
> crew-conflict badges in pickers **accepted**; multiple client contacts
> **accepted, optional**; labour charge rates **accepted** (per-role rate,
> service-level override); sales items **accepted, widened** — every model
> sellable (`Model.salePrice` + line override), default new-stock sale with no
> rental-stock impact, explicit sell-from-fleet variant that retires/decrements.
> The pencil rule is also now decided: pencilled = optional lines or unconfirmed
> gigs; confirmed gigs hard-hold everything except optional lines.

**Positioning premise (from ROADMAP + gap-analysis §0):** RVLT Flow is not trying to be
Rentman. It wins the warehouse floor and the AU compliance wedge; Rentman wins the office.
A gap is therefore only worth closing when it is (a) a workflow a
working AV/theatre rental business *cannot cleanly run without*, or (b) cheap relative to
its payoff. "Rentman has it" is never, on its own, a reason.

## Rating scheme

- **Severity** — how much the hole hurts a real rental operation running on Flow:
  - **Critical** — a core business loop is open (money, gear correctness, compliance).
  - **High** — daily friction, or a real risk of losing gear/money/bookings.
  - **Medium** — periodic friction; workable manual workaround exists.
  - **Low** — rarely bites, niche, or contrary to our positioning.
- **Worth** — expected return ÷ build cost, given positioning and what already exists
  (⚠️ = built-then-removed, so cheaper to reinstate).
- **Verdict** — Build now / Build next / Defer (wait for pull) / Skip deliberately.

---

## Tier 1 — Critical severity, high worth: build these

These six close open loops in the three core cycles of a rental business —
**quote → confirm → bill**, **book → check availability → prep**, and
**deploy → return**. Missing any of them forces off-system workarounds daily.

### 1. Xero invoice push (gap #7; subsumes most of #1, #2, #5)

**Severity: Critical.** The strategy says "Xero owns invoices, payments, quotes, GST" —
but there is no bridge, so today *nobody* owns them. Every job ends with someone
re-keying a PDF's line items into Xero by hand: slow, error-prone, and a GST/BAS risk.
The billing loop — the one loop every business must close — is open.

**Business case.** This is the highest-leverage finance move available that *doesn't*
turn Flow into an invoicing product. One integration closes gaps #1 (invoice entities —
Xero's), #2 (deposits/partial invoicing — Xero's), and most of #5 (tax handling —
mapped, not owned). AU market context: Xero is the default SME ledger here, so this is
also the single most-asked evaluation question an AU rental company will have.

**Implementation blurb.** OAuth2 connect in org settings → a "Send to Xero" action on a
project (probably gated to `READY_TO_INVOICE`/`COMPLETED`): map line items → Xero draft
invoice lines (rental lines to a configurable revenue account, GST class from org
default), store `xeroInvoiceId` + sync status back onto the project, and flip
`INVOICED` only on successful push. Keep a minimal immutable snapshot of what was sent
(amounts + line hashes) for audit — that's a log, not an Invoice model. Later phases:
payment-status webhook back from Xero, sub-hire costs → Xero bills (closes the AP half
of #7 and part of #9).

### 2. Two-clock scheduling — usage vs warehouse period (gap #10)

**Severity: Critical.** With one clock, availability is *wrong* whenever a job needs
prep, travel, or return-processing days — i.e. on most real shows. Gear that is
physically in a case on a truck on Thursday shows as available for a Friday hire.
This is the exact failure mode that ends with gear not on a truck, and it undermines
the product's strongest claim (warehouse correctness).

**Business case.** Every serious competitor models this because every warehouse works
this way. Unlike most Rentman features, this one isn't office polish — it's the
correctness substrate under availability, conflicts, shortages, and ROI-day counts.
It also gets *more* expensive the longer it waits, because more features key off the
single window.

**Implementation blurb.** Phase it. **Phase A (cheap, 80% of value):** add optional
`warehouseStartDate`/`warehouseEndDate` on Project, defaulting to rental window ± an
org-configurable buffer (e.g. 1 day each side); switch `overbooking-core.ts` and the
conflict engine to the warehouse window; keep all display/pricing on the usage window.
**Phase B (only if needed):** per-line date overrides — deliberately deferred; the
gap analysis notes line-level dates were an explicit non-goal (`59-bulk-operations.md`),
and project-level two-clock alone fixes the correctness hole.

### 3. Cross-project shortages screen (gap #13)

**Severity: High.** "What are we short next week, across all jobs?" is the daily 8am
warehouse-manager question, and today the only answer is opening every project and
reading badges. The per-add sub-hire pre-check catches shortages at booking time but
nothing re-surfaces them as bookings shift afterwards.

**Business case.** Best value-for-effort item on the whole list: the availability
engine, badges, and sub-hire flow all already exist — this is a rollup query and one
page, not new physics. It also compounds with #2 above (a shortage screen over the
warehouse window is dramatically more truthful) and makes the already-rich sub-hire
module (dual pricing, rate comparison — better than Rentman's per-order) discoverable
instead of dialog-only.

**Implementation blurb.** A `/shortages` page: for a selectable date range, run the
existing overbooking computation across all non-template, active-status projects,
aggregate per model (shortage qty, dates, contributing projects), and add row actions
"Create sub-hire" (prefilled dialog — already exists) and "Open project". A dashboard
needs-attention chip ("3 models short in the next 14 days") for free.

### 4. Tiered / multi-day pricing (gap #4)

**Severity: High.** The industry quotes in day-factors ("3-day week", weekly caps,
long-hire degression). Flat `unitPrice × qty × duration` with a hand-typed duration
multiplier means every real quote is either overpriced or manually fudged per line —
which contradicts the repo's own "server is the authority on price" rule (R-9.3) and
makes quoting slower and less consistent than a spreadsheet.

**Business case.** Quoting speed and consistency is the office workflow we *do* need
even while Xero owns the ledger — Flow generates the quote PDF, so Flow must price
correctly. Note the history: the billing-weeks optimizer was removed June 2026, so the
previous attempt was judged not worth its complexity. The fix is a simpler, standard
primitive (a factor table), not a resurrection of the optimizer.

**Implementation blurb.** One org-level `RateTier` table (bands of chargeable days →
factor, e.g. 1d=1.0, 2d=1.8, 3–7d=3.0, +1.0/wk after), optional per-model override
group later. On line add/date change the server computes `factor(duration)` and stores
it on the line (snapshotted, overridable with an "edited" marker). PDFs show
"3 days @ 3-day-week rate". Client-specific rate cards are a later, demand-driven
extension — start with `Client.defaultDiscount`, which is *already stored and wired to
nothing*.

### 5. Client-facing quote acceptance (gap #3)

**Severity: High.** Today a project advances to CONFIRMED via an internal button —
there is no record the client ever saw or approved anything. That's a commercial-
dispute hole ("I never approved that dry-hire cost") and it leaves the quote PDF as a
dead end instead of a conversion tool.

**Business case.** This is the one piece of "office" the operational wedge genuinely
needs, and it's cheap for us specifically: the tokenised no-login external view is an
already-proven pattern (T&T auditor view, warehouse TV display). View tracking ("client
opened the quote twice yesterday") is a real sales signal Rentman charges for. Full
e-signature is *not* required for v1 — click-to-accept with captured name/timestamp/IP
is standard and legally serviceable for rentals.

**Implementation blurb.** "Publish quote" on a project → snapshot the quote PDF +
totals, mint a tokenised link (`/quote/{token}`), email it via existing Resend infra.
The page shows the PDF + Accept/Decline; acceptance stamps `acceptedAt/by` on the
snapshot, auto-advances the project to CONFIRMED, logs activity, and notifies the
account manager. Expiry date on the token. Versioning = publish again (new snapshot
supersedes, old ones retained).

### 6. Project-less scan-return station (gap #28)

**Severity: High.** The physical reality of returns is a truck unloading mixed gear
from several jobs at once. Forcing the operator to pick a project before every scan
makes the messiest warehouse moment slower and error-prone — and returns are where
gear gets lost. The gap analysis calls the warehouse floor "close to won"; this is the
biggest remaining hole in it.

**Business case.** Directly serves the differentiator (warehouse depth) rather than
chasing Rentman's office. Most of the machinery exists: per-unit deployment records
mean a scanned tag can be resolved to its open project automatically, and the dormant
bulk check-in backend (⚠️ `52-bulk-checkin.md`) covers the bulk-quantity path.

**Implementation blurb.** `/warehouse/return`: one scan field. Each scan resolves the
asset's active deployment → checks it into its project via the existing check-in
mutation, appends to a running "returned this session" list (project, item, condition
prompt on flagged models), beeps (see quick win QW-1), and honours existing check-item
gates. Unresolvable scans (no active deployment) drop into an exceptions list instead
of blocking the line at the dock. Bulk items: scan model tag → qty prompt, backed by
the dormant bulk check-in totals backend.

---

## Tier 2 — Build next (high worth, not existential)

| Gap | What | Severity | Worth | Business case & shape |
|---|---|---|---|---|
| #34 | **Recurring general maintenance schedules** (+ scheduled maintenance reserving stock) | High | High | Compliance/asset-care posture is our wedge, yet recurrence exists only inside T&T. Generalise the T&T recurrence machinery: per-model/asset service interval → cron-generated due maintenance records → "due for service" worklist. Fold in the availability nuance the gap analysis flags: *scheduled* maintenance should subtract from bookable stock, not just current status. |
| #36 ⚠️ | **Slim canned reports** | Med-High | High | The report *builder* was removed for good reason (complexity), but "revenue by client/quarter", "sub-hire spend by supplier", "utilisation by model", "crew hours" are owner questions a rental business answers monthly. Reinstate 6–8 fixed reports with date range + CSV, reusing the removed library's queries where salvageable. No builder, no saved views. |
| #9 | **Supplier-facing PO document/email for sub-hires** | Med-High | High | The sub-hire module is commercially richer than Rentman's per-order, but the actual *order* still leaves the system by hand-written email. Generate a PO PDF from a `SubHire` (existing PDF pipeline), email to supplier via Resend, link `SubHire → SupplierOrder` (the missing FK). Receiving-into-stock can wait. |
| #23 | **Crew conflict badges in the service crew picker** | Med-High | High | Already a documented gap (#796 follow-up). The *primary* crew-add path shows no conflict warnings — that's how crew get double-booked. Surface the existing conflict computation in that picker. The full "rank matching crew" engine is a later, separate bet. |
| #14 | **Option holds (soft booking)** | Medium | Medium | "Pencilled" gear is a real AV workflow (hold for an unconfirmed show). Model as a per-line or per-project `HOLD` flag that shows in availability/shortage views as a distinct soft layer (doesn't hard-reserve, does warn on collision). Cheap once #13's shortage surface exists. |
| #42 | **Multiple contacts per client** | Medium | Medium | One embedded contact per client doesn't survive contact with a real production company (production manager ≠ accounts payable ≠ venue tech). A `ClientContact` child table + role tag; quote email and Xero contact mapping pick the right one. |
| #26 ✅ | **Crew charge rates** | Medium | Medium | **Shipped 2026-07-26 (WS10, tracking issue #949).** Labour is revenue for a production company, but Flow only knew crew *cost* — labour margin was invisible and every labour line was hand-priced. Added `crewRoles.chargeRate` (per-role) + `projectServices.chargeRateOverride` (per-service override), auto-priced labour service lines from assigned crew/roles via `recalcServiceChargeFromCrew`, margin surfaced on `ServiceCard`/services summary/P&L (manager+ gated), and the `/crew/settings` roles admin page (previously a documented-but-nonexistent route). See FEATUREDOCS/31 "Charge Cascade & Margin". |
| #8 | **Sale/consumable line type** | Medium | Medium | Tape, batteries, rigging consumables are genuinely sold on most jobs. A `SALE` line type that decrements bulk stock and never expects return — small model change, closes a daily papercut. The full "sales shortages" apparatus: skip. |

## Tier 3 — Defer until there's pull

| Gap | What | Severity | Worth | Why deferred |
|---|---|---|---|---|
| #16/#17 | Multi-warehouse stock + transfers | Low (today) | Low now | Heavy architecture (availability, prep, check-in all become warehouse-scoped). Worth nothing for a single-warehouse operation; existential only if Flow sells to multi-site companies. Revisit on real demand — and sequence *after* two-clock, which touches the same engine. |
| #39 ⚠️ | Public API + MCP | Medium | Medium | Removed 2026-07-14 as dormant with a reinstatement blueprint. Reinstate when a concrete integration needs it, not before. |
| #24 | Crew self-service (offer inbox, job board) | Medium | Medium | Already planned as Phase 7. Tokenised email offers + iCal cover the core today. |
| #29 ⚠️ | Camera scanning | Medium | Medium | Removed for iOS reliability — a fact, not a priority call. Revisit via native `BarcodeDetector` / a maintained lib; HID wedge scanners cover the floor meanwhile. |
| #19 ⚠️ | Stocktakes | Low-Med | Low-Med | Deliberately deleted June 2026; respect that call. If insurance/EOFY pressure returns, reinstate as a lightweight count session, not the old full module. |
| #35 ⚠️ | Repair board / damage capture | Low-Med | Low-Med | Maintenance records already hold/release stock correctly. A raise-repair-from-scan shortcut (fits the #28 station's exceptions list) is the useful sliver; the Kanban stays deleted. |
| #22 | Vehicles & transport planning | Low-Med | Low | Explicitly out-of-wedge (`app-cleanup-unification.md`). If pull appears, start with a vehicle register + assignment on delivery services — never a transport Gantt. |
| #47 | Physical dims / transport volume | Low | Low | Only matters feeding transport planning (#22) or rig-weight totals; models already carry weight. |
| #15, #20, #21, #6, #11, #12, #25, #27, #31, #33, #37, #43*, #44 ⚠️, #46 | Alternatives, lost register, stock ledger, est/planned/actual, subprojects, Gantt, leave requests, crew expenses, custom warehouse statuses, cross-docking, dashboard widgets, cross-entity tasks, template builder, history snapshots | Low | Low | Individually explicable; none blocks a core loop; several (fixed lifecycle, fixed doc types) are simplicity *features* of Flow, not gaps. *#43's "my tasks" rollup is extracted as a quick win below.* |

## Skip deliberately (anti-goals — where "not a Rentman copy" is the point)

| Gap | What | Why we skip it |
|---|---|---|
| #1, #2 | Full Quote/Invoice/Payment/deposit entities | Xero owns finance (ROADMAP). Tier-1 item 1 (Xero push) + item 5 (quote acceptance snapshot) close the loops without building a ledger. Delete or wire the dead `depositPercent`/`depositPaid` fields (QW-4). |
| #40 | Webshop / public catalog | Different strategy: WooCommerce ingests orders *into* Flow. Running a storefront is a product we don't want to own. |
| #41 | Inbound email / comms log | Explicit non-goal already; email clients are better at email. |
| #38 | Custom roles, seat licensing | `CustomRole` was removed; five fixed roles are enough for the current deployment model. SaaS-only concern. |
| #45 | "Fill in with AI" | Not a workflow gap. If ever done, do it where we're differentiated (e.g. quote-text from project data), not as parity. |
| #31, #44 | Custom warehouse statuses, template builder | Opinionated fixed lifecycle + eight correct doc types is Flow's strength; configurability here reintroduces the complexity that was deliberately deleted. |

## Quick wins (days, not weeks — batch into one hygiene pass)

> **Update 2026-07-26 (tracking issue #937):** QW-1 and QW-3 accepted — QW-3
> widened into a dashboard overhaul (my work first, org risk second, counters/
> activity demoted; still a fixed layout, no widget boards). QW-4 re-reviewed:
> only `Client.defaultDiscount` gets wired now; the deposit/invoice fields are
> **reserved for the #934 WS1 finance model** and must not be deleted. QW-2 not
> scheduled this round.

- **QW-1 — Scan beep in warehouse flows** (#30): the audio-feedback code exists in the
  T&T wizard; lift it into prep/deploy/return scanning. Head-down scanning needs ears.
- **QW-2 — Per-project QR on warehouse hub cards** (#32): QR generation exists
  per-asset; render one per hub card → deep-link to that project's prep screen.
- **QW-3 — "My tasks" cross-project rollup** (#43): the query "was never shipped";
  a single page + sidebar link.
- **QW-4 — Wire or delete dead commercial fields** (#2, #5): `Client.defaultDiscount`
  → apply as default project discount on create; `depositPercent`/`depositPaid` →
  delete unless Tier-1 item 1 uses them for Xero deposit invoices. Dead fields that
  look wired are R-3.1-style defects.

## Suggested sequencing (dependency-aware, not a commitment)

1. **Quick wins pass** (QW-1..4) — one small PR-sized batch.
2. **Shortages screen** (T1-3) — highest value:effort, no schema risk.
3. **Two-clock Phase A** (T1-2) — before multi-warehouse or any further availability
   work; shortages screen then reads the warehouse window.
4. **Tiered pricing** (T1-4) → **Quote acceptance** (T1-5) → **Xero push** (T1-1) —
   the commercial chain in order: price it right, get it accepted, bill it.
5. **Scan-return station** (T1-6) — anytime; independent of the above.
6. Tier 2 by pull, starting with recurring maintenance (#34) and the crew-picker
   conflict badges (#23).
