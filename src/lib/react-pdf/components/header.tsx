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

type LogoMode = "logo" | "icon" | "none";

function buildOrgDetailLines(data: DocumentData): string[] {
  return [
    data.org_address,
    data.org_phone,
    data.org_email,
    data.org_abn ? `${data.org_business_number_label}: ${data.org_abn}` : null,
    data.org_website,
  ].filter((line): line is string => !!line);
}

function buildMetaLines(data: DocumentData, docType: ProjectDocumentType): string[] {
  const lines = [data.project_number || "", data.document_date || ""];
  if (docType === "quote" && data.quote_valid_until) lines.push(`Expiry: ${data.quote_valid_until}`);
  return lines.filter(Boolean);
}

function buildHighlightMeta(data: DocumentData, docType: ProjectDocumentType): string | undefined {
  return docType === "invoice" && data.invoice_due_date ? `Due: ${data.invoice_due_date}` : undefined;
}

function HeaderImage({ mode, data }: { mode: LogoMode; data: DocumentData }) {
  if (mode === "logo" && data.org_logo) {
    return (
      // eslint-disable-next-line jsx-a11y/alt-text -- react-pdf's <Image> renders into a PDF content stream, not the DOM; its ImageProps has no `alt` prop to set (the a11y rule assumes web <img>).
      <Image src={data.org_logo} style={{ maxWidth: "50mm", maxHeight: "18mm", marginBottom: "3mm", objectFit: "contain" }} />
    );
  }
  if (mode === "icon" && data.org_icon) {
    return (
      // eslint-disable-next-line jsx-a11y/alt-text -- see reason above.
      <Image src={data.org_icon} style={{ width: "12mm", height: "12mm", marginRight: "3mm", objectFit: "contain" }} />
    );
  }
  return null;
}

function HeaderLeftColumn({ data, mode }: { data: DocumentData; mode: LogoMode }) {
  const showOrgName = (data.org_branding?.showOrgNameOnDocuments ?? true) && !!data.org_name;
  const docColor = data.org_document_color || "#0d4f4f";

  return (
    <View style={{ flexDirection: mode === "icon" ? "row" : "column", alignItems: mode === "icon" ? "center" : "flex-start", maxWidth: "50%" }}>
      <HeaderImage mode={mode} data={data} />
      <View>
        {showOrgName && (
          <Text style={{ fontSize: FONT_SIZE.orgName, fontFamily: "Helvetica-Bold", color: docColor, marginBottom: "1.5mm" }}>
            {data.org_name}
          </Text>
        )}
        {buildOrgDetailLines(data).map((line) => (
          <Text key={line} style={{ fontSize: FONT_SIZE.child, color: COLORS.label, marginBottom: "0.5mm" }}>
            {line}
          </Text>
        ))}
      </View>
    </View>
  );
}

function HeaderRightColumn({ data, docType, docTitle }: { data: DocumentData; docType: ProjectDocumentType; docTitle: string }) {
  const docColor = data.org_document_color || "#0d4f4f";
  const highlightMeta = buildHighlightMeta(data, docType);

  return (
    <View style={{ alignItems: "flex-end", maxWidth: "50%" }}>
      <Text style={{ fontSize: FONT_SIZE.title, fontFamily: "Helvetica-Bold", color: docColor, textAlign: "right" }}>
        {docTitle}
      </Text>
      {buildMetaLines(data, docType).map((line) => (
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
  );
}

export function Header({
  data,
  docType,
  docTitle,
}: {
  data: DocumentData;
  docType: ProjectDocumentType;
  docTitle: string;
}) {
  const mode: LogoMode = data.org_branding?.documentLogoMode ?? "icon";

  return (
    <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" }}>
      <HeaderLeftColumn data={data} mode={mode} />
      <HeaderRightColumn data={data} docType={docType} docTitle={docTitle} />
    </View>
  );
}
