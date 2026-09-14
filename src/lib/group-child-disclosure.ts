/**
 * Group child disclosure — showing selected members of a Project Group on a
 * client-facing document (quote / invoice) without showing what each one costs.
 *
 * ## The problem this solves
 *
 * A Project Group collapses to ONE row on a client-facing document: the group's
 * title, its quantity, and its bundle price. Everything inside it is dropped
 * (`structureLineItems`' collapse mode). That is the right default for a
 * package sold as a package — but it leaves no way to say "the Lighting Package
 * is $5,000, and here is the gear that's in it" without either itemising every
 * price or retyping the contents into the description by hand.
 *
 * `projectLineItems.showInGroupOnDocs` opts ONE member back into the document.
 * It renders indented under the group's row, showing its description and
 * quantity, and nothing else. Absent = not disclosed, which is exactly the
 * pre-feature behaviour, so there is no backfill.
 *
 * ## A disclosed child NEVER shows a price
 *
 * Not "hidden unless revealed" like a rolled-up category's lines
 * (`src/lib/category-pricing-display.ts`) — never, full stop. The group's
 * charge IS its bundle price; a member's own `unitPrice`/`lineTotal` is an
 * internal build-up figure that the bundle price deliberately supersedes.
 * Printing both would put two contradictory numbers for the same gear on one
 * document, and printing the members' would invite the client to add them up
 * and find they don't equal the bundle.
 *
 * This is why disclosure needs no counterpart in `buildFinanceLines`: it moves
 * no money and bills nothing new. The group still bills as one line, exactly as
 * it did. The flag is purely "does this row appear".
 *
 * ## Scope
 *
 * Consulted only for a line that is a member of a Project Group
 * (`groupId != null`) and only in collapse mode — a warehouse document already
 * expands every group and lists every member, disclosed or not, because the
 * packers need the full list. A stale `true` on a line that later leaves its
 * group therefore changes nothing.
 */

import type { DocumentLineItem } from "@/lib/pdfme/types";

/** The reading applied to an absent/unrecognised value: not disclosed — the
 *  pre-feature behaviour for every row already in the database. */
export const DEFAULT_GROUP_CHILD_DISCLOSED = false;

/**
 * Is this member disclosed on client-facing documents? Strict: anything that
 * isn't exactly `true` fails closed, so a truthy non-boolean arriving through
 * an untrusted boundary can't leak a line onto a client's quote.
 */
export function isGroupChildDisclosed(value: unknown): boolean {
  return value === true;
}

/**
 * The members of a group that a client-facing document should list under the
 * group's collapsed row, each stamped `priceHidden` so the renderer blanks its
 * money cells (the same derived field a rolled-up category's rows carry — one
 * flag for "this row prints no money", not two).
 *
 * Kit parents are excluded: a kit inside a group is itself a collapsing
 * container, and exploding one here would disclose a second level of contents
 * nobody asked for. Kit CHILDREN never reach this list either — they hang off
 * their kit parent, not the group.
 *
 * Returns `undefined` rather than an empty array when nothing is disclosed, so
 * the group row keeps the exact shape it had before this feature
 * (`childLineItems: undefined`) and `isGroupParentRow` still reads false for it.
 */
export function disclosedGroupChildren(
  members: DocumentLineItem[],
): DocumentLineItem[] | undefined {
  const disclosed = members
    .filter((m) => isGroupChildDisclosed(m.showInGroupOnDocs))
    .filter((m) => !(m.kitId && !m.isKitChild))
    .map((m) => ({ ...m, priceHidden: true }));
  return disclosed.length > 0 ? disclosed : undefined;
}
