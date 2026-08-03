/**
 * #1151 spike — markdown-lite renderer for notes / client notes / T&Cs /
 * payment details.
 *
 * Reuses pdfme's `parseRichText` (the parsing logic — **bold**, *italic*,
 * "- "/"* " bullets — is content-shape logic, not draw logic, so keeping ONE
 * parser is the DRY move even mid-migration; see FEATUREDOCS/13's "PDF
 * Data-Shape Consumers" note). What's NOT reused is pdfme's `wrapRichText` /
 * `measureRichTextHeight` / `richTextLineHeight` — those exist ONLY because
 * pdf-lib can't wrap text or measure wrapped height itself. react-pdf's
 * <Text> wraps to its container width and paginates automatically (Yoga), so
 * there's no separate "how many lines will this wrap to" pass to keep in
 * sync with the real draw — the bug class in FEATUREDOCS/13's "Known
 * structural weakness" note can't occur inside this component. See the spike
 * findings doc for the full comparison.
 */
import { Text, View } from "@react-pdf/renderer";
import { parseRichText } from "@/lib/pdfme/plugins/helpers";

export function RichText({
  text,
  fontSize = 8,
  color = "#666666",
  bulletWidth = 9,
}: {
  text: string;
  fontSize?: number;
  color?: string;
  bulletWidth?: number;
}) {
  if (!text) return null;
  const lines = parseRichText(text);

  return (
    <View>
      {lines.map((line, i) => (
        <View key={i} style={{ flexDirection: "row" }} wrap={false}>
          {line.bullet && (
            <Text style={{ fontSize, color, width: bulletWidth }}>{"• "}</Text>
          )}
          <Text style={{ fontSize, color, flex: 1, lineHeight: 1.3 }}>
            {line.spans.map((span, j) => (
              <Text
                key={j}
                style={
                  span.style === "bold"
                    ? { fontFamily: "Helvetica-Bold" }
                    : span.style === "italic"
                      ? { fontFamily: "Helvetica-Oblique" }
                      : undefined
                }
              >
                {span.text}
              </Text>
            ))}
          </Text>
        </View>
      ))}
    </View>
  );
}
