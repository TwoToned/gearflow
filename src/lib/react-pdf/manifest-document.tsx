/**
 * #1296 build plan phase 3b — the client-facing Manifest: everything on
 * site, container by container, then loose (design
 * docs/designs/packing-containers-manifest.md §4.1, decisions D8/Q10/D6).
 * One continuous list, no page break per container (D8); reference only,
 * no checkboxes (Q10 — the docket is the sign-off, not this document); no
 * prices (a container is a box, never priced). Structurally closest to
 * `packing-list-document.tsx` (warehouse-style: showKitChildren on, no
 * pricing/badges/notes) — the container-first bucketing comes from
 * `LineItemsTable`'s `byContainer` mode (`TablePluginConfig.byContainer`),
 * fed by `build-document-data.ts` loading `projectContainers` and passing
 * `byContainer: true` to `structureLineItems`.
 */
import { Document, Page, View } from "@react-pdf/renderer";
import type { DocumentData } from "@/lib/pdfme/types";
import type { ProjectDocumentType } from "@/lib/pdfme/document-layouts";
import { Header } from "./components/header";
import { DetailsRow } from "./components/details-row";
import { LineItemsTable } from "./components/line-items-table";
import { SummaryLine } from "./components/summary-line";
import { Footer } from "./components/footer";
import { PAGE_MARGIN, pageSizeFor } from "./styles";
import { MARGIN, FOOTER_HEIGHT } from "@/lib/pdfme/template-constants";

const PAGE_PADDING_BOTTOM = `${MARGIN + FOOTER_HEIGHT + 8}mm`;

export function ManifestDocument({ data }: { data: DocumentData }) {
  const docType: ProjectDocumentType = "manifest";

  const tableConfig = {
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
    showCategories: true,
    showRowNumbers: false,
    filterOptional: false,
    filterByStatus: null,
    hidePricingPeriodSuffix: false,
    byContainer: true,
  } as const;

  return (
    <Document title={`${data.org_name} — Manifest ${data.project_number}`}>
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
          <Header data={data} docType={docType} docTitle="MANIFEST" />
        </View>

        <View style={{ marginBottom: "3mm" }} wrap={false}>
          <DetailsRow data={data} config={{ showSiteContact: true }} />
        </View>

        <View style={{ marginBottom: "4mm" }} wrap={false}>
          <SummaryLine data={data} />
        </View>

        <View style={{ marginBottom: "4mm" }}>
          <LineItemsTable items={data.line_items} config={tableConfig} docColor={tableConfig.documentColor} />
        </View>

        <Footer text={data.document_footer_text || `${data.org_name} | ${data.org_email} | ${data.org_phone}`} />
      </Page>
    </Document>
  );
}
