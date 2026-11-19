/**
 * The line-item steps of `buildDocumentData` that a second reader of "what
 * the quote shows" also needs: enriching the reconstructed rows with the
 * names the table prints, and appending the billable services as virtual
 * rows. Moved verbatim out of `build-document-data.ts` so the Equipment
 * tab's Client view (`src/server/equipment-client-view.ts`) runs the same
 * chain instead of a copy of it (R-3.1). Pure: the caller loads the inputs.
 */
import { isHardOverbooked, type OverbookedInfo } from "@/lib/overbooking-core";
import type { ConvexProjectService } from "@/lib/project-services-read";
import type { DocumentLineItem } from "./types";

/** Serialize Decimal fields to numbers (Prisma v6 Decimal type) */
export function serializeDecimals<T>(obj: T): T {
  return JSON.parse(
    JSON.stringify(obj, (_key, value) =>
      value && typeof value === "object" && typeof value.toNumber === "function"
        ? value.toNumber()
        : value
    )
  );
}

/**
 * Enrich line items with overbooking flags + category/group/location names.
 *
 * PDFs stay HARD-only: `reconstructOverbookedStatus` now also flags a line
 * whose overage is purely PENCILLED (still-quoted/optional demand elsewhere
 * in the org) so the equipment-tab/project-list badges can show it, but a
 * rendered document is a point-in-time artifact (client-facing quote/invoice
 * are literally stored bytes — see CLAUDE.md) and a pencilled collision can
 * resolve within the hour. Surfacing it there would print a warning that's
 * both misleading to a client and potentially stale by the time anyone reads
 * it, so a doc only ever reflects genuine hard overbooking.
 */
export function enrichDocumentLineItems<LineItemRow extends { id: string }>(
  lineItems: LineItemRow[],
  overbookedMap: Map<string, OverbookedInfo>,
  locationMap: Map<string, { name: string }>,
) {
  /**
   * Pull the physical location name off a line item via its asset or
   * bulk-asset record. The asset rows carry only `locationId` now (no Prisma
   * `location` join) — the name is resolved from the Convex location map.
   * Custom items and services have neither and return null, sorting to the
   * "No Location" bucket on packer docs.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const deriveLocationName = (row: any): string | null => {
    const locId = row?.asset?.locationId ?? row?.bulkAsset?.locationId ?? null;
    return locId ? locationMap.get(locId)?.name ?? null : null;
  };
  return lineItems.map((li: LineItemRow) => {
    const rawInfo = overbookedMap.get(li.id);
    const info = isHardOverbooked(rawInfo) ? rawInfo : undefined;
    const children = (li as unknown as { childLineItems?: LineItemRow[] }).childLineItems;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const liAny = li as any;
    const categoryName: string | null = liAny.category?.name ?? null;
    const groupTitle: string | null = liAny.group?.title ?? null;
    return {
      ...li,
      categoryName,
      groupTitle,
      locationName: deriveLocationName(liAny),
      supplierName: liAny.supplier?.name ?? null,
      isOverbooked: !!info,
      overbookedInherited: info?.inherited ?? false,
      overbookedReducedOnly: info?.reducedOnly ?? false,
      overbookedHasOverbooked: info?.hasOverbookedChildren ?? false,
      overbookedHasReduced: info?.hasReducedChildren ?? false,
      childLineItems: children?.map((child: LineItemRow) => {
        const rawChildInfo = overbookedMap.get(child.id);
        const childInfo = isHardOverbooked(rawChildInfo) ? rawChildInfo : undefined;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const childAny = child as any;
        return {
          ...child,
          categoryName: childAny.category?.name ?? null,
          groupTitle: childAny.group?.title ?? null,
          locationName: deriveLocationName(childAny),
          supplierName: childAny.supplier?.name ?? null,
          isOverbooked: !!childInfo,
          overbookedReducedOnly: childInfo?.reducedOnly ?? false,
        };
      }),
    };
  });
}

/**
 * Billable services as virtual line items. A service appears on
 * quotes/invoices as its own section once it has an actual charge —
 * `lineTotal` is null/0 until a unitPrice is typed or a crew charge rate
 * auto-prices it (calculateServiceLineTotal / recalcServiceChargeFromCrew).
 * Mirrors `buildFinanceLines` (convex/lib/financeSnapshot.ts) and
 * `recalcProjectTotals`'s serviceRevenue (convex/lib/recalc.ts) — same rule,
 * not a second one (R-3.1). The caller passes the version's own services
 * (`getProjectServicesForVersion`); they're ordered by sortOrder asc here.
 *
 * "Combine services" (`combine`) reuses the category-rollup presentation (see
 * src/lib/category-pricing-display.ts): every service still lists, its own
 * money cells are blank, and the "Services" section header prints the one
 * "Combined price" (derived as sum(lineTotal) at render — never stored).
 */
export function buildBillableServiceRows(services: ConvexProjectService[], { combine }: { combine: boolean }): DocumentLineItem[] {
  const billableServices = services
    .filter(
      (s) =>
        s.status !== "CANCELLED" &&
        Number(s.lineTotal) > 0,
    )
    .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));

  return billableServices.map(
    (svc) =>
      ({
        id: `svc-${svc.id}`,
        description: svc.title,
        quantity: 1,
        checkedOutQuantity: 0,
        unitPrice: svc.unitPrice ? Number(svc.unitPrice) : null,
        pricingType: "FLAT",
        duration: 1,
        discount: svc.discount ? Number(svc.discount) : null,
        lineTotal: svc.lineTotal ? Number(svc.lineTotal) : null,
        groupName: "Services",
        categoryName: "Services",
        groupTitle: null,
        isGroupRow: false,
        isOptional: false,
        notes: svc.description || null,
        status: "CONFIRMED",
        model: null,
        asset: null,
        bulkAsset: null,
        ...(combine ? { rollupCategory: true, priceHidden: true } : {}),
      }) as DocumentLineItem,
  );
}
