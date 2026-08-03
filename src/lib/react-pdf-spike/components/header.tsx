/**
 * #1151 spike — page header (logo/icon/none modes, org details, doc title +
 * meta, quote expiry / invoice due-date highlight line).
 *
 * Rendered as page furniture via the caller's `fixed` View (see
 * quote-document.tsx) — react-pdf repeats a `fixed` element on every page a
 * <Document> wraps to automatically. There is no `estimateBlockHeight`
 * "header" case to keep in sync with this component's actual draw size (the
 * whole point of #1151): Yoga measures this tree once and the same measured
 * height is what's reserved on every page.
 *
 * gearflow-page-header.ts's title has a hand-rolled "shrink font size in a
 * loop until it fits `maxTitleWidth`" step; react-pdf has no equivalent
 * (Text either wraps or doesn't — no auto-shrink-to-fit). For our
 * fixed-vocabulary titles (QUOTE / TAX INVOICE / PULL SLIP / …) that never
 * matters in practice — they always fit one line at 22pt — so this
 * component just right-aligns + lets it wrap. See the findings doc for
 * where that WOULD matter (a very long org-entered project label).
 */
import { Text, View, Image } from "@react-pdf/renderer";
import type { DocumentData } from "@/lib/pdfme/types";
import type { ProjectDocumentType } from "@/lib/pdfme/document-layouts";
import { COLORS, FONT_SIZE } from "../styles";

export function Header({
  data,
  docType,
  docTitle,
}: {
  data: DocumentData;
  docType: ProjectDocumentType;
  docTitle: string;
}) {
  const docColor = data.org_document_color || "#0d4f4f";
  const mode = data.org_branding?.documentLogoMode ?? "icon";
  const showOrgName = (data.org_branding?.showOrgNameOnDocuments ?? true) && !!data.org_name;

  const orgDetailLines: string[] = [];
  if (data.org_address) orgDetailLines.push(data.org_address);
  if (data.org_phone) orgDetailLines.push(data.org_phone);
  if (data.org_email) orgDetailLines.push(data.org_email);
  if (data.org_abn) orgDetailLines.push(`${data.org_business_number_label}: ${data.org_abn}`);
  if (data.org_website) orgDetailLines.push(data.org_website);

  const metaLines = [data.project_number || "", data.document_date || ""];
  if (docType === "quote" && data.quote_valid_until) metaLines.push(`Expiry: ${data.quote_valid_until}`);

  const highlightMeta = docType === "invoice" && data.invoice_due_date ? `Due: ${data.invoice_due_date}` : undefined;

  return (
    <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" }}>
      <View style={{ flexDirection: mode === "icon" ? "row" : "column", alignItems: mode === "icon" ? "center" : "flex-start", maxWidth: "50%" }}>
        {mode === "logo" && data.org_logo && (
          // eslint-disable-next-line jsx-a11y/alt-text -- react-pdf's <Image> renders into a PDF content stream, not the DOM; its ImageProps has no `alt` prop to set (the a11y rule assumes web <img>).
          <Image src={data.org_logo} style={{ maxWidth: "50mm", maxHeight: "18mm", marginBottom: "3mm", objectFit: "contain" }} />
        )}
        {mode === "icon" && data.org_icon && (
          // eslint-disable-next-line jsx-a11y/alt-text -- see reason above.
          <Image src={data.org_icon} style={{ width: "12mm", height: "12mm", marginRight: "3mm", objectFit: "contain" }} />
        )}
        <View>
          {showOrgName && (
            <Text style={{ fontSize: FONT_SIZE.orgName, fontFamily: "Helvetica-Bold", color: docColor, marginBottom: "1.5mm" }}>
              {data.org_name}
            </Text>
          )}
          {orgDetailLines.map((line) => (
            <Text key={line} style={{ fontSize: FONT_SIZE.child, color: COLORS.label, marginBottom: "0.5mm" }}>
              {line}
            </Text>
          ))}
        </View>
      </View>

      <View style={{ alignItems: "flex-end", maxWidth: "50%" }}>
        <Text style={{ fontSize: FONT_SIZE.title, fontFamily: "Helvetica-Bold", color: docColor, textAlign: "right" }}>
          {docTitle}
        </Text>
        {metaLines
          .filter(Boolean)
          .map((line) => (
            <Text key={line} style={{ fontSize: FONT_SIZE.base, color: COLORS.label, textAlign: "right", marginTop: "1mm" }}>
              {line}
            </Text>
          ))}
        {highlightMeta && (
          <Text style={{ fontSize: 10, fontFamily: "Helvetica-Bold", color: docColor, textAlign: "right", marginTop: "1mm" }}>
            {highlightMeta}
          </Text>
        )}
      </View>
    </View>
  );
}
