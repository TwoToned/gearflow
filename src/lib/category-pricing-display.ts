/**
 * Category price rollup — the single source of truth for the
 * `pricingDisplay` union, the per-row "is this price hidden?" decision, and
 * the section-subtotal arithmetic every consumer of it shares (the document
 * pipeline, the finance snapshot, the equipment tab, the Zod schemas).
 *
 * ## What the feature is
 *
 * A project category prints one of two ways on a client-facing document
 * (quote / invoice):
 *
 * - **`ITEMISED`** (default, and every pre-feature row — absent is read as
 *   itemised, so there is no backfill): every line prints its own unit price,
 *   discount and line total, exactly as before.
 * - **`ROLLUP`**: every line still prints — description and quantity — but the
 *   money columns are blank, and the category's *section header* carries one
 *   price for the whole category. "Here is everything you're getting, here is
 *   what the lot costs."
 *
 * This is deliberately NOT what a priced Project Group does. A priced group
 * *replaces* its contents with a single row; the client never sees what's in
 * it. A rolled-up category shows the full contents and hides only the
 * per-item money. Both can coexist: a priced group inside a rolled-up
 * category prints as one line (its own collapse behaviour is unchanged) with
 * its money hidden, and its bundle price folds into the category subtotal.
 *
 * ## Why the subtotal is DERIVED, never stored
 *
 * The section price is always `sum(lineTotal)` over the category's members,
 * computed at render/snapshot time. It is not a typed override and it is not
 * a new money anchor. That is the whole reason this feature needs no changes
 * to `recalc.ts`, to allocation, or to the project's revenue buckets: the
 * numbers a rolled-up document prints are the *same* numbers an itemised one
 * prints, only grouped differently. A stored override would be a second
 * hand-maintained copy of a total the line items already determine, and it
 * could silently contradict the document's own grand total the moment an item
 * price changed (R-3.1, and the same reasoning `src/lib/discount-mode.ts`
 * gives for never storing the typed percentage).
 *
 * ## Per-item reveal
 *
 * `projectLineItems.revealPriceInRollup` opts ONE line back into printing its
 * own price inside a rolled-up category — for the line the client asked to see
 * broken out. A revealed line is still **included in the section subtotal**:
 * the subtotal is the category's true total, not a remainder. That is why the
 * header amount is labelled (see `ROLLUP_SUBTOTAL_LABEL`) rather than printed
 * as a bare figure — an unlabelled amount next to a revealed item's own price
 * reads as double counting.
 *
 * The flag is display-only and has NO effect in an `ITEMISED` category (where
 * every price already prints) — it is never consulted outside a rollup, so a
 * line carrying a stale `true` after its category is switched back to itemised
 * changes nothing.
 */

export const CATEGORY_PRICING_DISPLAYS = ["ITEMISED", "ROLLUP"] as const;

export type CategoryPricingDisplay = (typeof CATEGORY_PRICING_DISPLAYS)[number];

/** The reading applied to an absent/unrecognised value — every row written
 *  before this feature, and anything that fails the guard. */
export const DEFAULT_CATEGORY_PRICING_DISPLAY: CategoryPricingDisplay = "ITEMISED";

/** The label printed beside a rolled-up section's amount. Explicit because a
 *  bare figure next to a revealed line's own price reads as double counting —
 *  see the file header.
 *
 *  Wording matches the operator-facing toggle ("Show combined price") so the
 *  person setting it and the client reading it see the same phrase. Deliberately
 *  not "Category total": "category" is internal vocabulary the client never sees
 *  anywhere else on the document. */
export const ROLLUP_SUBTOTAL_LABEL = "Combined price";

/**
 * Can this row's own price be revealed inside a rolled-up category?
 *
 * Only a row that PRINTS ITS OWN ROW on a client-facing document can. In
 * collapse mode `structureLineItems` emits, per category, its ungrouped
 * non-child lines plus ONE synthetic row per Project Group — and nothing else.
 * A Project Group's members, a sub-hire group's children and a kit's children
 * are all dropped, so `revealPriceInRollup` on one of them reveals a price on a
 * row that is never drawn: the flag is inert, not subtle.
 *
 * Offering the toggle on such a row is therefore a lie — the operator flips it,
 * the document doesn't change, and nothing says why. The controls that DO apply
 * to those rows are their container's: a group member is disclosed with
 * `showInGroupOnDocs` (and a disclosed member never prints a price at all — see
 * `src/lib/group-child-disclosure.ts`), and a group's own collapsed row carries
 * its own `revealPriceInRollup`.
 *
 * A stale `true` left on a line that later moves INTO a group stays harmless
 * for the same reason the itemised-category case is harmless: the flag is only
 * ever read for a row the document actually draws.
 */
export function canRevealPriceInRollup(row: {
  /** Is the row a member of a Project Group? */
  inProjectGroup?: boolean | null;
  /** Is the row a child of a sub-hire group's parent line? */
  isSubHireGroupChild?: boolean | null;
  /** Is the row a kit member / accessory child? */
  isKitChild?: boolean | null;
}): boolean {
  return !row.inProjectGroup && !row.isSubHireGroupChild && !row.isKitChild;
}

/** Narrowing guard for the untrusted boundaries (a stored doc field, a
 *  `v.any()` patch payload, a CSV cell). */
export function isCategoryPricingDisplay(value: unknown): value is CategoryPricingDisplay {
  return value === "ITEMISED" || value === "ROLLUP";
}

/** A stored/untrusted value coerced to one of the two literals, defaulting to
 *  `ITEMISED` — byte-identical to the pre-feature behaviour. */
export function toCategoryPricingDisplay(value: unknown): CategoryPricingDisplay {
  return isCategoryPricingDisplay(value) ? value : DEFAULT_CATEGORY_PRICING_DISPLAY;
}

/** True when this category prints one price for the whole section instead of
 *  per-line prices. The one test every consumer shares. */
export function isRollupCategory(value: unknown): boolean {
  return toCategoryPricingDisplay(value) === "ROLLUP";
}

/**
 * Does THIS line hide its own money columns?
 *
 * Only inside a rolled-up category, and only when the line hasn't been
 * explicitly revealed. Both arguments are the raw stored values (either may be
 * absent), so callers never have to normalise first.
 */
export function isLinePriceHidden(args: {
  pricingDisplay: unknown;
  revealPriceInRollup?: boolean | null;
}): boolean {
  if (!isRollupCategory(args.pricingDisplay)) return false;
  return args.revealPriceInRollup !== true;
}

/**
 * The section price for a rolled-up category: the plain sum of its members'
 * line totals, revealed lines included (see the file header).
 *
 * Takes the already-structured rows so there is ONE definition of the
 * arithmetic shared by the PDF's section header and the finance snapshot's
 * rollup billing line — they must agree to the cent or a client's document and
 * their invoice disagree. Non-finite/absent totals count as 0, matching every
 * other money sum in this codebase.
 */
export function rollupSubtotal(items: Array<{ lineTotal?: number | null }>): number {
  let sum = 0;
  for (const item of items) {
    const total = Number(item.lineTotal ?? 0);
    if (Number.isFinite(total)) sum += total;
  }
  return sum;
}
