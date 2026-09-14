# Category Price Rollup

> _Owner: Jayden Nawotka · Last reviewed: 2026-09-14 (review quarterly — POLICY.md R-5.5)_

## What this is

A project category prints one of two ways on a **client-facing document**
(quote / invoice):

- **`ITEMISED`** — every line prints its own unit price, discount and line
  total. The legacy behaviour, and what every category written before this
  feature does (the field is absent on those rows and absent reads as
  `ITEMISED` — there is **no backfill**).
- **`ROLLUP`** — every line still prints, with its description and quantity
  intact, but the three money columns are **blank**, and the category's own
  **section header** carries one price for the whole category.

> "Here is everything you're getting. Here is what the lot costs."

The stored field is `projectCategories.pricingDisplay`. Flip it from the
category's kebab in the equipment tab ("Show one price for the category" /
"Show a price per item"); a labelled **One price** pill on the category row
shows the state without opening a menu.

## This is not what a priced Group does

The distinction is the whole point of the feature, so it is worth stating
plainly:

| | Priced **Project Group** | **`ROLLUP`** category |
|---|---|---|
| Contents on the doc | **Hidden** — replaced by one row | **Shown** — every line, with quantities |
| Price shown | The group's own bundle price | One derived subtotal on the section header |
| Where the price comes from | A number the operator typed (`projectGroups.price`) | `sum(lineTotal)` over the members — **never stored** |

They compose rather than compete: a priced group **inside** a rolled-up
category still collapses to its one row (that is its own deliberate
semantic, unchanged), that row's price is hidden like every other row's, and
its bundle total folds into the category's subtotal.

## The subtotal is DERIVED, never stored

The section price is always `sum(lineTotal)` over the category's members,
computed at render / snapshot time by `rollupSubtotal`
(`src/lib/category-pricing-display.ts`).

It is **not** a typed override, and it is **not** a new
`PROJECT_MONEY_ANCHOR`. That is precisely why this feature needs no change to
`convex/lib/recalc.ts`, to allocation (FEATUREDOCS/57), or to any project
revenue bucket: **the numbers a rolled-up document prints are the same
numbers an itemised one prints, only grouped differently.** Rollup regroups;
it never reprices.

A stored override would be a second hand-maintained copy of a total the line
items already determine (R-3.1), and it could silently contradict the
document's own grand total the moment an item price changed — the same
reasoning `src/lib/discount-mode.ts` gives for never storing the typed
percentage.

## Per-item reveal

`projectLineItems.revealPriceInRollup` (and `projectGroups.revealPriceInRollup`
for a collapsed group row) opts **one** row back into printing its own price
inside a rolled-up category — for the line the client asked to see broken
out. "Show this price on documents" in the row's kebab.

Two rules govern it:

1. **A revealed row is still INCLUDED in the section subtotal.** The header
   is the category's *total*, not the hidden remainder. This is why the
   header amount prints with the `ROLLUP_SUBTOTAL_LABEL` ("Category total")
   rather than as a bare figure: an unlabelled amount sitting beside a
   revealed row's own price would read as double counting.
2. **It is consulted ONLY inside a rollup.** In an `ITEMISED` category every
   price already prints, so the flag does nothing there — which is why the
   menu entry is not offered there either. A row left carrying a stale `true`
   after its category is switched back changes nothing.

`false` is stored as an **absent** field on both entities, so "hidden" has
exactly one representation.

## Where it lives

```
src/lib/category-pricing-display.ts    — THE shared module: the union, the default
                                          reading, isLinePriceHidden, rollupSubtotal,
                                          ROLLUP_SUBTOTAL_LABEL
convex/lib/validators.ts               — CategoryPricingDisplay validator;
                                          InvoiceLineSourceType += "CATEGORY"
convex/schema.ts                       — projectCategories.pricingDisplay +
                                          xeroAccountCode/xeroTaxType;
                                          projectLineItems.revealPriceInRollup;
                                          projectGroups.revealPriceInRollup
src/lib/validations/project-category.ts — Zod pricingDisplay (z.enum off the shared list)

convex/projectCategoriesWrites.ts      — updateCategoryNative's `pricingDisplay` arg
convex/lineItemWrites.ts               — patchNative's strict-boolean normalisation
convex/projectGroupsWrites.ts          — updateGroupNative's `revealPriceInRollup` arg
src/hooks/use-project-categories-writes.ts — setPricingDisplay()
src/hooks/use-line-item-writes.ts          — setPriceReveal()
src/hooks/use-project-groups-writes.ts     — setPriceReveal()

src/lib/project-line-item-read.ts      — carries pricingDisplay onto DocCategoryWithGroups
src/lib/project-equipment-reconstruct.ts — the equipment tab's parallel mapper
src/lib/equipment-tab-reconstruct.ts   — CategoryData.pricingDisplay
src/lib/pdfme/structure-line-items.ts  — resolves the two stored fields into the
                                          DERIVED priceHidden / rollupCategory
src/lib/pdfme/types.ts                 — those two DocumentLineItem fields
src/lib/react-pdf/components/line-items-table.tsx
                                       — blank money cells; GroupHeaderRow's labelled
                                          amount; rollupAmountForBucket (pure, exported)

convex/lib/financeSnapshot.ts          — the rollup fold -> one CATEGORY line
convex/xeroPush.ts                     — resolveCategoryLineCode

src/components/projects/equipment-rows.tsx — the category toggle + One price pill,
                                              and the row/group reveal entries
src/components/projects/equipment-tab.tsx  — the three mutations that drive them
```

