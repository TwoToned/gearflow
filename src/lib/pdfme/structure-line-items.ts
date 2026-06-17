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
 *   docket): each Project Group emits a synthetic parent row with
 *   `isGroupRow: true` AND `childLineItems: [...]` carrying its non-kit
 *   members. The table plugin renders the parent bold (kit-style) and
 *   its members indented underneath. The group lives in its category's
 *   bucket so the warehouse sees "Band → Drum Kit Mic Set → e602 ii"
 *   rather than the group breaking out as its own top-level section.
 *
 * Bucket-key strategy: the downstream table plugin buckets rows by
 * `groupName` and uses it as the visible section-header text.
 *   - Category-bucket rows use `groupName = cat.name`.
 *   - Kit parents (warehouse mode only) break out to
 *     `groupName = "[Kit] <kit.name>"` — kit boundary wins over Project
 *     Group placement so a kit nested inside a group still surfaces as
 *     its own labelled section.
 *
 * Kit children inside a group: a kit parent that lives inside a Project
 * Group is hoisted out of the group's `childLineItems` and emitted at
 * the top level under its own `[Kit] <name>` bucket. This preserves the
 * existing kit-boundary contract.
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
    sortOrder: number;
  }>;
}

/**
 * SubHireGroup metadata flattened across all SubHires on the project,
 * with the supplier name pre-resolved for the section header.
 */
export interface SubHireGroupForStructuring {
  id: string;
  title: string;
  sortOrder: number;
  supplierName: string | null;
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
 *
 * When `expandProjectGroups` is true AND `subHireGroups` are passed in,
 * items belonging to any sub-hire group get pulled out of their target
 * category and rendered in dedicated "Sub-Hire: <supplier> — <group>"
 * sections at the end. This lets warehouse staff see what's hired-in
 * vs owned at a glance, and lets the client at the loading bay see
 * the same separation on the delivery docket.
 */
export function structureLineItems(
  rawLineItems: DocumentLineItem[],
  categories: CategoryForStructuring[] | undefined,
  options: StructureOptions = {},
  subHireGroups: SubHireGroupForStructuring[] = [],
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

  // Sub-hire extraction is only active in expand mode (warehouse docs).
  // Client-facing quote / invoice keep sub-hire items inside their target
  // category so the line totals roll up against the category subtotals.
  const subHireGroupIds = new Set(
    expand ? subHireGroups.map(g => g.id) : [],
  );

  /** True if the item should be pulled into a sub-hire section. */
  const isInSubHireSection = (li: DocumentLineItem): boolean => {
    if (!expand) return false;
    if (!li.subHireGroupId) return false;
    return subHireGroupIds.has(li.subHireGroupId);
  };

  /**
   * Resolve the bucket label for an item — `[Kit] <name>` for kit
   * parents (warehouse mode only), otherwise the provided category /
   * group label. Kit boundary wins over Project Group placement so a
   * kit parent that ALSO sits inside a Project Group renders under
   * its own kit section, not under the group.
   *
   * Only active in expand mode — quote / invoice keep kits inside
   * their category so subtotals roll up correctly.
   */
  const kitBucketLabel = (li: DocumentLineItem, fallback: string): string => {
    if (!expand) return fallback;
    const isKitParent = !!li.kitId && !li.isKitChild;
    if (!isKitParent) return fallback;
    const kitName = li.kit?.name ?? li.description ?? "Kit";
    return `[Kit] ${kitName}`;
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
    // Ungrouped items in this category (have categoryId but no groupId).
    // Sub-hire items are excluded — they get their own section below.
    const ungroupedInCat = rawLineItems.filter(
      li =>
        li.categoryName === cat.name &&
        !li.groupTitle &&
        !li.isKitChild &&
        !li.isContainerLineItem &&
        !isInSubHireSection(li),
    );

    // Skip categories with no content. In collapse mode that means no
    // groups and no ungrouped items. In expand mode we want to surface
    // a category that has any group content (sub-hire items are
    // excluded from the count — they render in their own section).
    const hasGroupContent = expand
      ? cat.groups.some(g =>
          rawLineItems.some(
            li =>
              li.groupTitle === g.title &&
              li.categoryName === cat.name &&
              !li.isKitChild &&
              !li.isContainerLineItem &&
              !isInSubHireSection(li),
          ),
        )
      : cat.groups.length > 0;
    if (!hasGroupContent && ungroupedInCat.length === 0) continue;

    // Emit each group
    for (const group of cat.groups) {
      const duration = group.rentalQuantity ?? 1;
      const price = group.price ?? 0;
      const total = group.quantity * price * duration;

      // Both modes bucket group rows under the category. In expand mode
      // the group renders as a bold parent row (kit-style) followed by
      // its members indented; the category bucket gives the warehouse
      // doc its outer section header.
      const bucketLabel = cat.name;

      const groupChildren = expand
        ? rawLineItems.filter(
            li =>
              li.groupTitle === group.title &&
              li.categoryName === cat.name &&
              !li.isKitChild &&
              !li.isContainerLineItem &&
              !isInSubHireSection(li),
          )
        : [];

      // Kit parents inside the group break out to their own `[Kit] X`
      // section at the top level. Non-kit members render indented under
      // the synthetic group parent via childLineItems.
      const groupKitParents = expand
        ? groupChildren.filter(c => !!c.kitId && !c.isKitChild)
        : [];
      const groupInlineMembers = expand
        ? groupChildren.filter(c => !(!!c.kitId && !c.isKitChild))
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
        // Attach non-kit members so the renderer indents them under the
        // group parent. Empty array in collapse mode (children dropped).
        childLineItems: expand ? maybeSort(groupInlineMembers) : undefined,
      });

      // Kit parents that lived inside this group still get their own
      // `[Kit] <name>` section per the kit-boundary contract.
      if (expand) {
        for (const child of groupKitParents) {
          structured.push({ ...child, groupName: kitBucketLabel(child, bucketLabel) });
        }
      }
    }

