/**
 * #1151 spike — client/project two-column details row (quote's
 * `defaultClientDetails`/`defaultProjectDetails` config from
 * document-layouts.ts).
 */
import { Text, View } from "@react-pdf/renderer";
import type { DocumentData } from "@/lib/pdfme/types";
import { COLORS, FONT_SIZE } from "../styles";

function formatDateRange(label: string, start: string, end: string): string | null {
  if (!start || start === "-") return null;
  const endPart = end && end !== "-" ? ` - ${end}` : "";
  return `${label}: ${start}${endPart}`;
}

function buildClientLines(data: DocumentData): string[] {
  return [
    data.client_name,
    data.client_contact ? `Attn: ${data.client_contact}` : null,
    data.client_email,
    data.client_billing_address,
  ].filter((line): line is string => !!line);
}

function buildProjectLines(data: DocumentData): string[] {
  return [
    data.project_name,
    data.venue_name ? `Venue: ${data.venue_name}` : null,
    formatDateRange("Rental", data.rental_start, data.rental_end),
    formatDateRange("Event", data.event_start, data.event_end),
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

export function DetailsRow({ data }: { data: DocumentData }) {
  return (
    <View style={{ flexDirection: "row", justifyContent: "space-between" }} wrap={false}>
      <DetailsColumn lines={buildClientLines(data)} />
      <DetailsColumn lines={buildProjectLines(data)} />
    </View>
  );
}
