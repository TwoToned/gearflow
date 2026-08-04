/**
 * #1151 spike — realistic quote fixture, adapted from
 * `document-composer.test.ts`'s `makeData`/`makeLongLineItemList` (same
 * `DocumentData`/`DocumentLineItem` contract, same shape of long/varied
 * equipment list) plus the sub-hire / price-breakdown / markdown-lite-notes /
 * accessory-parent rows #1151 explicitly asks the spike to cover.
 */
import { serializePriceBreakdown } from "@/lib/billing-derivation";
import type { DocumentData, DocumentLineItem } from "@/lib/pdfme/types";

export function makeSpikeData(overrides: Partial<DocumentData> = {}): DocumentData {
  return {
    org_name: "RVLT Rigging Co.",
    org_email: "hello@rvltrigging.example",
    org_phone: "0400 000 000",
    org_address: "12 Industrial Ave, Sydney NSW 2000",
    org_website: "rvltrigging.example",
    org_abn: "12 345 678 901",
    org_business_number_label: "ABN",
    org_logo: null,
    org_icon: null,
    org_tax_rate: 10,
    org_tax_label: "GST",
    org_invoice_heading: "TAX INVOICE",
    org_paper_size: "A4",
    org_branding: { documentLogoMode: "icon", showOrgNameOnDocuments: true, documentColor: "#0d4f4f" },
    org_document_color: "#0d4f4f",
    project_number: "PRJ-2026-0142",
    project_name: "Summit Conference — Main Stage AV",
    project_status: "ACTIVE",
    project_type: "RENTAL",
    rental_start: "2026-09-10",
    rental_end: "2026-09-14",
    event_start: "2026-09-12",
    event_end: "2026-09-13",
    load_in_date: "2026-09-10",
    load_out_date: "2026-09-14",
    client_name: "Summit Events Pty Ltd",
    client_contact: "Priya Nair",
    client_email: "priya@summitevents.example",
    client_phone: "0400 111 111",
    client_billing_address: "88 Harbour St, Sydney NSW 2000",
    client_tax_id: "98 765 432 100",
    client_payment_terms: "14 days",
    venue_name: "Sydney Convention Centre — Hall 3",
    venue_address: "14 Darling Dr, Sydney NSW 2000",
    site_contact_name: "Site Manager",
    site_contact_phone: "0400 222 222",
    site_contact_email: "site@venue.example",
    subtotal: 18240,
    discount_percent: 5,
    discount_amount: 912,
    tax_label: "GST",
    tax_amount: 1732.8,
    total: 19060.8,
    deposit_paid: 0,
    balance_due: 19060.8,
    client_notes: "**Please confirm access times** by 2026-09-08.\n- Loading dock opens 06:00\n- Bump-out must finish by 23:00 on 2026-09-14\n\nAny changes to the run sheet may incur additional labour charges.",
    crew_notes: "",
    internal_notes: "",
    document_date: "2026-08-03",
    invoice_number: "",
    document_footer_text: "",
    document_footer_second_line: "",
    terms_and_conditions:
      "**Payment Terms**\nA 50% deposit is required to confirm this booking, with the balance due 7 days prior to load-in.\n\n**Cancellation**\n- Cancellations within 14 days forfeit the deposit\n- Cancellations within 48 hours are charged in full\n\n**Damage & Loss**\nThe client is responsible for equipment loss or damage beyond fair wear and tear, valued at full replacement cost.\n\nThis quote is valid for 30 days from the date of issue. Prices exclude any additional labour, freight, or venue fees not itemised above.",
    quote_valid_until: "2026-09-02",
    invoice_due_date: "",
    payment_details: "",
    line_items: [],
    pm_name: "Jordan PM",
    pm_phone: "0400 333 333",
    pm_email: "jordan@rvltrigging.example",
    load_in_time: "06:00",
    load_out_time: "23:00",
    crew: [],
    crew_by_day: [],
    equipment_summary: "",
    total_items: 0,
    total_weight: 0,
    ...overrides,
  };
}

