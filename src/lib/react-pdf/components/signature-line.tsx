/**
 * Signature block — port of gearflow-signature-line.ts. Used by return-sheet
 * ("Returned By"/"Received By"/"Date") and delivery-docket ("Delivered By"/
 * "Received By"/"Date"). The simplest of the 7 ported plugins: N equal-width
 * columns, each a label + a signature line, with a sub-label + second line
 * for columns that carry one (`subLabel` present). `wrap={false}` on the
 * whole block matches `document-layouts.ts`'s `{ kind: "signature" }` never
 * splitting across a page — pdfme achieved the same by placing it as one
 * schema; here it's one property.
 */
import { Text, View } from "@react-pdf/renderer";
import { COLORS } from "../styles";

export interface SignatureColumn {
  label: string;
  subLabel?: string;
}

const DEFAULT_COLUMNS: SignatureColumn[] = [
  { label: "Returned By", subLabel: "Name / Signature" },
  { label: "Received By", subLabel: "Name / Signature" },
  { label: "Date" },
];

function SignatureColumnBlock({ column }: { column: SignatureColumn }) {
  return (
    <View style={{ flex: 1 }}>
      <Text style={{ fontSize: 7, color: COLORS.muted, marginBottom: "13mm" }}>{column.label.toUpperCase()}</Text>
      <View style={{ borderBottomWidth: 0.5, borderBottomColor: "#cccccc", borderBottomStyle: "solid" }} />
      {column.subLabel && (
        <>
          <Text style={{ fontSize: 9, color: COLORS.text, marginTop: "3mm", marginBottom: "10mm" }}>{column.subLabel}</Text>
          <View style={{ borderBottomWidth: 0.5, borderBottomColor: "#cccccc", borderBottomStyle: "solid" }} />
          <Text style={{ fontSize: 9, color: COLORS.text, marginTop: "3mm" }}>Signature</Text>
        </>
      )}
    </View>
  );
}

export function SignatureLine({ columns = DEFAULT_COLUMNS }: { columns?: SignatureColumn[] }) {
  return (
    <View wrap={false} style={{ flexDirection: "row", justifyContent: "space-between" }}>
      {columns.map((column, i) => (
        <View key={column.label} style={{ marginRight: i < columns.length - 1 ? "10mm" : 0, flexGrow: 1, flexBasis: 0 }}>
          <SignatureColumnBlock column={column} />
        </View>
      ))}
    </View>
  );
}
