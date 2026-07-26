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
| **Project** | A rental job: line items, dates, a client, and a warehouse deploy/return lifecycle. See [10-projects.md](../FEATUREDOCS/10-projects.md). |
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
| **Deploy** | UI label for checking an asset **out** of the warehouse onto a project (`CHECKED_OUT` status displays as "Deployed"). See [12-warehouse.md](../FEATUREDOCS/12-warehouse.md). |
| **Return** | UI label for checking an asset **in** from a project back to the warehouse. |
| **Docket** | A delivery or return document generated for a project (delivery docket / return docket) — see [13-pdfs.md](../FEATUREDOCS/13-pdfs.md). |
| **Prep container (prep)** | A visual grouping label applied to assets during the pick/prep phase of warehouse operations. Not backed by a kit — just a string field on the line item. See [32-preps.md](../FEATUREDOCS/32-preps.md). |
| **Check item** | A pass/fail, measurement, notes, or dropdown quality check performed on an asset during deploy/return. See [37-check-items.md](../FEATUREDOCS/37-check-items.md). |
| **Test & Tag (T&T)** | AS/NZS 3760:2022 electrical safety compliance testing on assets. See [14-test-and-tag.md](../FEATUREDOCS/14-test-and-tag.md). |
| **Child asset / accessory** | An asset permanently attached to a parent serialized asset (e.g. a cable to a fixture) so it travels with it through projects and warehouse flows (`isKitChild`, `childKind`). See [48-child-assets-accessories.md](../FEATUREDOCS/48-child-assets-accessories.md). |
| **Default accessory** | A model-level bulk accessory with `inclusion: "DEFAULT"` (or absent — zero-migration) — auto-attaches when the model is added to a project; the PM can deselect it per line without touching the model template. See [48-child-assets-accessories.md](../FEATUREDOCS/48-child-assets-accessories.md). |
| **Optional accessory** | A model-level bulk accessory with `inclusion: "OPTIONAL"` — never auto-attaches; offered as an opt-in pick in the add-time Accessories section. |
| **Accessory plan** | `ProjectLineItem.accessoryPlan` — the durable per-line override of the model's default/optional accessory template (`{ excluded, added }`). Resolved by `resolveLineAccessoryPlan`, the single function every accessory-expansion site (office add, warehouse prep, warehouse checkout) consults. |

## Documented aliases

Per R-3.10, an alias between layers is only acceptable if it's documented here
with the mapping and the reason — otherwise it's a synonym-drift defect.

| Code/schema term | UI/copy term | Where it appears | Reason |
|---|---|---|---|
| `client` | "Customer" | WooCommerce integration payload fields only (`customer_*`) | The renting party is called **client** everywhere in this codebase; `customer_*` is WooCommerce's own external field naming and isn't renamed on ingestion. See [35-woocommerce-integration.md](../FEATUREDOCS/35-woocommerce-integration.md) and [CONTRIBUTING.md](../CONTRIBUTING.md). |
| `CHECKED_OUT` / `CHECKED_IN` (status) | "Deploy" / "Return" | Warehouse UI | The DB status enum predates the UI relabel; both names refer to the same lifecycle transition. See [12-warehouse.md](../FEATUREDOCS/12-warehouse.md). |