## The derived fields (`structureLineItems`)

Renderers never read the stored fields. `structureLineItems` resolves them
once, per category, into two fields on `DocumentLineItem`:

- **`priceHidden`** — this row's money cells print blank.
- **`rollupCategory`** — this row belongs to a rolled-up section. Stamped on
  **every** row in the section, revealed ones included, because
  `filterAndGroupItems` buckets by the section's display *name* and keeps no
  category metadata of its own — so any row in the bucket has to be able to
  answer "is this section rolled up?".

Both are stamped **only in collapse mode** (`expandProjectGroups: false`, i.e.
quote and invoice). A warehouse doc expands its groups, and a bucket holding
both a group's own bundle total *and* that group's member rows would
double-count if summed — quite apart from warehouse docs printing no money at
all.

The money cells are left **blank**, deliberately not the `"-"` that a missing
value prints: an empty cell reads as "not shown here", a dash reads as
"nothing to charge".

## Invoicing and Xero

`buildFinanceLines` (`convex/lib/financeSnapshot.ts`) folds every line
belonging to a `ROLLUP` category into a single
`sourceType: "CATEGORY"` line, so the invoice a client is billed from is
grouped the same way as the document they hold. The rolled-up line:

- sits where its **first** member would have appeared, leaving the
  surrounding order untouched;
- totals the plain sum of the members it replaces — so the snapshot still
  sums to the project totals `recalc.ts` already stored;
- absorbs revealed rows too (they are a display decision; billing one
  separately as well would double it);
- carries `quantity: 1`, because a quantity here would imply a per-unit rate
  the category does not have.

A grouped line's own `categoryId` can legitimately be null while its **group**
carries the category, so the lookup falls back to the group's — the same
"`groupId` is the authoritative FK" rule `structure-line-items.ts` follows.
Services have no category and are never absorbed.

`resolveCategoryLineCode` (`convex/xeroPush.ts`) codes the rolled-up line. Its
cascade is two deep — **this category's override → org default** — rather
than a group's three: a `ProjectCategory` is per-project and has no org-level
twin to inherit from. That is a shape difference, not a missing lookup.

## Known edge: an unpriced group with billable extras

In collapse mode, an **unpriced** Project Group emits its synthetic row and
**drops its members** from the document (pre-existing behaviour — see
`structure-line-items.ts`). `recalc`/`buildFinanceLines`, meanwhile, still
bill that group's `isCustomItem` extras and grouped sub-hire charges on their
own.

So in that specific shape, the PDF's section subtotal (which sums the rows the
section *displays*) can differ from the category's rolled-up **billing** line
(which sums what actually bills). This divergence predates the feature — the
quote's grand total already came from `recalc`, not from summing displayed
rows — and rollup does not widen it. It is called out here rather than
papered over, because printing a section amount makes it visible where it
previously was not. Fixing it means changing how unpriced groups collapse,
which is a separate change.

## Lifecycle locks

Both switches run on the **structural** gate (`assertLifecycleGuard`'s
`kind: "structural"`), not the FINANCIAL unlock-session flow. Neither moves an
amount: the category switch decides how existing money is *grouped*, and the
reveal decides whether an amount the row already has is *printed*.
`setPriceReveal` sends a minimal patch, and `patchNative` recomputes
`lineTotal` from the row's own unchanged inputs, so the toggle cannot shift a
number.

Both are audited. A `pricingDisplay` change writes its own before/after into
the summary and metadata rather than a generic "Updated category X" — it
changes what every client-facing document shows, so the log has to say what
changed.

## Tests

- `src/lib/category-pricing-display.test.ts` — the default reading, the
  hidden/revealed decision, the subtotal arithmetic.
- `src/lib/pdfme/category-price-rollup.test.tsx` — the **full pipeline**
  (structure → filter → subtotal → real `QuoteDocument` render → `pdf-parse`
  text), per CLAUDE.md's PDF data-shape rule: items and quantities survive,
  prices don't, the revealed price does, and an itemised category on the same
  document is untouched.
- `convex/lib/financeSnapshot.test.ts` — the fold, the group-FK fallback, the
  cross-org guard on the global `by_projectId` index, and the "rolling up does
  not change the total billed" property.
- `convex/lineItemWrites.test.ts` — the flag's boundary rules at `patchNative`.
- `convex/projectCategoriesPricingDisplay.test.ts` — the mutation, plus the
  parity assertion pinning the inlined `storedPricingDisplay` to the shared
  module (Convex production modules don't import from `src/` — same reason
  `getUserColor` is inlined there).
- `src/components/projects/__tests__/category-price-rollup-menu.smoke.test.tsx`
  — the menus, actually opened.
