/**
 * #1151 spike — page footer with "Page X of Y".
 *
 * document-composer.ts computes `Page ${i+1} of ${pages.length}` itself,
 * because it already knows the full page count up front (it built the whole
 * multi-page layout before generating a single schema). react-pdf doesn't
 * expose the page count until the WHOLE document has been laid out either —
 * but it doesn't need to: `<Text render={({pageNumber, totalPages}) => ...}>`
 * defers that string to render time, so nothing upstream has to compute or
 * thread a page count through at all. One line replaces the composer's
 * `pages.length > 1 ? ... : undefined` branch entirely.
 */
import { Text, View } from "@react-pdf/renderer";
import { COLORS, FONT_SIZE } from "../styles";

export function Footer({ text, secondLine }: { text: string; secondLine?: string }) {
  return (
    <View
      fixed
      style={{
        position: "absolute",
        bottom: "6mm",
        left: "14mm",
        right: "14mm",
        borderTopWidth: 0.5,
        borderTopColor: COLORS.footerBorder,
        borderTopStyle: "solid",
        paddingTop: "2mm",
        flexDirection: "row",
        justifyContent: "center",
      }}
    >
      <View style={{ alignItems: "center" }}>
        <Text style={{ fontSize: FONT_SIZE.footer, color: COLORS.footerText }}>{text}</Text>
        {secondLine && <Text style={{ fontSize: FONT_SIZE.footer, color: COLORS.footerText }}>{secondLine}</Text>}
      </View>
      <Text
        style={{ position: "absolute", right: 0, width: "30mm", textAlign: "right", fontSize: FONT_SIZE.footer, color: COLORS.footerText }}
        render={({ pageNumber, totalPages }) => (totalPages > 1 ? `Page ${pageNumber} of ${totalPages}` : "")}
      />
    </View>
  );
}
