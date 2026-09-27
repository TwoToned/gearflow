/**
 * #1154, reworked #1296 phase 3c (D7) — standalone react-pdf component tree
 * for the `delivery-docket` document type: a hand-over document (what came
 * off the truck, sign here), distinct from the Manifest (what's where), but
 * ordered by the SAME container buckets so the two agree.
 *
 * Delta over `packing-list-document.tsx`/`return-sheet-document.tsx`:
 * - `byContainer: true` + `filterByStatus: ["CHECKED_OUT"]` — container
 *   order, kit rows kept (with their case tag) and their CHECKED_OUT members
 *   indented below, same as the manifest/return-sheet (D7 dropped the older
 *   "promote a kit's children into their own section, drop the kit row"
 *   behavior — a client-facing docket now shows the kit tag).
 * - `showRowNumbers: true` ("#" column), no per-row Received checkbox (D7 —
 *   one signature covers the whole delivery, so a tick per line was
 *   redundant and, pre-ticked on a CHECKED_OUT-filtered doc, read as
 *   "already received")
 * - `showPerUnitCheckboxes: false` — asset tags print inline
 *   (`getAssetTag`'s dedupe/"+N more" text) instead of exploding a qty>1 line
 *   into per-unit sub-rows
 * - `showSiteContact: true` in the details row — the driver needs to know
 *   who to hand the gear to
 * - a container summary line, same as the manifest's
 * - `signature` block ("Delivered By"/"Received By"/"Date")
 * - sentence-case title ("Delivery docket", not "DELIVERY DOCKET") — a
 *   deliberate, docket-scoped exception to the fixed-vocabulary ALL-CAPS
 *   titles the other doc types use (DESIGN.md §5.2 bans uppercase generally;
 *   §6 defers PDF branding, so this one doc type opts out early rather than
 *   adding more caps).
 */
import { Document, Page, View } from "@react-pdf/renderer";
import type { DocumentData } from "@/lib/pdfme/types";
import type { ProjectDocumentType } from "@/lib/pdfme/document-layouts";
import { Header } from "./components/header";
import { DetailsRow } from "./components/details-row";
import { LineItemsTable } from "./components/line-items-table";
import { SummaryLine } from "./components/summary-line";
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
    showCheckboxes: false,
    showConditionColumns: false,
    showPricing: false,
    showBadges: false,
    showNotes: false,
    showPerUnitCheckboxes: false,
    showAssetTags: true,
    showCategories: false,
    showRowNumbers: true,
    filterOptional: false,
    filterByStatus: ["CHECKED_OUT"],
    hidePricingPeriodSuffix: false,
    byContainer: true,
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
          <Header data={data} docType={docType} docTitle="Delivery docket" />
        </View>

        <View style={{ marginBottom: "3mm" }} wrap={false}>
          <DetailsRow data={data} config={{ showSiteContact: true }} />
        </View>

        <View style={{ marginBottom: "4mm" }} wrap={false}>
          <SummaryLine data={data} />
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
