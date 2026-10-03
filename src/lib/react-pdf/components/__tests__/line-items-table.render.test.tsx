/**
 * #1152 — render-level smoke coverage for LineItemsTable across every doc
 * type's real TableLayoutConfig (document-layouts.ts), including the
 * warehouse-doc-only surface the #1151 spike never exercised: badges,
 * checkboxes, condition columns, per-unit sub-rows, and the full 3-level
 * kit/group/accessory hierarchy. Structured-data assertions on the
 * filtering/badge/column logic live in line-items-table.test.ts; this file
 * only proves the JSX composition renders to real PDF bytes without
 * throwing across that whole config surface — the same "no throw" bar the
 * spike's own test file uses for the parts it couldn't assert on more
 * precisely (row structure isn't cheaply inspectable from a PDF byte
 * stream — see quote-document.test.ts).
 */
import { describe, it, expect } from "vitest";
import { renderToBuffer, Document, Page, View } from "@react-pdf/renderer";
import { PDFDocument as PdfLibDocument } from "@pdfme/pdf-lib";
import type { DocumentLineItem, TablePluginConfig } from "@/lib/pdfme/types";
import { LineItemsTable } from "../line-items-table";

function makeItem(overrides: Partial<DocumentLineItem>): DocumentLineItem {
  return {
    id: overrides.id ?? "li-1",
    description: null,
    quantity: 1,
    checkedOutQuantity: 0,
    unitPrice: null,
    pricingType: "PER_DAY",
    duration: 1,
    discount: null,
    lineTotal: null,
    groupName: null,
    categoryName: null,
    groupTitle: null,
    isOptional: false,
    notes: null,
    status: "CONFIRMED",
    model: null,
    asset: null,
    bulkAsset: null,
    ...overrides,
  };
}

function makeConfig(overrides: Partial<TablePluginConfig> = {}): TablePluginConfig {
  return {
    documentType: "packing-list",
    documentColor: "#0d4f4f",
    showGroupHeaders: true,
    showKitChildren: true,
    showCheckboxes: true,
    showConditionColumns: false,
    showPricing: true,
    showBadges: true,
    showNotes: true,
    showPerUnitCheckboxes: true,
    showAssetTags: true,
    showCategories: true,
    showRowNumbers: false,
    filterOptional: false,
    filterByStatus: null,
    hidePricingPeriodSuffix: false,
    ...overrides,
  };
}

/** A fully-loaded fixture: a kit parent with a nested-kit child (itself
 *  carrying an accessory grandchild), a Project Group with members, a
 *  bare accessory-parent, a multi-quantity per-unit line, an overbooked
 *  item, an optional item, and a SALE line — everything the config surface
 *  gates on. */
function makeFixtureItems(): DocumentLineItem[] {
  return [
    makeItem({
      id: "kit-parent",
      kitId: "kit-1",
      kit: { assetTag: "KIT-001", name: "Lighting Kit" },
      description: "Lighting Kit",
      groupName: "Category 1",
      quantity: 1,
      checkedOutQuantity: 1,
      unitPrice: 800,
      lineTotal: 800,
      status: "CHECKED_OUT",
      model: { name: "Lighting Kit" },
      childLineItems: [
        makeItem({ id: "kit-child-1", isKitChild: true, childKind: "KIT", quantity: 2, checkedOutQuantity: 1, status: "CHECKED_OUT", model: { name: "Par Can" } }),
        makeItem({
          id: "kit-child-nested-kit",
          isKitChild: true,
          childKind: "KIT",
          kitId: "nested-kit-1",
          quantity: 1,
          checkedOutQuantity: 1,
          status: "CHECKED_OUT",
          model: { name: "Fog Machine" },
          childLineItems: [
            makeItem({ id: "grandchild-1", isKitChild: true, childKind: "ACCESSORY", quantity: 3, checkedOutQuantity: 2, status: "CHECKED_OUT", model: { name: "Fog Fluid" } }),
          ],
        }),
      ],
    }),
    makeItem({
      id: "group-1",
      isGroupRow: true,
      description: "Audio Package",
      groupName: "Audio Package",
      quantity: 1,
      checkedOutQuantity: 1,
      status: "CHECKED_OUT",
      model: { name: "Audio Package" },
      childLineItems: [makeItem({ id: "group-member-1", quantity: 1, checkedOutQuantity: 1, status: "CHECKED_OUT", model: { name: "Speaker" } })],
    }),
    makeItem({
      id: "accessory-parent",
      description: "IEM Rack",
      groupName: "Category 2",
      quantity: 1,
      checkedOutQuantity: 1,
      status: "CHECKED_OUT",
      asset: { assetTag: "IEM-RACK-01" },
      model: { name: "IEM Rack" },
      childLineItems: [makeItem({ id: "accessory-child-1", isKitChild: true, childKind: "ACCESSORY", quantity: 1, checkedOutQuantity: 1, status: "CHECKED_OUT", model: { name: "Power Supply" } })],
    }),
    makeItem({
      id: "multi-qty",
      description: "Wireless Mic",
      groupName: "Category 2",
      quantity: 3,
      checkedOutQuantity: 2,
      status: "CHECKED_OUT",
      model: { name: "Wireless Mic" },
      units: [
        { id: "u1", asset: { assetTag: "MIC-1" }, bulkAsset: null, status: "CHECKED_OUT" },
        { id: "u2", asset: { assetTag: "MIC-2" }, bulkAsset: null, status: "CHECKED_OUT" },
      ],
    }),
    makeItem({
      id: "overbooked",
      description: "Overbooked Item",
      groupName: "Category 2",
      quantity: 1,
      checkedOutQuantity: 1,
      status: "CHECKED_OUT",
      isOverbooked: true,
      overbookedHasOverbooked: true,
      overbookedHasReduced: true,
      model: { name: "Overbooked Item" },
    }),
    makeItem({
      id: "optional-item",
      description: "Optional Add-on",
      groupName: "Category 3",
      quantity: 1,
      isOptional: true,
      status: "CHECKED_OUT",
      model: { name: "Optional Add-on" },
    }),
    makeItem({
      id: "sale-item",
      description: "Cable (sold)",
      groupName: "Category 3",
      type: "SALE",
      quantity: 2,
      checkedOutQuantity: 2,
      status: "CONFIRMED",
      unitPrice: 15,
      lineTotal: 30,
      pricingType: "FLAT",
      model: { name: "Cable" },
    }),
  ];
}

