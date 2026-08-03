/**
 * #1151 spike — standalone react-pdf component tree for the `quote` document
 * type. NOT wired into `generate-pdf.ts` / `pdf-render.ts` — this is a
 * proof-of-concept sitting entirely outside the pdfme pipeline, per the
 * issue's "standalone (not yet wired in)" instruction. See
 * `docs/designs/react-pdf-migration-spike-findings.md` for the write-up this
 * component tree exists to produce.
 *
 * Compare against `composeDocument("quote", ...)` (document-composer.ts) +
 * `DOCUMENT_LAYOUTS.quote` (document-layouts.ts) — this file is the same
 * document, block-for-block, with ZERO manual page-break math: every
 * pagination decision below (table split, group-header repeat, orphan
 * control, T&Cs own-page, "Page X of Y") is Yoga's automatic layout, not a
 * hand-written height estimate that has to agree with a separate draw pass.
 */
import { Document, Page, View, Text } from "@react-pdf/renderer";
import type { DocumentData } from "@/lib/pdfme/types";
import type { ProjectDocumentType } from "@/lib/pdfme/document-layouts";
import { Header } from "./components/header";
import { DetailsRow } from "./components/details-row";
import { LineItemsTable } from "./components/line-items-table";
import { TotalsBlock } from "./components/totals-block";
import { DraftWatermark } from "./components/draft-watermark";
import { Footer } from "./components/footer";
import { RichText } from "./components/rich-text";
import { COLORS, FONT_SIZE, PAGE_MARGIN } from "./styles";
import { MARGIN, FOOTER_HEIGHT } from "@/lib/pdfme/template-constants";

// Room below the flowing content for the footer (see footer.tsx): the
// footer's own height plus a bit of clearance above it, same margin/gap
// values `template-constants.ts` already defines for the pdfme pipeline.
const PAGE_PADDING_BOTTOM = `${MARGIN + FOOTER_HEIGHT + 8}mm`;

const DRAFT_PREVIEW_TITLE = "DRAFT PREVIEW — NOT SENT";
const DRAFT_PREVIEW_SUBTITLE =
  "Live pricing, not frozen — this is not the document the client holds. Send the quote to produce that.";

export function QuoteDocument({ data, draftPreview = false }: { data: DocumentData; draftPreview?: boolean }) {
  const docType: ProjectDocumentType = "quote";
  const itemDiscountTotal = data.line_items.reduce((sum, li) => sum + (li.discount ?? 0), 0);

  const tableConfig = {
    documentType: docType,
    documentColor: data.org_document_color || "#0d4f4f",
    showGroupHeaders: true,
    showKitChildren: false,
    showCheckboxes: false,
    showConditionColumns: false,
    showPricing: true,
    showBadges: false,
    showNotes: true,
    showPerUnitCheckboxes: false,
    showAssetTags: false,
    showCategories: false,
    showRowNumbers: false,
    filterOptional: false,
    filterByStatus: null,
    hidePricingPeriodSuffix: true,
  } as const;

  return (
    <Document title={`${data.org_name} — Quote ${data.project_number}`}>
      <Page
        size="A4"
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
          <Header data={data} docType={docType} docTitle="QUOTE" />
        </View>

        {draftPreview && (
          <View fixed style={{ marginBottom: "3mm" }}>
            <DraftWatermark title={DRAFT_PREVIEW_TITLE} subtitle={DRAFT_PREVIEW_SUBTITLE} />
          </View>
        )}

        <View style={{ marginBottom: "4mm" }} wrap={false}>
          <DetailsRow data={data} />
        </View>

        <View style={{ marginBottom: "4mm" }}>
          <LineItemsTable items={data.line_items} config={tableConfig} docColor={tableConfig.documentColor} />
        </View>

        <View style={{ marginBottom: "4mm" }} wrap={false}>
          <TotalsBlock data={data} itemDiscountTotal={itemDiscountTotal} />
        </View>

        {data.client_notes && (
          <View style={{ marginBottom: "4mm" }}>
            <Text style={{ fontSize: FONT_SIZE.child, fontFamily: "Helvetica-Bold", color: COLORS.text, marginBottom: "1mm" }}>
              Notes
            </Text>
            <RichText text={data.client_notes} />
          </View>
        )}

        {data.terms_and_conditions && (
          // `break` forces this block onto its own page, mirroring
          // `document-layouts.ts`'s `{ kind: "termsAndConditions",
          // forceNewPage: true }`. Empirically verified (see the findings
          // doc + render-spike.ts's "freshpage" fixture) that `break`
          // does NOT insert a spurious blank page when the block already
          // happens to land first on a fresh page — react-pdf's own
          // splitting treats an already-out-of-bounds node as belonging to
          // the next page before `break` is ever consulted, so
          // `needsForcedPageBreak()`'s "isFreshPage" special case in
          // document-composer.ts has no react-pdf equivalent to port.
          <View break>
            <Text style={{ fontSize: FONT_SIZE.child, fontFamily: "Helvetica-Bold", color: COLORS.text, marginBottom: "1mm" }}>
              Terms & Conditions
            </Text>
            <RichText text={data.terms_and_conditions} />
          </View>
        )}

        <Footer text={data.document_footer_text || `${data.org_name} | ${data.org_email} | ${data.org_phone}`} />
      </Page>
    </Document>
  );
}
