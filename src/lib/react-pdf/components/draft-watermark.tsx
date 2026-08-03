/**
 * #1151 spike — "DRAFT PREVIEW — NOT SENT" banner (mirrors
 * gearflow-draft-watermark.ts / #987). Rendered as page furniture (`fixed`)
 * by the caller, same as Header — see quote-document.tsx.
 *
 * gearflow-draft-watermark.ts normalises the em dash / curly quotes to plain
 * ASCII before drawing because pdf-lib's standard Helvetica font throws on
 * WinAnsi-incompatible characters. react-pdf/pdfkit's standard Helvetica did
 * NOT throw on the em dash in this spike's render — see the findings doc for
 * the actual test — but this component keeps the same normalisation as
 * cheap insurance until that's verified across every target platform/OS
 * font-rendering path, not just this container.
 */
import { Text, View } from "@react-pdf/renderer";

const BANNER_BG = "#fdeceb";
const BANNER_BORDER = "#b42318";
const TITLE_COLOR = "#b42318";
const SUBTITLE_COLOR = "#7a271a";

function toHelvetica(text: string): string {
  return text
    .replace(/[—–]/g, "-")
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"');
}

export function DraftWatermark({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <View
      style={{
        backgroundColor: BANNER_BG,
        borderWidth: 1,
        borderColor: BANNER_BORDER,
        borderStyle: "solid",
        paddingVertical: "2mm",
        paddingHorizontal: "3mm",
        alignItems: "center",
      }}
    >
      <Text style={{ fontSize: 14, fontFamily: "Helvetica-Bold", color: TITLE_COLOR, textAlign: "center" }}>
        {toHelvetica(title)}
      </Text>
      {subtitle && (
        <Text style={{ fontSize: 7.5, color: SUBTITLE_COLOR, textAlign: "center", marginTop: "1mm" }}>
          {toHelvetica(subtitle)}
        </Text>
      )}
    </View>
  );
}
