# RVLT Flow — domain model & vocabulary

Precise meanings for the things you will be asked about. When a term is
ambiguous in a request, resolve it here before acting; the same English word
("kit", "item", "booking") maps to several different rows.

## Contents

- [Inventory](#inventory)
- [Jobs and line items](#jobs-and-line-items)
- [Availability](#availability)
- [Warehouse stages](#warehouse-stages)
- [Crew and services](#crew-and-services)
- [Suppliers and sub-hires](#suppliers-and-sub-hires)
- [Compliance: test & tag, maintenance, check items](#compliance-test--tag-maintenance-check-items)
- [Clients](#clients)
- [Roles and permissions](#roles-and-permissions)
- [Status tables](#status-tables)

## Inventory

The inventory has a deliberate three-level shape. Getting the level right is
most of getting the answer right.

**Model** — the *type* of thing. "Shure SM58", "Martin MAC Aura". Carries the
spec, images, manuals, default day/week rates, replacement cost, weight, power
draw, and the test & tag / maintenance intervals its units inherit. A model has
no physical existence. When someone asks "do we have SM58s?", they are asking
about a model's stock.

**Asset (serialised)** — one physical unit with its own tag and identity.
Tracked individually: status, condition, location, serial, purchase info, test &
tag dates, photos, full history of which jobs it has been on. Used for anything
high-value or uniquely identifiable — consoles, fixtures, projectors.

**Bulk asset** — quantity-tracked stock with no individual identity. Cables,
adaptors, gaffer, generic mics. Has `totalQuantity` / `availableQuantity` and a
reorder threshold; every unit shares one tag. You cannot ask "where is *that*
XLR" — only "how many are free".

A model is one or the other (`SERIALIZED` | `BULK`). If a question needs a
specific unit, it only makes sense for a serialised model.

**Kit** — a container of assets and bulk stock that travels and prices as one
unit ("Wireless rack A"). On a job it collapses to a single line for the client
but explodes to its members on warehouse documents, because packers need every
component.

**Accessory / child asset** — an item permanently attached to a parent so it
travels with it (the clamp with the fixture, the cable with the mic). A model
can define **default** accessories (auto-attach when the model is added to a
job) and **optional** ones (offered, never automatic). A PM can deselect a
default per line without touching the model template. Accessories never print
their own price on a client document — the parent line is the charge.

**Location** — warehouse, venue, vehicle or offsite store. Where a unit
currently physically lives.

## Jobs and line items

**Project (a "job")** — the operational unit: a gig, show, install or tour. Has
a client, a venue, two date windows (see SKILL.md), a project manager, a status,
a type, notes at three visibility levels (crew / internal / client-facing), and
line items. Numbered sequentially per org.

Types: `DRY_HIRE` (gear only), `WET_HIRE` (gear plus crew), `INSTALLATION`,
`TOUR`, `CORPORATE`, `THEATRE`, `FESTIVAL`, `CONFERENCE`, `OTHER`.

**Line item** — one row on a job. Types: `EQUIPMENT`, `SERVICE`, `LABOUR`,
`TRANSPORT`, `MISC`, `SALE`. Only `EQUIPMENT` lines physically move through the
warehouse; the rest sit at `CONFIRMED` for the life of the job. This is why a
job full of labour lines does not get stuck at `PREPPING`.

A line carries quantity, unit price, duration, an optional discount, a status,
and — for equipment — a model and optionally a specific asset or bulk asset.
Lines can be marked **optional** (the client hasn't taken it), which keeps their
stock hold pencilled even on a confirmed job.

**Project group** — a bundle priced as one line ("FOH audio package"). The group
hides its contents behind a typed bundle price. Selected members can be
*disclosed* on a document — listed with description and quantity under the group
row — but never with their own price, because the bundle price is the charge.

**Category rollup** — a category can print one derived subtotal for the whole
section with every line still listed and money columns blank. Different from a
group: a group hides its contents, a rollup shows them. A single row can be
revealed back into printing its own price, and is still counted in the section
subtotal.

**Prep container ("prep")** — a grouping label applied during picking, e.g.
"Case 3". Not a kit, just a label on the line. Used to organise the pick and the
packing list.

## Availability

Stock arithmetic that every availability answer rests on:

- **Total stock** — every unit that exists.
- **Effective stock** — total minus units that cannot be booked: `IN_MAINTENANCE`,
  `LOST`, `RETIRED`, `SOLD`. **Effective stock is the only number that should be
  used for availability.** Raw total always overstates what you can actually
  send. For bulk models, effective stock is the summed quantity.

A booking conflicts when two jobs' **gear-committed windows** overlap and the
combined demand exceeds effective stock.

**Pencilled vs hard:**

- Pencilled statuses: `ENQUIRY`, `QUOTING`, `QUOTED`. The gig itself is
  speculative, so *every* line stays a soft hold.
- Hard statuses: `AWAITING_PAYMENT`, `CONFIRMED`, `PREPPING`, `CHECKED_OUT`,
  `ON_SITE`. Every non-optional line hard-holds. An optional line stays
  pencilled regardless.
- `RETURNED`, `COMPLETED`, `INVOICED`, `CANCELLED` release stock entirely.

An unrecognised status is treated as pencilled, never silently promoted to hard.

**Overbooking** is the state where demand exceeds effective stock for a window.
It is visible and permitted — Flow warns rather than blocks, because sometimes
you genuinely intend to sub-hire the difference. That means an overbooking
appearing on a board is a *decision waiting to be made*, not automatically a
mistake.

## Warehouse stages

A top-level equipment line sits in exactly one stage:

| Stage | Meaning |
|---|---|
| **Pick/Prep** | Still needs picking and/or packing. |
| **Deploy** | `PACKED` and waiting to go out. |
| *(deployed)* | `CHECKED_OUT` — out of the building. |
| **Returned** | Physically back but still packed. |
| **De-prepped** | Unpacked and checked back into stock. Terminal. |

Bulk lines are quantity-aware: a line shows in Pick/Prep while *any* ordered
unit is still unpacked, even once some units are already packed or deployed. So
a partially picked bulk line legitimately appears in two mental buckets at once
— that is not a bug, and "the line is in Deploy" does not mean all of it is.

Kit parents have no state of their own; their stage rolls up from members. An
accessory parent is a real asset that *also* has children, so its stage
considers both its own state and its children's.

## Crew and services

**Crew member** — a person who can be assigned to work: employee, freelancer,
contractor or volunteer. Has a role, contact details, rates and active status.

**Crew assignment** — one person on one job for a date/time window, optionally
with a role, phase and rate override. Statuses: `OFFERED` → `ACCEPTED` /
`DECLINED`. An `OFFERED` assignment still unanswered after 48 hours is
surfaced as needing attention — treat it as a probable no and chase.

**Service** — a unit of work on a job (a bump-in, an operate, a de-rig) with a
required crew count. A service that is still `PLANNED`, or staffed below its
`crewCountRequired`, is a readiness warning. The *work* being unconfirmed and
the *people* not having said yes are separate problems with separate fixes —
report them separately.

A crew-attached service's cost auto-derives from the crew rate table; a
crew-less service's cost is typed.

## Suppliers and sub-hires

**Supplier** — a third party you buy from or rent in from.

**Sub-hire** — gear rented in to cover a job, with **dual pricing**: a cost (what
you pay the supplier) and a charge (what you bill the client). The margin
between them is the point, and it is why a sub-hire that solves an availability
problem still has a financial consequence worth mentioning.

Order statuses: `DRAFT` → `CONFIRMED` → (`ON_HIRE`) → `RETURNED`, with
`CANCELLED` available from any active state. `DRAFT → CONFIRMED` requires the
order be attached to a job. `ON_HIRE` is set by warehouse operations, not from
the sub-hire dialog.

A sub-hire can be itemised or priced as one order total, can be grouped, and can
be shown or hidden on client documents. Sub-hired items become line items on the
job using the same parent/child shape kits use.

## Compliance: test & tag, maintenance, check items

**Test & tag (T&T)** — AS/NZS 3760:2022 electrical safety testing. Each model
carries a test interval; each asset carries its last and next test dates. This
is a legal obligation in Australia. Gear that is out of tag should not go out on
a job — treat an out-of-tag unit on a pick list as a blocker and find a
substitute, not a note to pass along.

**Maintenance record** — repair, preventative, inspection, cleaning, firmware or
T&T work against an asset. Statuses: `SCHEDULED`, `AWAITING_PARTS`,
`IN_PROGRESS`, `QA`, `COMPLETED`, `CANCELLED`. Results: `PASS`, `FAIL`,
`CONDITIONAL`. An asset `IN_MAINTENANCE` is out of effective stock — which is
exactly why a maintenance record is also an availability event.

**Check item** — a pass/fail, measurement, notes or dropdown quality check
performed on an asset during deploy or return. This is where "came back
damaged" gets recorded at the moment someone can still see the damage.

## Clients

The renting party. Always **client**, never "customer" (the only exception is
WooCommerce's own external `customer_*` field names on ingestion).

Carries contact details, billing and shipping addresses, ABN, payment terms, a
default discount, tags, and — importantly for money — a **tax-exempt** flag with
a reason. An exempt client zeroes tax for the entire job, hard, ahead of every
other rate in the cascade.

## Roles and permissions

Org roles, from most to least privileged: **owner**, **admin**, **manager**,
**staff**, **warehouse**. Separately, a **site admin** is a platform-level role
across organisations — not an org role.

Permissions are `resource:action` pairs over ~20 resources (asset, bulkAsset,
model, kit, project, client, warehouse, testTag, maintenance, location,
document, orgSettings, orgMembers, supplier, subHire, crew, reports, checkItem,
invoice, work).

Two that come up constantly:

- `warehouse:check_out` / `warehouse:check_in` — moving physical gear. Deliberately
  granted to no default API-key preset; an operator grants it on purpose.
- `invoice:*` — the whole finance surface including Xero push and connection
  management, plus recording and voiding payments.

A dedicated `warehouse` role does **not** have `project:update`. This is why
status automation patches the project directly rather than routing through the
normal status-change path — otherwise the returns station would silently fail
for exactly the role it was built for.

## Status tables

**Project:** `ENQUIRY`, `QUOTING`, `QUOTED`, `AWAITING_PAYMENT`, `CONFIRMED`,
`PREPPING`, `CHECKED_OUT` (displayed "Deployed"), `ON_SITE`, `RETURNED`,
`COMPLETED`, `INVOICED`, `CANCELLED`.

**Line item:** `QUOTED`, `CONFIRMED`, `PREPPED`, `CHECKED_OUT`, `RETURNED`,
`CANCELLED`. Plus a separate `prepStatus` whose meaningful value is `PACKED`.

**Asset:** `AVAILABLE`, `CHECKED_OUT` ("Deployed"), `IN_MAINTENANCE`, `RESERVED`,
`RETIRED`, `LOST`, `SOLD`.

**Bulk asset:** `ACTIVE`, `LOW_STOCK`, `OUT_OF_STOCK`, `RETIRED`.

**Kit:** `AVAILABLE`, `CHECKED_OUT`, `IN_MAINTENANCE`, `RETIRED`, `INCOMPLETE`.

**Crew assignment:** `OFFERED`, `ACCEPTED`, `DECLINED`.

**Sub-hire:** `DRAFT`, `CONFIRMED`, `ON_HIRE`, `RETURNED`, `CANCELLED`.

**Quote:** `DRAFT`, `SENT`, `ACCEPTED`, `DECLINED`, plus `EXPIRED` — which is
**derived on read** from the valid-until date, never stored. Always reason about
a quote's *effective* status; a stored `SENT` on a quote whose validity has
lapsed is an expired quote, not a live one.

**Invoice:** `DRAFT` → `ISSUED` → (`VOID`). Payment status `UNPAID`,
`PARTIALLY_PAID`, `PAID` is derived from the invoice's own payment rows.

## Naming: use theirs

| Data term | What people say |
|---|---|
| `CHECKED_OUT` | deployed, out, gone |
| `CHECKED_IN` | returned, back |
| `packing-list` | pick slip, pull slip |
| project | job, gig, show |
| client | client (never "customer") |
| sub-hire | sub, cross-hire |
