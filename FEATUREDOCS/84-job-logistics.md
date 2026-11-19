# Job › Logistics (UX Phase 5a)

The project detail's **Logistics** tab (`?tab=logistics`; `?tab=services` still resolves). It
replaced `ServicesPanel` + `CrewPanel` ("Labour & logistics"). Spec:
`docs/designs/ux-unification-2026-10.md` §8 (both dated notes). Code:
`src/components/projects/logistics/*`, pure model `src/lib/logistics-model.ts`,
`src/lib/logistics-transport.ts`.

## Shape

- **Facts strip** (`facts.tsx`): Rental, Load in, Load out, Venue (+ access note), Site contact.
  Dates open the **dates sheet** (`dates-sheet.tsx`).
- **Lanes** (`lane-bar.tsx`): All · Transport · Site · Labour · Needs crew, plus a By person view and
  a derived `needs you` line (`needsLine(totalsOf(services))`). View, lane and day are local state.
- **Timeline** (`timeline.tsx`): one list per day under a day header (counts, no money), one
  `LineRow` per service. The when / crew / on quote / status columns are facts; crew are read-only
  child rows under their service (LineRow children carry no actions, so crew verbs live in By person).
  Row selection is always-on checkboxes; the **bulk bar** acts on ticks (`Pick crew · N short`,
  `Send N offers`, `Confirm N`, `Set status…`, `Delete`). Status is a row ⋯ item (not a pill menu).
- **AddBar** (`add-service-bar.tsx`, `use-quick-add.ts`): by type and template; Call is a Bump in /
  Bump out choice.
- **Phone day mode** (`day-mode.tsx`): day chips, cards, the day's crew; replaces `/runsheet`
  (redirects to `?tab=logistics&print=1`). `print-runsheet.tsx` keeps the printable view.
- **Footer** (`FooterTotals`): `On quote · Cost · Margin` once, derived from the services summary.
- **Pick crew** (`pick-crew-sheet.tsx`): preferred → available → pencilled → booked, advisory only;
  nothing blocks a double booking. Send offers goes through the `sendCrewOffers` server action.

## Moving the dates: `shiftScheduleNative`

`convex/projectServicesWrites.ts` — moves N services and their crew calls by whole days in ONE
transaction (move groups). Gate: `useDateMoveGate` (the non-blocking preview shape, fails OPEN);
the dates sheet writes the project window first, then shifts, with one Undo closure shared by the
toast. Delivery / bump in follow load in; bump out / pickup follow load out. Cross-tenant checked
(convex-test covers it). Money is untouched: nothing moves a price.

## Sub-hire transport stops (derived)

A sub-hire order linked to the job shows two read-only rows on the timeline and day mode:
`Collect from <supplier> · SH-xxxx` on `hireStart`, `Return to <supplier> · SH-xxxx` on `hireEnd`
(`subHireStops` / `mergeStops`). They are NEVER stored as services and carry no money, no checkbox
and no status; the only action is **Open order** (the existing `SubHireOrderDialog`). Cancelled
orders produce none. They ride the All and Transport lanes only; a day holding only a stop is not a
date-move target. Read through `api.subHires.listByProject` (org-filtered on the global
`by_projectId` index) plus `suppliers.list`, both gated on `subHire:read` + `supplier:read` so a role
without them simply sees no stops (`use-subhire-stops.ts`).

## The service sheet (5b)

Row open (and the AddBar's second Enter) opens `service-sheet/service-sheet.tsx`: a Dialog on desktop, a
bottom sheet on the phone, five sections in this order: **When** (date / end date for multi-day
types, start / end, the truck's own time), **Where** (address + `Use venue`, vehicle with the org's recent
vehicles derived from its services, trips), **Crew** (role, needed, the rate table, `Pick crew`, `Send
offers`, `Confirm all accepted`), **Money** (charge, discount, cost, live derived margin, charge-rate
override, Xero coding) and **Notes**. It replaced `ServiceDialog`; every field and gate survived: the
pricing lock still wraps charge / discount / cost in `LockedField` (the charge-rate override stays
unwrapped because the server does not gate it), cost and margin are manager-only, conflict badges and the
non-gating clash count stay.

The sheet only EDITS (the AddBar creates the row first). The form is seeded once per open, keyed by
service id, so a live push never overwrites typing. Two write paths, stated in the Crew hint: Pick crew,
Remove, Send offers and Confirm act immediately; the rate table's edits save with the service, and Save
always sends every live assignment as the desired crew set (leaving one out would delete it).

## Client pick up / drop off

Two service types, `CLIENT_PICKUP` and `CLIENT_DROPOFF` (one list: `convex/lib/serviceTypes.ts`). The
client moves the gear themselves at OUR counter. They sit in the Transport lane, AddBar chips
`Client pick up` / `Client drop off`, and the sheet swaps Where for **Who collects / Who drops off**:
`clientContactName`, `clientContactPhone`, `clientVehicle` (vehicle and rego, one line), plus `Use the site
contact`. `address` is the counter, snapshotted at create from the org's default location (else the first
WAREHOUSE location with an address, else blank with the hint "Set a warehouse location"), so later
location edits never change a sent document. Quick add defaults: one Warehouse-role person (by name),
no charge (a handling fee can be typed). The truck time becomes `Client collects at` / `Client drops off
at`. Crew phases `HANDOVER` / `RETURN` (new `ProjectPhase` members). Xero account: the MISC default (a
handling fee is not transport). The warehouse TV display reuses the dispatch / return tiles with
`Client collects` / `Client returns` and no vehicle line; the call sheet prints the client line ahead
of the notes; the runsheet's Where line shows counter, client and rego. The three contact fields are PII
(`docs/pii-inventory.md`) and redacted from the API request log.

Schema: additive only (two union members, three optional fields, two phase members; no backfill).

## Not built (deferred)

- A freshly quick-added service with a headcount does not auto-open the picker on save.
- Crew rows with checkboxes under a service (needs LineRowList `sections`); verbs stay in By person.
