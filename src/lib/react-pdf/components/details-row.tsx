/**
 * #1151 spike — client/project two-column details row (quote's
 * `defaultClientDetails`/`defaultProjectDetails` config from
 * document-layouts.ts).
 *
 * #1153 extended this with an optional `config` for the fields invoice's
 * layout turns on (`showClientTaxId`/`showPaymentTerms`/`showInvoiceNumber` —
 * see document-composer.ts's `detailsRow` case, the source these mirror).
 * Quote passes no config, so its rendering is unchanged.
 */
import { Text, View } from "@react-pdf/renderer";
import type { DocumentData } from "@/lib/pdfme/types";
import { COLORS, FONT_SIZE } from "../styles";

export interface DetailsRowConfig {
  showClientTaxId?: boolean;
  showPaymentTerms?: boolean;
  showInvoiceNumber?: boolean;
}

function formatDateRange(label: string, start: string, end: string): string | null {
  if (!start || start === "-") return null;
  const endPart = end && end !== "-" ? ` - ${end}` : "";
  return `${label}: ${start}${endPart}`;
}

export function buildClientLines(data: DocumentData, config: DetailsRowConfig): string[] {
  return [
    data.client_name,
    data.client_contact ? `Attn: ${data.client_contact}` : null,
    data.client_email,
    data.client_billing_address,
    // Same country-derived label as the org's own number in the header (I4,
    // #1083) — it names the org's home-jurisdiction registration-number
    // format, not a per-party thing.
    config.showClientTaxId && data.client_tax_id ? `${data.org_business_number_label}: ${data.client_tax_id}` : null,
  ].filter((line): line is string => !!line);
}

export function buildProjectLines(data: DocumentData, config: DetailsRowConfig): string[] {
  return [
    data.project_name,
    data.venue_name ? `Venue: ${data.venue_name}` : null,
    formatDateRange("Rental", data.rental_start, data.rental_end),
    formatDateRange("Event", data.event_start, data.event_end),
    config.showPaymentTerms && data.client_payment_terms ? `Payment Terms: ${data.client_payment_terms}` : null,
    // WS1 (#940) — only renders once the invoice has actually been ISSUED
    // (build-document-data.ts resolves this to "" for a DRAFT-only project,
    // and the guard here matches every other conditional line above).
    config.showInvoiceNumber && data.invoice_number ? `Invoice #: ${data.invoice_number}` : null,
  ].filter((line): line is string => !!line);
}

function DetailsColumn({ lines }: { lines: string[] }) {
  return (
    <View style={{ width: "48%" }}>
      {lines.map((line, i) => (
        <Text
          key={line}
          style={{ fontSize: FONT_SIZE.base, color: COLORS.text, fontFamily: i === 0 ? "Helvetica-Bold" : "Helvetica", marginBottom: "0.5mm" }}
        >
          {line}
        </Text>
      ))}
    </View>
  );
}

export function DetailsRow({ data, config = {} }: { data: DocumentData; config?: DetailsRowConfig }) {
  return (
    <View style={{ flexDirection: "row", justifyContent: "space-between" }} wrap={false}>
      <DetailsColumn lines={buildClientLines(data, config)} />
      <DetailsColumn lines={buildProjectLines(data, config)} />
    </View>
  );
}