async function renderTable(items: DocumentLineItem[], config: TablePluginConfig) {
  const buffer = await renderToBuffer(
    <Document>
      <Page size="A4">
        <View>
          <LineItemsTable items={items} config={config} docColor={config.documentColor} />
        </View>
      </Page>
    </Document>,
  );
  const pdf = await PdfLibDocument.load(buffer);
  return pdf.getPageCount();
}

describe("LineItemsTable render smoke coverage", () => {
  const docTypes: TablePluginConfig["documentType"][] = ["quote", "invoice", "packing-list", "return-sheet", "delivery-docket"];

  it.each(docTypes)("renders the full fixture for %s without throwing", async (documentType) => {
    const config = makeConfig({
      documentType,
      showConditionColumns: documentType === "return-sheet",
      filterByStatus: documentType === "return-sheet" ? ["CHECKED_OUT", "RETURNED"] : documentType === "delivery-docket" ? ["CHECKED_OUT"] : null,
    });
    await expect(renderTable(makeFixtureItems(), config)).resolves.toBeGreaterThanOrEqual(1);
  });

  it("renders with showKitChildren off (client-facing docs) without exploding children", async () => {
    const config = makeConfig({ documentType: "quote", showKitChildren: false, showBadges: false, filterByStatus: null });
    await expect(renderTable(makeFixtureItems(), config)).resolves.toBeGreaterThanOrEqual(1);
  });

  it("renders every badge combination (stacked overbooked+reduced, optional, subhire, sale) without throwing", async () => {
    const items = [
      makeItem({ id: "a", isOverbooked: true, overbookedHasOverbooked: true, overbookedHasReduced: true, model: { name: "A" } }),
      makeItem({ id: "b", isOptional: true, model: { name: "B" } }),
      makeItem({ id: "c", subHireId: "sh-1", supplierName: "Acme Hire", model: { name: "C" } }),
      makeItem({ id: "d", type: "SALE", model: { name: "D" } }),
    ];
    const config = makeConfig({ documentType: "packing-list", showBadges: true });
    await expect(renderTable(items, config)).resolves.toBeGreaterThanOrEqual(1);
  });

  it("per-unit checkbox sub-rows render at all 3 indent depths without throwing", async () => {
    const items = makeFixtureItems();
    const config = makeConfig({ documentType: "delivery-docket", showPerUnitCheckboxes: true, filterByStatus: ["CHECKED_OUT"] });
    await expect(renderTable(items, config)).resolves.toBeGreaterThanOrEqual(1);
  });

  it("paginates a long list across multiple pages with group headers and children on", async () => {
    const items: DocumentLineItem[] = [];
    for (let i = 0; i < 40; i++) {
      items.push(
        makeItem({
          id: `item-${i}`,
          description: `Item ${i}`,
          groupName: `Category ${Math.floor(i / 5) + 1}`,
          quantity: 1,
          checkedOutQuantity: 1,
          status: "CHECKED_OUT",
          model: { name: `Model ${i}` },
        }),
      );
    }
    items.push(...makeFixtureItems());
    const config = makeConfig({ documentType: "packing-list" });
    const pages = await renderTable(items, config);
    expect(pages).toBeGreaterThan(1);
  });
});
