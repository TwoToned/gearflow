# Glossary

> _Owner: Jayden Nawotka · Last reviewed: 2026-07-23 (review quarterly — POLICY.md R-5.5)_

Core domain terms used across code, schema, and UI copy (POLICY.md R-3.10 — "one
name per domain concept"). If you're adding a new domain concept, add it here in
the same PR; if you're introducing UI copy that reads differently from the
underlying code term, document the alias here instead of letting it drift silently.

For the file-by-file breakdown of where each concept lives, see the
[FEATUREDOCS index](../ARCHITECTURE.md#feature-documentation).

## Core entities

| Term | Meaning |
|---|---|
| **Asset** | A serialized, individually tracked item with its own tag and status lifecycle (`Asset` model). |
| **Bulk asset** | A quantity-tracked item with no individual identity — `totalQuantity`/`availableQuantity` (`BulkAsset` model). |
| **Kit** | A container of serialized + bulk assets that travels and prices as one unit (`Kit` model). See [09-kits.md](../FEATUREDOCS/09-kits.md). |
| **Model** | The equipment type/spec an asset or bulk asset is an instance of (e.g. "Shure SM58"), independent of any single physical unit. |
| **Project** (UI: **Job**) | A rental job (the UI says **Job** since UX Phase 0, D7; code, routes, enums and API/MCP names stay `project`): line items, dates, a client, and a warehouse deploy/return lifecycle. See [10-projects.md](../FEATUREDOCS/10-projects.md). |
| **Line item** | A single row on a project — an asset, bulk quantity, kit, sub-hire, or custom item being rented. |
| **Client** | The renting party (a customer of the operator's rental business). Code, schema, and UI all say **client**, never "customer" — see [Documented aliases](#documented-aliases). |
| **Supplier** | A third-party vendor the operator buys from or sub-hires gear from. See [22-suppliers.md](../FEATUREDOCS/22-suppliers.md). |
| **Sub-hire** | Gear rented in from a supplier to cover a project, tracked with both cost (paid to supplier) and charge (billed to client) pricing (`SubHire` model). See [39-sub-hires.md](../FEATUREDOCS/39-sub-hires.md). |
| **Crew** | A person (employee, freelancer, contractor, or volunteer) who can be assigned to project work. See [31-crew-management.md](../FEATUREDOCS/31-crew-management.md). |
| **Organization (org)** | The tenant — one operator's rental business. All domain data is org-scoped; see [04-auth-permissions.md](../FEATUREDOCS/04-auth-permissions.md). |
| **Member** | A user's membership + role within an organization (distinct from a user's site-wide role — see **Site admin** below). |
| **Site admin** | A platform-level role (`User.role === "admin"`) that can manage the whole install across organizations, distinct from an org **Member**'s `role`. |

## Warehouse & lifecycle

| Term | Meaning |
|---|---|
| **Deploy** | UI verb for checking an asset **out** of the warehouse onto a job. The resulting `CHECKED_OUT` status displays as **Out** (D90; formerly "Deployed"). See [12-warehouse.md](../FEATUREDOCS/12-warehouse.md). |
| **Home** (UI) | The landing page and module name for `/dashboard` (D66); formerly "Dashboard". The customizable widget board is still the dashboard feature (FEATUREDOCS/81). |
| **Schedule** (UI) | The gear availability calendar at `/availability` (D7); formerly "Availability". The crew *Availability* tab (blocks) is a different thing and keeps its name. |
| **The floor** (UI) | The warehouse landing page (`/warehouse`): five DERIVED stage columns `To pick · Prepping · Ready · Out · Returning` (`warehouseStage()`, never stored). See [12-warehouse.md](../FEATUREDOCS/12-warehouse.md). |
| **Returning mode** (UI) | The floor's returns desk (`/warehouse?mode=returning`), formerly the "returns station" page (`/warehouse/returns`, now a redirect). Outcome words: `Out · Returned · Damaged · Missing · Late`. |
| **Packer** | The member who packs a job (`projects.packerUserId`, set by `setPackerNative`). The floor's `Mine` = PM or packer. |
| **Pull sheet** | The printable pick list for a job, a dialog on the warehouse job (`?doc=pull-sheet`). The same list as the pull-slip PDF. |
| **Loose** (UI) | Gear not in a case (replaces "Not planned" / "No container"). |
| **Unplanned** (UI) | A line with no case planned for it on the job's Packing tab. A PLAN state; **Loose** is the PHYSICAL state (gear not in a case). A line can be Unplanned and Loose, or Planned and still Loose. |
| **Sealed** (UI) | A packing case whose plan is locked (`projectContainers.sealedAt`): nothing is planned into or out of it until unsealed. Does not touch the warehouse. |
| **Return** | UI label for checking an asset **in** from a project back to the warehouse. |
| **Active** (UI, Jobs segment) | Booked + Out jobs (`AWAITING_PAYMENT`, `CONFIRMED`, `PREPPING`, `CHECKED_OUT`, `ON_SITE`), D86. The same set Home's Active jobs tile counts. See [10-projects.md](../FEATUREDOCS/10-projects.md). |
| **Overdue return** | A job that is not closed, is past its end date, and still has gear `CHECKED_OUT` on its live version (`convex/lib/overdueReturns.ts`). Judged by the gear, not the status word. Home's tile counts these jobs; the Jobs filter `Returns: Overdue` (`?overdue=1`) lists them. |
| **Docket** | A delivery or return document generated for a project (delivery docket / return docket) — see [13-pdfs.md](../FEATUREDOCS/13-pdfs.md). |
| **Prep container (prep)** | The legacy free-text label for a case during pick/prep (`prepContainer`). Superseded by the first-class packing container (`projectContainers`; membership on the unit): see [83-packing-containers.md](../FEATUREDOCS/83-packing-containers.md). |
| **Check item** | A pass/fail, measurement, notes, or dropdown quality check performed on an asset during deploy/return. See [37-check-items.md](../FEATUREDOCS/37-check-items.md). |
| **Test & Tag (T&T)** | AS/NZS 3760:2022 electrical safety compliance testing on assets. See [14-test-and-tag.md](../FEATUREDOCS/14-test-and-tag.md). |
| **Scan page** (UI) | `/scan` (NAV Warehouse › Scan): scan one tag and act on it, outside a job. Two modes as stage words, `Check` (the ad-hoc check, formerly `/check/[assetTag]`) and `Test & tag` (formerly the quick-test wizard); both old routes redirect in. **Last scans** is its per-session list of what was scanned and saved. See [37-check-items.md](../FEATUREDOCS/37-check-items.md) and [14-test-and-tag.md](../FEATUREDOCS/14-test-and-tag.md). |
| **Child asset / accessory** | An asset permanently attached to a parent serialized asset (e.g. a cable to a fixture) so it travels with it through projects and warehouse flows (`isKitChild`, `childKind`). See [48-child-assets-accessories.md](../FEATUREDOCS/48-child-assets-accessories.md). |
| **Default accessory** | A model-level bulk accessory with `inclusion: "DEFAULT"` (or absent — zero-migration) — auto-attaches when the model is added to a project; the PM can deselect it per line without touching the model template. See [48-child-assets-accessories.md](../FEATUREDOCS/48-child-assets-accessories.md). |
| **Optional accessory** | A model-level bulk accessory with `inclusion: "OPTIONAL"` — never auto-attaches; offered as an opt-in pick in the add-time Accessories section. |
| **Accessory plan** | `ProjectLineItem.accessoryPlan` — the durable per-line override of the model's default/optional accessory template (`{ excluded, added }`). Resolved by `resolveLineAccessoryPlan`, the single function every accessory-expansion site (office add, warehouse prep, warehouse checkout) consults. |

## Project lifecycle locks

| Term | Meaning |
|---|---|
| **Lock tier** | One of `OPEN` / `FINANCE_LOCKED` / `JUSTIFY` / `HARD_LOCKED`, resolved from a project's status by `lockTierForStatus()` (`convex/lib/projectLocks.ts`) — the single boundary every gate site shares. See [62-project-lifecycle-locks.md](../FEATUREDOCS/62-project-lifecycle-locks.md). |
| **Finance soft-lock** | The FINANCE_LOCKED+ restriction (CONFIRMED and later) rejecting locked money-field edits without an open unlock session; new adds default to $0 while locked. |
| **Hard lock** | The HARD_LOCKED restriction (COMPLETED/INVOICED) blocking all structural + financial mutations outright, with no per-edit path — only a FULL unlock session. |
| **Unlock session** | A project-level `{ scope: FINANCIAL \| FULL }` session (`projectUnlockSessions`) opened with a required justification; while open, gated writes pass and are audit-tagged with the session id. Closed via "Save & relock" (commit) or "Discard changes" (restore from the session's opening snapshot). |
| **Project snapshot** | A versioned, whole-project capture (`projectSnapshots` + `projectSnapshotEntries`) taken on every crossing into CONFIRMED/COMPLETED and at every unlock-session open — the source for the Versions/diff UI and for an unlock session's discard restore. |
| **Justification** | A required, bounded (10–1000 char) free-text reason persisted to the audit row's `metadata` for a structural mutation on a JUSTIFY-tier (ON_SITE+) project, or for opening an unlock session / reverting out of a hard lock. |

## Documented aliases

Per R-3.10, an alias between layers is only acceptable if it's documented here
with the mapping and the reason — otherwise it's a synonym-drift defect.

| Code/schema term | UI/copy term | Where it appears | Reason |
|---|---|---|---|
| `client` | "Customer" | WooCommerce integration payload fields only (`customer_*`) | The renting party is called **client** everywhere in this codebase; `customer_*` is WooCommerce's own external field naming and isn't renamed on ingestion. See [35-woocommerce-integration.md](../FEATUREDOCS/35-woocommerce-integration.md) and [CONTRIBUTING.md](../CONTRIBUTING.md). |
| `CHECKED_OUT` / `CHECKED_IN` (status) | "Deploy" / "Return" | Warehouse UI | The DB status enum predates the UI relabel; both names refer to the same lifecycle transition. See [12-warehouse.md](../FEATUREDOCS/12-warehouse.md). |
| `DISPUTED` (`TimeEntryStatus`) | "Queried" (status) / "Query…" (verb) | Every timesheet status word (`timeEntryStatusLabels`), the timesheets Query… verb | UX Phase 15 (D47): a manager asks the crew member to check an entry, it is not a dispute. The enum and API values stay `DISPUTED`; the reason lives on `crewTimeEntries.queryReason`, never `notes`. The legacy "Dispute" verb on the crew dashboard and crew record moves to Query… in Phase 13. See [31-crew-management.md](../FEATUREDOCS/31-crew-management.md). |
| (derived, not stored) crew list status | **Unconfirmed · On a job · Available · On leave · Inactive** | The Crew list's Status column and strip (`convex/lib/crewListFacts.ts`) | UX Phase 13 (D38/D40): derived on read from the member's calls and stored status, never a column. Unconfirmed = a live call at PENDING / OFFERED / ACCEPTED; "this week" is the next seven days. `Inactive` covers the stored `INACTIVE` and `ARCHIVED`. See [31-crew-management.md](../FEATUREDOCS/31-crew-management.md). |
| `FAIR` (`assets.condition` / `kits.condition`) | "Worn" | Every condition label (`conditionLabels` in `src/lib/status-labels.ts`), the Scan page's check condition words `Good · Worn · Damaged` | D50 (owner, 2026-11-21): the ad-hoc check's three words map onto the five-value enum — Good = `NEW`/`GOOD`, Worn = `FAIR`/`POOR`, Damaged = `DAMAGED`; a check stores `GOOD`/`FAIR`/`DAMAGED` and only when the word changes. One mapping: `convex/lib/assetCondition.ts`. The enum value is unchanged. |
| `packing-list` (`ProjectDocumentType`) | "Pick slip" / "Pull slip" | Agent API/MCP tool descriptions (`get_project_document`), session route's `pull-slip` query param | One PDF layout, three names in the wild — the type/schema value is `packing-list`; never introduce a fourth. See [13-pdfs.md](../FEATUREDOCS/13-pdfs.md) and [56-api-mcp.md](../FEATUREDOCS/56-api-mcp.md). |
| `archiveNative` / `RETIRED` (assets, bulk assets) | "Retire" / "Retired" / "Reinstate" | The asset ⋯ menu, the Assets list, toasts | UX Phase 12 (D33): the verb is **Retire** everywhere in the UI, matching the `Retired` segment and the `RETIRED` status. The mutation keeps the name `archiveNative` (API/MCP stability). For a **model**, Archive stays Archive (a soft archive; assets stay), with `Restore model`. See [08-assets.md](../FEATUREDOCS/08-assets.md). |
| `assetType` `SERIALIZED` / `BULK` | "Serialised unit" / "Bulk stock" | The asset sheet's words (D63), the model header | One create surface for both kinds; the enum values are unchanged. |
