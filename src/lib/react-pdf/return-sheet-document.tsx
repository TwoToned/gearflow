/**
 * #1154 — standalone react-pdf component tree for the `return-sheet`
 * document type. Same status as the other doc-type trees: NOT wired into
 * `generate-pdf.ts`/`pdf-render.ts` (a later issue in the #1150 sequence).
 *
 * Delta over `packing-list-document.tsx`:
 * - `filterByStatus: ["CHECKED_OUT", "RETURNED"]`, with the WS11 (#950)
 *   SALE-line special case baked into `LineItemsTable`'s
 *   `filterAndGroupItems` — SALE lines are goods handed over, never expected
 *   back, so they're excluded from this doc type entirely regardless of
 *   status (unlike packing-list/delivery-docket, where SALE bypasses the
 *   filter instead of being excluded — see `document-layouts.ts`'s comment).
 * - `showConditionColumns: true` (Good/Dmg/Missing checkboxes per row)
 * - `signature` block ("Returned By"/"Received By"/"Date") instead of a
 *   totals or notes block — this is a sign-off document
 */
import { Document, Page, View } from "@react-pdf/renderer";
import type { DocumentData } from "@/lib/pdfme/types";
import type { ProjectDocumentType } from "@/lib/pdfme/document-layouts";
import { Header } from "./components/header";
import { DetailsRow } from "./components/details-row";
import { LineItemsTable } from "./components/line-items-table";
import { SignatureLine } from "./components/signature-line";
import { Footer } from "./components/footer";
import { PAGE_MARGIN, pageSizeFor } from "./styles";
import { MARGIN, FOOTER_HEIGHT } from "@/lib/pdfme/template-constants";
import type { TablePluginConfig } from "@/lib/pdfme/types";

const PAGE_PADDING_BOTTOM = `${MARGIN + FOOTER_HEIGHT + 8}mm`;

export function ReturnSheetDocument({ data }: { data: DocumentData }) {
  const docType: ProjectDocumentType = "return-sheet";

  const tableConfig: TablePluginConfig = {
    documentType: docType,
    documentColor: data.org_document_color || "#0d4f4f",
    showGroupHeaders: true,
    showKitChildren: true,
    showCheckboxes: true,
    showConditionColumns: true,
    showPricing: false,
    showBadges: false,
    showNotes: false,
    showPerUnitCheckboxes: true,
    showAssetTags: true,
    showCategories: false,
    showRowNumbers: false,
    filterOptional: false,
    filterByStatus: ["CHECKED_OUT", "RETURNED"],
    hidePricingPeriodSuffix: false,
  };

  return (
    <Document title={`${data.org_name} — Return Sheet ${data.project_number}`}>
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
          <Header data={data} docType={docType} docTitle="RETURN SHEET" />
        </View>

        <View style={{ marginBottom: "4mm" }} wrap={false}>
          <DetailsRow data={data} />
        </View>

        <View style={{ marginBottom: "6mm" }}>
          <LineItemsTable items={data.line_items} config={tableConfig} docColor={tableConfig.documentColor} />
        </View>

        {/* Default columns are exactly "Returned By"/"Received By"/"Date" */}
        <SignatureLine />

        <Footer text={data.document_footer_text || `${data.org_name} | ${data.org_email} | ${data.org_phone}`} />
      </Page>
    </Document>
  );
}
