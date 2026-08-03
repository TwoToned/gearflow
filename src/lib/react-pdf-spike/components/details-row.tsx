/**
 * #1151 spike — client/project two-column details row (quote's
 * `defaultClientDetails`/`defaultProjectDetails` config from
 * document-layouts.ts).
 */
import { Text, View } from "@react-pdf/renderer";
import type { DocumentData } from "@/lib/pdfme/types";
import { COLORS, FONT_SIZE } from "../styles";

export function DetailsRow({ data }: { data: DocumentData }) {
  const clientLines: string[] = [];
  if (data.client_name) clientLines.push(data.client_name);
  if (data.client_contact) clientLines.push(`Attn: ${data.client_contact}`);
  if (data.client_email) clientLines.push(data.client_email);
  if (data.client_billing_address) clientLines.push(data.client_billing_address);

  const projectLines: string[] = [data.project_name];
  if (data.venue_name) projectLines.push(`Venue: ${data.venue_name}`);
  if (data.rental_start && data.rental_start !== "-") {
    const end = data.rental_end && data.rental_end !== "-" ? ` - ${data.rental_end}` : "";
    projectLines.push(`Rental: ${data.rental_start}${end}`);
  }
  if (data.event_start && data.event_start !== "-") {
    const end = data.event_end && data.event_end !== "-" ? ` - ${data.event_end}` : "";
    projectLines.push(`Event: ${data.event_start}${end}`);
  }

  return (
    <View style={{ flexDirection: "row", justifyContent: "space-between" }} wrap={false}>
      <View style={{ width: "48%" }}>
        {clientLines.map((line, i) => (
          <Text
            key={line}
            style={{ fontSize: FONT_SIZE.base, color: COLORS.text, fontFamily: i === 0 ? "Helvetica-Bold" : "Helvetica", marginBottom: "0.5mm" }}
          >
            {line}
          </Text>
        ))}
      </View>
      <View style={{ width: "48%" }}>
        {projectLines.map((line, i) => (
          <Text
            key={line}
            style={{ fontSize: FONT_SIZE.base, color: COLORS.text, fontFamily: i === 0 ? "Helvetica-Bold" : "Helvetica", marginBottom: "0.5mm" }}
          >
            {line}
          </Text>
        ))}
      </View>
    </View>
  );
}
