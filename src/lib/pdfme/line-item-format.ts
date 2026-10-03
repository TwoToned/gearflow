/**
 * #1157 (cleanup) — pure `DocumentLineItem` formatting helpers, extracted
 * from `plugins/gearflow-table.ts` when the old pdfme composer pipeline was
 * deleted (#1156 cut the 5 project doc types over to react-pdf). These four
 * functions were never pdf-lib-specific — they're plain string/boolean
 * derivations off a line item — but lived in the plugin file because that
 * was the only consumer until `src/lib/react-pdf/components/line-items-table.tsx`
 * (#1152) started importing them directly rather than re-deriving the same
 * logic. Framework-agnostic on purpose: nothing here imports `@pdfme/pdf-lib`
 * or `@react-pdf/renderer`, so both a future renderer and the current one can
 * share it without either depending on the other's vendor package.
 */
import type { DocumentLineItem, TablePluginConfig } from "./types";
import { parsePriceBreakdown, formatPriceBreakdown } from "@/lib/billing-derivation";
import { discountPercentOf, lineGrossAmount } from "@/lib/discount-mode";
import { formatCurrency } from "./plugins/helpers";

/**
 * The Discount cell's text for one row (#1012) — the discount printed the way
 * the operator entered it: `-15%` for a line discounted by percentage, and
 * `-$40.00` for a flat amount. `"-"` when the row carries no discount.
 *
 * `discountMode` is the ENTRY shape; the percentage itself is derived here from
 * the stored dollar amount against the row's own gross, so the printed percent
 * and the printed line total can never contradict each other (see
 * `src/lib/discount-mode.ts`). A row with no stored mode — every row written
 * before #1012 — prints the dollar amount, exactly as it did before.
 */
export function discountCellText(item: DocumentLineItem): string {
  if (!item.discount) return "-";
  if (item.discountMode === "%") {
    const pct = discountPercentOf(item.discount, lineGrossAmount(item));
    // A $0-gross row has no meaningful percentage — fall back to the amount
    // rather than printing a nonsense "-0%" / "-Infinity%".
    if (pct != null) return `-${pct}%`;
  }
  return `-${formatCurrency(item.discount)}`;
}

/** Formatted breakdown label for a line, or "" when there's nothing to show
 *  (no stored breakdown, malformed JSON, or a manually-priced line). */
export function breakdownLabel(item: DocumentLineItem, config: TablePluginConfig): string {
  if (!item.priceBreakdown || !config.showPricing) return "";
  const parsed = parsePriceBreakdown(item.priceBreakdown);
  return parsed ? formatPriceBreakdown(parsed) : "";
}

/** Internal docs (packing-list, return-sheet, delivery-docket) always show the
 *  sub-hire indicator (badge + "via Supplier" line); client-facing docs (quote,
 *  invoice) only show it when the item's showSubhireOnDocs toggle is on. */
export function isSubhireIndicatorVisible(item: DocumentLineItem, documentType?: string): boolean {
  if (item.subHireId == null) return false;
  const isInternalDoc = documentType === "packing-list" || documentType === "return-sheet" || documentType === "delivery-docket";
  return isInternalDoc || !!item.showSubhireOnDocs;
}

/**
 * Get asset tag display for a line. Preference order:
 *   1. Kit row → the kit's own tag
 *   2. Units present (post-cutover, multi-quantity deployed line) →
 *      dedupe tags first (bulk assets share one tag across many units,
 *      so a 10-unit bulk line has 10 identical unit tags, not 10 distinct
 *      ones), then join up to 2 distinct tags, "+N more" for extras. One
 *      distinct tag collapses to itself so single-asset lines and bulk
 *      lines both render one clean tag instead of duplicating it.
 *   3. Legacy line.asset (kit children, un-migrated splits)
 *   4. Bulk asset tag
 *   5. "-"
 */
export function getAssetTag(item: DocumentLineItem, isKit: boolean): string {
  if (isKit) {
    return item.kit?.assetTag || "-";
  }
  const unitTags = [...new Set(
    (item.units ?? [])
      .map((u) => u.asset?.assetTag ?? u.bulkAsset?.assetTag)
      .filter((t): t is string => !!t)
  )];
  if (unitTags.length > 0) {
    if (unitTags.length === 1) return unitTags[0];
    if (unitTags.length === 2) return unitTags.join(", ");
    return `${unitTags[0]}, ${unitTags[1]} +${unitTags.length - 2}`;
  }
  return item.asset?.assetTag || item.bulkAsset?.assetTag || "-";
}
