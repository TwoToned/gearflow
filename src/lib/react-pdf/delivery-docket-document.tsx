/**
 * #1154 — standalone react-pdf component tree for the `delivery-docket`
 * document type. Same status as the other doc-type trees: NOT wired into
 * `generate-pdf.ts`/`pdf-render.ts` (a later issue in the #1150 sequence).
 *
 * Delta over `packing-list-document.tsx`/`return-sheet-document.tsx`:
 * - `filterByStatus: ["CHECKED_OUT"]`, with kit parents promoting their
 *   CHECKED_OUT children into their own section (`buildDeliveryDocketGroups`
 *   → `filterAndGroupItems`'s delivery-docket branch, #1152) — distinct from
 *   every other doc type's plain `groupName`/`prepContainer` grouping
 * - `showRowNumbers: true` ("#" column) and a "Received" checkbox column
 *   instead of condition columns
 * - `showSiteContact: true` in the details row — the driver needs to know
 *   who to hand the gear to
 * - `signature` block ("Delivered By"/"Received By"/"Date")
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

export function DeliveryDocketDocument({ data }: { data: DocumentData }) {
  const docType: ProjectDocumentType = "delivery-docket";

  const tableConfig: TablePluginConfig = {
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
    showCategories: false,
    showRowNumbers: true,
    filterOptional: false,
    filterByStatus: ["CHECKED_OUT"],
    hidePricingPeriodSuffix: false,
  };

  return (
    <Document title={`${data.org_name} — Delivery Docket ${data.project_number}`}>
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
          <Header data={data} docType={docType} docTitle="DELIVERY DOCKET" />
        </View>

        <View style={{ marginBottom: "4mm" }} wrap={false}>
          <DetailsRow data={data} config={{ showSiteContact: true }} />
        </View>

        <View style={{ marginBottom: "6mm" }}>
          <LineItemsTable items={data.line_items} config={tableConfig} docColor={tableConfig.documentColor} />
        </View>

        <SignatureLine columns={[{ label: "Delivered By", subLabel: "Name / Signature" }, { label: "Received By", subLabel: "Name / Signature" }, { label: "Date" }]} />

        <Footer text={data.document_footer_text || `${data.org_name} | ${data.org_email} | ${data.org_phone}`} />
      </Page>
    </Document>
  );
}
