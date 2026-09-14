/**
 * #1154 — standalone react-pdf component tree for the `packing-list` (PULL
 * SLIP) document type. Same status as `quote-document.tsx`/
 * `invoice-document.tsx`: NOT wired into `generate-pdf.ts`/`pdf-render.ts`
 * (a later issue in the #1150 sequence — see FEATUREDOCS/13-pdfs.md).
 *
 * The first of the 3 warehouse doc types (packing-list/return-sheet/
 * delivery-docket) — these differ from quote/invoice by turning
 * `showKitChildren` back on (packers need every serial) and turning pricing/
 * badges/notes off. `LineItemsTable` (#1152) already carries every feature
 * these need (checkboxes, per-unit sub-rows, asset tags, categories, kit/
 * group/accessory expansion) — this file is just wiring the shared
 * components into the `packing-list` layout (document-layouts.ts):
 * - `showCheckboxes`/`showPerUnitCheckboxes`/`showAssetTags`/`showCategories`
 * - the `totalItemsNote` block (`Total items: N`, from `data.total_items`)
 * - no totals/notes/T&Cs/signature block — a pull slip is a picking
 *   worksheet, not a client-facing or sign-off document
 */
import { Document, Page, View, Text } from "@react-pdf/renderer";
import type { DocumentData } from "@/lib/pdfme/types";
import type { ProjectDocumentType } from "@/lib/pdfme/document-layouts";
import { Header } from "./components/header";
import { DetailsRow } from "./components/details-row";
import { LineItemsTable } from "./components/line-items-table";
import { Footer } from "./components/footer";
import { PAGE_MARGIN, pageSizeFor } from "./styles";
import { MARGIN, FOOTER_HEIGHT } from "@/lib/pdfme/template-constants";

const PAGE_PADDING_BOTTOM = `${MARGIN + FOOTER_HEIGHT + 8}mm`;

export function PackingListDocument({ data }: { data: DocumentData }) {
  const docType: ProjectDocumentType = "packing-list";

  const tableConfig = {
    documentType: docType,
    documentColor: data.org_document_color || "#0d4f4f",
    showGroupHeaders: true,
    showKitChildren: true,
    showCheckboxes: true,
    showConditionColumns: false,
    showPricing: false,
    showBadges: false,
    showNotes: false,
    showPerUnitCheckboxes: true,
    showAssetTags: true,
    showCategories: true,
    showRowNumbers: false,
    filterOptional: false,
    filterByStatus: null,
    hidePricingPeriodSuffix: false,
  } as const;

  return (
    <Document title={`${data.org_name} — Pull Slip ${data.project_number}`}>
      <Page
        size={pageSizeFor(data.org_paper_size)}
        wrap
        style={{
          paddingTop: PAGE_MARGIN,
          paddingBottom: PAGE_PADDING_BOTTOM,
          paddingLeft: PAGE_MARGIN,
          paddingRight: PAGE_MARGIN,
          fontFamily: "Helvetica",
        }}
      >
        <View fixed style={{ marginBottom: "3mm" }}>
          <Header data={data} docType={docType} docTitle="PULL SLIP" />
        </View>

        <View style={{ marginBottom: "4mm" }} wrap={false}>
          <DetailsRow data={data} />
        </View>

        <View style={{ marginBottom: "4mm" }}>
          <LineItemsTable items={data.line_items} config={tableConfig} docColor={tableConfig.documentColor} />
        </View>

        <View wrap={false}>
          {/* fontSize/color match gearflow-text-block.ts's original totalItemsNote draw call (document-composer.ts) */}
          <Text style={{ fontSize: 8, color: "#333333" }}>Total items: {data.total_items}</Text>
        </View>

        <Footer text={data.document_footer_text || `${data.org_name} | ${data.org_email} | ${data.org_phone}`} />
      </Page>
    </Document>
  );
}
