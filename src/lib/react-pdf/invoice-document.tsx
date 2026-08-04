/**
 * #1153 — standalone react-pdf component tree for the `invoice` document
 * type. Same status as `quote-document.tsx`: NOT wired into
 * `generate-pdf.ts`/`pdf-render.ts` (that's a later issue in the #1150
 * sequence — see FEATUREDOCS/13-pdfs.md), and composes its blocks directly
 * in JSX rather than walking `DOCUMENT_LAYOUTS.invoice` (porting the
 * declarative layout table itself was explicitly deferred by #1152).
 *
 * Shares `clientFacingTable` and every component with `quote-document.tsx`
 * (issue 1's spike) — the delta, all mirroring `document-composer.ts`'s
 * `invoice`-specific branches:
 * - `showClientTaxId`/`showPaymentTerms`/`showInvoiceNumber` in `DetailsRow`
 * - the `org_invoice_heading` country-derived title override (I4, #1083)
 * - `TotalsBlock`'s Deposit Paid / Balance Due / Due Date rows (already
 *   data-gated in the component from #1152 — nothing to wire here)
 * - the `Header`'s bold "Due: <date>" highlight (also already data-gated)
 * - the `paymentDetails` block (bank details) directly after the totals
 *   block, sharing the same free-text/markdown-lite convention as T&Cs but
 *   never forcing a new page
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

const PAGE_PADDING_BOTTOM = `${MARGIN + FOOTER_HEIGHT + 8}mm`;

const DRAFT_PREVIEW_TITLE = "DRAFT PREVIEW — NOT SENT";
const DRAFT_PREVIEW_SUBTITLE = "Live pricing, not frozen — this invoice has not been issued and has no invoice number.";

export function InvoiceDocument({ data, draftPreview = false }: { data: DocumentData; draftPreview?: boolean }) {
  const docType: ProjectDocumentType = "invoice";
  const itemDiscountTotal = data.line_items.reduce((sum, li) => sum + (li.discount ?? 0), 0);
  // I4 (#1083) — "TAX INVOICE" for AU/NZ, "INVOICE" elsewhere; falls back to
  // the generic heading when the org's country doesn't resolve one.
  const docTitle = data.org_invoice_heading || "TAX INVOICE";

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
    <Document title={`${data.org_name} — Invoice ${data.invoice_number || data.project_number}`}>
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
          <Header data={data} docType={docType} docTitle={docTitle} />
        </View>

        {draftPreview && (
          <View fixed style={{ marginBottom: "3mm" }}>
            <DraftWatermark title={DRAFT_PREVIEW_TITLE} subtitle={DRAFT_PREVIEW_SUBTITLE} />
          </View>
        )}

        <View style={{ marginBottom: "4mm" }} wrap={false}>
          <DetailsRow data={data} config={{ showClientTaxId: true, showPaymentTerms: true, showInvoiceNumber: true }} />
        </View>

        <View style={{ marginBottom: "4mm" }}>
          <LineItemsTable items={data.line_items} config={tableConfig} docColor={tableConfig.documentColor} />
        </View>

        <View style={{ marginBottom: "4mm" }} wrap={false}>
          <TotalsBlock data={data} itemDiscountTotal={itemDiscountTotal} />
        </View>

        {data.payment_details && (
          <View style={{ marginBottom: "4mm" }}>
            <Text style={{ fontSize: FONT_SIZE.child, fontFamily: "Helvetica-Bold", color: COLORS.text, marginBottom: "1mm" }}>
              Payment Details
            </Text>
            <RichText text={data.payment_details} />
          </View>
        )}

        {data.client_notes && (
          <View style={{ marginBottom: "4mm" }}>
            <Text style={{ fontSize: FONT_SIZE.child, fontFamily: "Helvetica-Bold", color: COLORS.text, marginBottom: "1mm" }}>
              Notes
            </Text>
            <RichText text={data.client_notes} />
          </View>
        )}

        {data.terms_and_conditions && (
          // `break` forces this block onto its own page — see
          // quote-document.tsx's comment for why this doesn't insert a
          // spurious blank page when the block already lands first on a
          // fresh page.
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
