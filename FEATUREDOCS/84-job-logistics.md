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

## Not built (deferred)

- Client pick up / drop off service types (spec §8): needs a `projectServices.type` schema change.
- The five-section service sheet (Phase 5b); today the existing `ServiceDialog` opens.
- Crew rows with checkboxes under a service (needs LineRowList `sections`); verbs stay in By person.