function makeLineItem(overrides: Partial<DocumentLineItem>): DocumentLineItem {
  return {
    id: overrides.id ?? "li-default",
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

/**
 * A long, varied equipment list — enough to force multi-page pagination with
 * a page break landing mid-group, and covering every feature #1151 asks the
 * spike to exercise: plain items, a discounted item, a sub-hire item (with
 * `showSubhireOnDocs` on, so its "via Supplier" line renders on this
 * client-facing doc), an auto-priced item with a price breakdown, an item
 * with markdown-lite notes, a Project Group's synthetic collapsed row, and
 * an accessory-parent row (a serialised asset with a permanent accessory
 * child) — none of the last two explode into visible children here, since
 * `showKitChildren` is off for quote/invoice.
 */
export function makeLongLineItemList(count: number): DocumentLineItem[] {
  const items: DocumentLineItem[] = [];

  for (let i = 0; i < count; i++) {
    items.push(
      makeLineItem({
        id: `item-${i}`,
        description: `Equipment Item ${i}`,
        quantity: (i % 5) + 1,
        checkedOutQuantity: (i % 5) + 1,
        unitPrice: 50 + i,
        lineTotal: (50 + i) * ((i % 5) + 1),
        pricingType: "PER_DAY",
        status: "CHECKED_OUT",
        groupName: `Category ${Math.floor(i / 6) + 1}`,
        model: { name: `Model ${i}`, modelNumber: i % 3 === 0 ? `MDL-${i}` : null },
        asset: (i % 5) + 1 === 1 ? { assetTag: `AST-${i}` } : null,
      }),
    );
  }

  // A discounted item (percent mode) — exercises discountCellText's "-15%" path.
  items.push(
    makeLineItem({
      id: "discounted-item",
      description: "Wireless Handheld Microphone",
      groupName: "Category 1",
      quantity: 4,
      checkedOutQuantity: 4,
      unitPrice: 45,
      discount: 27, // 15% of a 4 * 45 = 180 gross
      discountMode: "%",
      lineTotal: 153,
      status: "CHECKED_OUT",
      model: { name: "Wireless Handheld Microphone" },
    }),
  );

  // A sub-hire item, shown on this client-facing doc because
  // `showSubhireOnDocs` is on — exercises the "via Supplier" line.
  items.push(
    makeLineItem({
      id: "subhire-item",
      description: "Line Array Speaker (x8 hang)",
      groupName: "Category 2",
      quantity: 8,
      checkedOutQuantity: 8,
      unitPrice: 220,
      lineTotal: 1760,
      status: "CHECKED_OUT",
      subHireId: "subhire-1",
      supplierName: "Sydney PA Hire",
      showSubhireOnDocs: true,
      model: { name: "Line Array Speaker" },
    }),
  );

  // An auto-priced item with a stored breakdown — exercises the
  // "2 wk @ $X + 3 d @ $Y" sub-line.
  items.push(
    makeLineItem({
      id: "breakdown-item",
      description: "LED Wall Panel (per m²)",
      groupName: "Category 2",
      quantity: 20,
      checkedOutQuantity: 20,
      unitPrice: 640,
      lineTotal: 640,
      pricingType: "OPTIMIZED",
      priceBreakdown: serializePriceBreakdown({ weeks: 1, days: 2, weeklyRate: 400, dailyRate: 90, capped: false }),
      status: "CHECKED_OUT",
      model: { name: "LED Wall Panel" },
    }),
  );

  // An item with markdown-lite notes (bold/italic/bullets) — exercises
  // RichText inside the description cell.
  items.push(
    makeLineItem({
      id: "notes-item",
      description: "Lighting Console",
      groupName: "Category 3",
      quantity: 1,
      checkedOutQuantity: 1,
      unitPrice: 350,
      lineTotal: 350,
      status: "CHECKED_OUT",
      notes: "**Requires operator.** Client to supply *show file* by load-in.\n- Backup console on standby\n- Confirm patch with LD",
      model: { name: "Lighting Console", modelNumber: "GMA3" },
    }),
  );

  // A kit parent with 3 children (one with its own accessory grandchild) —
  // collapses to one row on quote/invoice (showKitChildren: false).
  items.push(
    makeLineItem({
      id: "kit-parent",
      description: "Lighting Kit",
      groupName: "Category 3",
      kitId: "kit-1",
      kit: { assetTag: "KIT-001", name: "Lighting Kit" },
      quantity: 1,
      checkedOutQuantity: 1,
      unitPrice: 800,
      lineTotal: 800,
      status: "CHECKED_OUT",
      model: { name: "Lighting Kit" },
      childLineItems: [
        makeLineItem({ id: "kit-child-1", isKitChild: true, childKind: "KIT", quantity: 4, checkedOutQuantity: 4, status: "CHECKED_OUT", model: { name: "Par Can" } }),
        makeLineItem({ id: "kit-child-2", isKitChild: true, childKind: "KIT", quantity: 1, checkedOutQuantity: 1, status: "CHECKED_OUT", model: { name: "DMX Controller" } }),
        makeLineItem({
          id: "kit-child-3",
          isKitChild: true,
          childKind: "KIT",
          quantity: 1,
          checkedOutQuantity: 1,
          status: "CHECKED_OUT",
          model: { name: "Fog Machine" },
          childLineItems: [
            makeLineItem({ id: "kit-grandchild-1", isKitChild: true, childKind: "ACCESSORY", quantity: 1, checkedOutQuantity: 1, status: "CHECKED_OUT", model: { name: "Fog Fluid" } }),
          ],
        }),
      ],
    }),
  );

  // A Project Group's synthetic collapsed row.
  items.push(
    makeLineItem({
      id: "group-1",
      description: "Audio Package",
      isGroupRow: true,
      groupName: "Audio Package",
      quantity: 1,
      checkedOutQuantity: 1,
      unitPrice: 1200,
      lineTotal: 1200,
      status: "CHECKED_OUT",
      model: { name: "Audio Package" },
      childLineItems: [
        makeLineItem({ id: "group-member-1", quantity: 2, checkedOutQuantity: 2, status: "CHECKED_OUT", model: { name: "Speaker" } }),
        makeLineItem({ id: "group-member-2", quantity: 1, checkedOutQuantity: 1, status: "CHECKED_OUT", model: { name: "Mixer" } }),
      ],
    }),
  );

  // An accessory-parent row: a serialised asset with a permanent accessory
  // child (no kitId, no isGroupRow — detected via childKind: "ACCESSORY").
  items.push(
    makeLineItem({
      id: "accessory-parent",
      description: "Wireless IEM Transmitter Rack",
      groupName: "Category 4",
      quantity: 1,
      checkedOutQuantity: 1,
      unitPrice: 300,
      lineTotal: 300,
      status: "CHECKED_OUT",
      asset: { assetTag: "IEM-RACK-01" },
      model: { name: "Wireless IEM Transmitter Rack" },
      childLineItems: [
        makeLineItem({ id: "accessory-child-1", isKitChild: true, childKind: "ACCESSORY", quantity: 1, checkedOutQuantity: 1, status: "CHECKED_OUT", model: { name: "Rack Power Supply" } }),
      ],
    }),
  );

  return items;
}