    // Ungrouped items in this category render under the category bucket,
    // sorted in packer-walk order when the option is on. Kit parents
    // get promoted to a `[Kit] <name>` section instead.
    for (const li of maybeSort(ungroupedInCat)) {
      structured.push({ ...li, groupName: kitBucketLabel(li, cat.name) });
    }
  }

  // Items not in any category and not inside a group — render as-is,
  // sorted in packer-walk order when the option is on. Sub-hire items
  // are excluded so they don't double-appear (they render below).
  const uncategorized = rawLineItems.filter(li => {
    if (li.isKitChild || li.isContainerLineItem) return false;
    if (li.categoryName || li.groupTitle) return false;
    if (isInSubHireSection(li)) return false;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const groupId = (li as any).groupId as string | null | undefined;
    if (groupId && groupIds.has(groupId)) return false;
    return true;
  });
  for (const li of maybeSort(uncategorized)) {
    structured.push(li);
  }

  // Sub-hire sections — one per SubHireGroup that has actual items.
  // Sections render AFTER all categories so the org's owned gear comes
  // first on the doc and hired-in gear is clearly separated below.
  if (expand && subHireGroups.length > 0) {
    for (const shg of subHireGroups) {
      const items = rawLineItems.filter(
        li =>
          li.subHireGroupId === shg.id &&
          !li.isKitChild &&
          !li.isContainerLineItem,
      );
      if (items.length === 0) continue;

      const supplierPart = shg.supplierName ? `${shg.supplierName} — ` : "";
      const bucketLabel = `Sub-Hire: ${supplierPart}${shg.title}`;

      for (const li of maybeSort(items)) {
        structured.push({ ...li, groupName: bucketLabel });
      }
    }
  }

  return structured;
}
