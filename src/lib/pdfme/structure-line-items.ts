/**
 * Pure helper that restructures a project's raw line items into the ordered
 * array passed to PDF templates. Extracted from build-document-data.ts so
 * the structuring logic is testable in isolation and downstream changes
 * (per-template expand toggle, sub-hire section, kit boundary) can land
 * with snapshot coverage.
 *
 * Phase 0 invariant: this helper produces IDENTICAL output to the inlined
 * logic at build-document-data.ts:235-323. No behaviour change yet — only
 * the move.
 *
 * Phase 1+ adds: an `expandProjectGroups` flag, `subHireGroups` param, and
 * composite Map-key handling. Don't add those here until the snapshot
 * fixtures are locked.
 */
import type { DocumentLineItem } from "./types";

/** Category metadata as already loaded by build-document-data's project include. */
export interface CategoryForStructuring {
  id: string;
  name: string;
  sortOrder: number;
  groups: Array<{
    id: string;
    title: string;
    description: string | null;
    quantity: number;
    price: number | null;
    rentalPeriod: string | null;
    rentalQuantity: number | null;
    billingWeeks: number | null;
    billingDays: number | null;
    sortOrder: number;
  }>;
}

/**
 * Restructure raw line items into the ordered, category-aware array that
 * PDF templates consume. Groups currently collapse into a single
 * `isGroupRow: true` synthetic row; their underlying line items are
 * filtered out. Uncategorized items render last.
 *
 * Returns the rawLineItems unchanged when no categories exist (legacy
 * projects fall through this path).
 */
export function structureLineItems(
  rawLineItems: DocumentLineItem[],
  categories: CategoryForStructuring[] | undefined,
): DocumentLineItem[] {
  if (!categories || categories.length === 0) {
    return rawLineItems;
  }

  // Build set of groupIds so we can filter out their child line items
  const groupIds = new Set<string>();
  for (const cat of categories) {
    for (const g of cat.groups) {
      groupIds.add(g.id);
    }
  }

  // Build ordered list: categories as headers, groups as rows, ungrouped items inline
  const structured: DocumentLineItem[] = [];

  for (const cat of categories) {
    // Ungrouped items in this category (have categoryId but no groupId)
    const ungroupedInCat = rawLineItems.filter(
      li =>
        li.categoryName === cat.name &&
        !li.groupTitle &&
        !li.isKitChild &&
        !li.isContainerLineItem,
    );

    // Only emit category if it has groups or ungrouped items
    if (cat.groups.length === 0 && ungroupedInCat.length === 0) continue;

    // Groups become virtual line item rows (hiding individual equipment)
    for (const group of cat.groups) {
      const duration = group.billingDays ?? group.rentalQuantity ?? 1;
      const price = group.price ?? 0;
      const total = group.quantity * price * duration;

      structured.push({
        id: `group-${group.id}`,
        description: group.description || null,
        quantity: group.quantity,
        checkedOutQuantity: 0,
        unitPrice: price,
        pricingType: group.rentalPeriod === "WEEKLY" ? "PER_WEEK" : "PER_DAY",
        duration,
        discount: null,
        lineTotal: total,
        groupName: cat.name,
        categoryName: cat.name,
        groupTitle: group.title,
        isGroupRow: true,
        isOptional: false,
        notes: group.description || null,
        status: "CONFIRMED",
        model: { name: group.title },
        asset: null,
        bulkAsset: null,
      });
    }

    // Then any ungrouped items in this category
    for (const li of ungroupedInCat) {
      structured.push({ ...li, groupName: cat.name });
    }
  }

  // Items not in any category and not inside a group — show as-is
  const uncategorized = rawLineItems.filter(li => {
    if (li.isKitChild || li.isContainerLineItem) return false;
    if (li.categoryName || li.groupTitle) return false;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const groupId = (li as any).groupId as string | null | undefined;
    if (groupId && groupIds.has(groupId)) return false;
    return true;
  });
  for (const li of uncategorized) {
    structured.push(li);
  }

  return structured;
}
