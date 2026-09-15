# Category Price Rollup & Group Child Disclosure

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
category's kebab in the equipment tab, under its **Client documents** section
("Show combined price" / "Show individual prices"); a labelled **Combined
price** pill on the category row shows the state without opening a menu.

All four toggles this doc describes — the category one, the per-row price
reveal on a line and on a group, and the group-member disclosure below — sit
under that one **Client documents** heading in their row's kebab. The heading
carries the "what does the client see?" context, which is what lets each label
stay short and parallel ("Show combined price" / "Show this price" / "Show this
item") instead of each one restating it.

## This is not what a priced Group does

The distinction is the whole point of the feature, so it is worth stating
plainly:

| | Priced **Project Group** | **`ROLLUP`** category |
|---|---|---|
| Contents on the doc | **Hidden** — replaced by one row (unless individually disclosed, see below) | **Shown** — every line, with quantities |
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
out. "Show this price" in the row's kebab, under **Client documents**.

Three rules govern it:

1. **A revealed row is still INCLUDED in the section subtotal.** The header
   is the category's *total*, not the hidden remainder. This is why the
   header amount prints with the `ROLLUP_SUBTOTAL_LABEL` ("Combined price" —
   the same phrase as the toggle that set it) rather than as a bare figure:
   an unlabelled amount sitting beside a revealed row's own price would read
   as double counting.
2. **It is consulted ONLY inside a rollup.** In an `ITEMISED` category every
   price already prints, so the flag does nothing there — which is why the
   menu entry is not offered there either. A row left carrying a stale `true`
   after its category is switched back changes nothing.
3. **It only applies to a row the document actually DRAWS.** In collapse mode
   `structureLineItems` emits a category's ungrouped non-child lines plus one
   synthetic row per Project Group — nothing else. A group's member, a
   sub-hire group's child and a kit's child are dropped, so a reveal flag on
   one of them would reveal a price on a row the client never sees. The
   equipment tab therefore does not offer the toggle on those rows;
   `canRevealPriceInRollup` (`src/lib/category-pricing-display.ts`) is the one
   definition of the rule, and
   `src/lib/pdfme/category-price-rollup.test.tsx` pins the renderer's half of
   it so the two can't drift.

   The control that DOES apply to those rows belongs to their container: a
   group's member is disclosed with `showInGroupOnDocs` (below), and the
   group's own collapsed row carries its own `revealPriceInRollup`.

`false` is stored as an **absent** field on both entities, so "hidden" has
exactly one representation.

### Known gap: a sub-hire group's own row

A sub-hire group's charge line DOES print on a client-facing document and its
money cells ARE blanked inside a rolled-up category — but that row renders as
`SubHireGroupRow`, which carries no reveal toggle. So a sub-hire charge cannot
currently be broken out of a rollup the way a Project Group's can. Not a
correctness bug (the subtotal still includes it); a missing control.

## Where it lives

```
src/lib/category-pricing-display.ts    — THE shared module: the union, the default
                                          reading, isLinePriceHidden, rollupSubtotal,
                                          ROLLUP_SUBTOTAL_LABEL
                                          ROLLUP_SUBTOTAL_LABEL, canRevealPriceInRollup
src/lib/group-child-disclosure.ts      — the sibling module: isGroupChildDisclosed +
                                          canDiscloseGroupChild +
                                          disclosedGroupChildren (the pure selector)
convex/lib/validators.ts               — CategoryPricingDisplay validator;
                                          InvoiceLineSourceType += "CATEGORY"
convex/schema.ts                       — projectCategories.pricingDisplay +
                                          xeroAccountCode/xeroTaxType;
                                          projectLineItems.revealPriceInRollup;
                                          projectGroups.revealPriceInRollup;
                                          projectLineItems.showInGroupOnDocs
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

src/components/projects/equipment-rows.tsx — the Client documents kebab section on
                                              category/group/item rows + the pill
src/components/projects/equipment-tab.tsx  — the four mutations that drive them
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

## Group child disclosure

The sibling feature, and the other half of "show the client what they're
getting without showing what each piece costs".

A Project Group collapses to ONE row on a client-facing document: title,
quantity, bundle price. Everything inside is dropped. That is right for a
package sold as a package, but it left no way to say *"the Lighting Package
is $8,000, and here is the gear in it"* short of retyping the contents into
the group's description by hand.

`projectLineItems.showInGroupOnDocs` opts ONE member back onto the document.
It renders indented under the group's row showing its **description and
quantity**, and nothing else. "Show this item" in the row's kebab, under
**Client documents**; absent = not listed, which is the pre-feature behaviour
(no backfill).

### A disclosed member NEVER shows a price

Not "hidden unless revealed" like a rolled-up category's lines — never, full
stop, and there is deliberately no per-member override for it. The group's
charge **is** its bundle price; a member's own `unitPrice`/`lineTotal` is an
internal build-up figure the bundle price supersedes. Printing both would put
two contradictory numbers for the same gear on one document, and printing the
members' would invite the client to add them up and find they don't equal the
bundle.

That is also why disclosure needs **no counterpart in `buildFinanceLines`**:
it moves no money and bills nothing new. The group still bills as exactly one
line. The flag is purely "does this row appear".

### How it reaches the page

`disclosedGroupChildren` (`src/lib/group-child-disclosure.ts`) is the pure
selector. `structureLineItems`' collapse mode attaches its result as the group
row's `childLineItems`, each stamped `priceHidden: true` — the **same** derived
field a rolled-up category's rows carry, so there is one flag meaning "this row
prints no money", not two.

It returns `undefined` rather than `[]` when nothing is disclosed, so a group
with no disclosures keeps the exact row shape it had before the feature and
`isGroupParentRow` still reads false for it.

Two deliberate exclusions:

- **Kit parents.** A kit inside a group is itself a collapsing container;
  exploding one here would disclose a second level of contents nobody asked
  for. The exclusion is exported as `canDiscloseGroupChild` and the equipment
  tab gates the menu entry on the same predicate, so a kit inside a group is
  never offered a toggle the renderer would then ignore. (Making disclosure
  work for a kit — listing the kit's own name and quantity with its contents
  still hidden — is a reasonable future call; it is a change to what prints,
  so it is not made here.)
- **Expand (warehouse) mode.** A packing list / return sheet / delivery docket
  lists every member regardless — the packers need the full pick list — so the
  flag is never consulted there. A stale `true` on a line that later leaves its
  group therefore changes nothing.

### The `showKitChildren` gate

`line-items-table.tsx` renders a group row's children past
`config.showKitChildren`. That gate exists to stop a client-facing document
exploding kits and accessories into sub-rows the client didn't ask for; a
group row is different, because in collapse mode `structureLineItems` attaches
**only** the members the operator deliberately disclosed — so the presence of
children *is* the intent. Leaving them behind the gate would make the toggle
silently do nothing on exactly the documents it exists for.

### Composing with a rolled-up category

They are separate decisions on separate entities and compose without
interacting: in a `ROLLUP` category, the group's own row prints without its
bundle price (unless that group is revealed), and its disclosed members print
without prices as they always do. Both toggles can be offered on the same row
— one is about the category's pricing, the other about the group's contents.

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
  — the menus, actually opened (both features').
- `src/lib/group-child-disclosure.test.ts` — the strict flag reading and the
  pure selector (kit-parent exclusion, `undefined` vs `[]`, no input mutation).
- `src/lib/pdfme/group-child-disclosure.test.tsx` — the full pipeline again:
  a group still collapses by default, a disclosed member appears with its
  quantity and no price, undisclosed siblings stay hidden, and a warehouse doc
  is unaffected.
