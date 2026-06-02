/**
 * Pure helper that restructures a project's raw line items into the ordered
 * array passed to PDF templates. Extracted from build-document-data.ts so
 * the structuring logic is testable in isolation.
 *
 * Two modes, selected by `expandProjectGroups`:
 *
 * - `false` (default for quote / invoice — client-facing): each Project
 *   Group collapses into a single virtual line item row with
 *   `isGroupRow: true`. The group's child line items are dropped because
 *   the client sees "Lighting Package x1 @ $5000", not 50 itemized rows.
 *
 * - `true` (warehouse-facing docs — packing list, return sheet, delivery
 *   docket): each Project Group becomes a section header (still
 *   `isGroupRow: true`, with quantity preserved for context) followed by
 *   every child line item underneath. Warehouse staff and the client at
 *   the loading bay see every serial number that's leaving the building.
 *
 * Bucket-key strategy: the downstream table plugin buckets rows by
 * `groupName` and also uses it as the visible header text. To keep both
 * concerns satisfied without changing the plugin contract:
 *   - Category-bucket rows use `groupName = cat.name` (legacy behaviour).
 *   - Project-Group-bucket rows (only in expand mode) use
 *     `groupName = group.title`.
 *
 * Theoretical collision: if two distinct categories each have a Project
 * Group with the same title AND expand mode is on, those two groups
 * merge into one bucket. This is rare in real data and currently
 * documented (not prevented) — a future change can introduce explicit
 * display-label / key separation if it becomes a problem.
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

export interface StructureOptions {
  /**
   * When true, emit each Project Group as a header row + child line items
   * underneath. When false, collapse each group into a single synthetic
   * row and drop the children. Defaults to false (client-facing legacy
   * behaviour).
   */
  expandProjectGroups?: boolean;
  /**
   * When true, sort line items within each bucket (group children,
   * ungrouped-in-category items) in packer-walk order: location, then
   * category, then model name. Designed for warehouse docs where the
   * pick order matters. When false, preserves the user-defined
   * sortOrder from the project. Defaults to false. Wrapped behind
   * `getPackerSortOrder` so a future per-org config (P3) is a small
   * change.
   */
  packerSort?: boolean;
}

/**
 * Returns the comparator used to sort line items in packer-walk order.
 * Currently a hard-coded [location → category → model name] sequence.
 * Per-org override is a P3 follow-up — wrap any future config in this
 * helper so callers don't need to change.
 */
export function getPackerSortOrder(): (
  a: import("./types").DocumentLineItem,
  b: import("./types").DocumentLineItem,
) => number {
  return (a, b) => {
    // null/undefined location sorts AFTER any named location so
    // unassigned bulk and custom items collect at the bottom.
    const locA = a.locationName ?? "￿";
    const locB = b.locationName ?? "￿";
    if (locA !== locB) return locA.localeCompare(locB);

    const catA = a.categoryName ?? "";
    const catB = b.categoryName ?? "";
    if (catA !== catB) return catA.localeCompare(catB);

    const nameA = a.model?.name ?? a.description ?? "";
    const nameB = b.model?.name ?? b.description ?? "";
    return nameA.localeCompare(nameB);
  };
}

/**
 * Restructure raw line items into the ordered array PDF templates consume.
 * See file header for the two modes.
 *
 * Returns the rawLineItems unchanged when no categories exist — legacy
 * projects without any category structure fall through this path.
 */
export function structureLineItems(
  rawLineItems: DocumentLineItem[],
  categories: CategoryForStructuring[] | undefined,
  options: StructureOptions = {},
): DocumentLineItem[] {
  if (!categories || categories.length === 0) {
    return rawLineItems;
  }

  const expand = options.expandProjectGroups ?? false;
  const packerSort = options.packerSort ?? false;
  const packerCompare = packerSort ? getPackerSortOrder() : null;

  /** Sort a slice in place when packerSort is on; no-op otherwise. */
  const maybeSort = (items: DocumentLineItem[]): DocumentLineItem[] => {
    if (!packerCompare) return items;
    return [...items].sort(packerCompare);
  };

  // Build set of groupIds so we can filter out their child line items
  const groupIds = new Set<string>();
  for (const cat of categories) {
    for (const g of cat.groups) {
      groupIds.add(g.id);
    }
  }

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

    // Skip categories with no content. In collapse mode that means no
    // groups and no ungrouped items. In expand mode we still want to
    // surface a category that has any group content (even empty groups
    // get skipped later, but the category itself is non-empty if any
    // group has items).
    const hasGroupContent = expand
      ? cat.groups.some(g =>
          rawLineItems.some(
            li =>
              li.groupTitle === g.title &&
              li.categoryName === cat.name &&
              !li.isKitChild &&
              !li.isContainerLineItem,
          ),
        )
      : cat.groups.length > 0;
    if (!hasGroupContent && ungroupedInCat.length === 0) continue;

    // Emit each group
    for (const group of cat.groups) {
      const duration = group.billingDays ?? group.rentalQuantity ?? 1;
      const price = group.price ?? 0;
      const total = group.quantity * price * duration;

      // The visible bucket label. In collapse mode, the legacy code put
      // group rows into the category bucket (so they sat under the
      // category header). We preserve that. In expand mode, the group
      // gets its own bucket labelled by group title.
      const bucketLabel = expand ? group.title : cat.name;

      const groupChildren = expand
        ? rawLineItems.filter(
            li =>
              li.groupTitle === group.title &&
              li.categoryName === cat.name &&
              !li.isKitChild &&
              !li.isContainerLineItem,
          )
        : [];

      // Skip empty groups in expand mode — no header for nothing.
      // In collapse mode we still emit the synthetic row (legacy).
      if (expand && groupChildren.length === 0) continue;

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
        groupName: bucketLabel,
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

      // Children belong under the group's bucket label, sorted in
      // packer-walk order when the option is on.
      if (expand) {
        for (const child of maybeSort(groupChildren)) {
          structured.push({ ...child, groupName: bucketLabel });
        }
      }
    }

    // Ungrouped items in this category render under the category bucket,
    // sorted in packer-walk order when the option is on.
    for (const li of maybeSort(ungroupedInCat)) {
      structured.push({ ...li, groupName: cat.name });
    }
  }

  // Items not in any category and not inside a group — render as-is,
  // sorted in packer-walk order when the option is on.
  const uncategorized = rawLineItems.filter(li => {
    if (li.isKitChild || li.isContainerLineItem) return false;
    if (li.categoryName || li.groupTitle) return false;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const groupId = (li as any).groupId as string | null | undefined;
    if (groupId && groupIds.has(groupId)) return false;
    return true;
  });
  for (const li of maybeSort(uncategorized)) {
    structured.push(li);
  }

  return structured;
}
