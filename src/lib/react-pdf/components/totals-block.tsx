/**
 * #1151 spike — financial totals block (subtotal, item discounts, discount,
 * tax, total, deposit/balance, due date). Mirrors
 * gearflow-financial-summary.ts's row set and ordering for the quote layout
 * (`defaultTotals`: subtotal/discount/tax/total on, deposit/balance/dueDate
 * off).
 */
import { Text, View } from "@react-pdf/renderer";
import type { DocumentData } from "@/lib/pdfme/types";
import { formatCurrency } from "@/lib/pdfme/plugins/helpers";
import { COLORS } from "../styles";

function Row({
  label,
  value,
  bold,
  divider,
  docColor,
}: {
  label: string;
  value: string;
  bold?: boolean;
  divider?: boolean;
  docColor: string;
}) {
  return (
    <View wrap={false}>
      {divider && <View style={{ borderTopWidth: 1, borderTopColor: docColor, borderTopStyle: "solid", marginTop: "1.5mm", marginBottom: "1.5mm" }} />}
      <View style={{ flexDirection: "row", justifyContent: "space-between", marginBottom: "1.5mm" }}>
        <Text style={{ fontSize: bold ? 9 : 9, fontFamily: bold ? "Helvetica-Bold" : "Helvetica", color: bold ? COLORS.text : COLORS.label }}>
          {label}
        </Text>
        <Text style={{ fontSize: bold ? 11 : 9, fontFamily: bold ? "Helvetica-Bold" : "Helvetica", color: COLORS.text }}>
          {value}
        </Text>
      </View>
    </View>
  );
}

export function TotalsBlock({ data, itemDiscountTotal }: { data: DocumentData; itemDiscountTotal: number }) {
  const docColor = data.org_document_color || "#0d4f4f";

  return (
    <View style={{ alignItems: "flex-end" }}>
      <View style={{ width: "56mm" }}>
        {itemDiscountTotal > 0 && (
          <>
            <Row label="Subtotal (before discounts)" value={formatCurrency(data.subtotal + itemDiscountTotal)} docColor={docColor} />
            <Row label="Item Discounts" value={`-${formatCurrency(itemDiscountTotal)}`} docColor={docColor} />
          </>
        )}
        <Row label="Subtotal" value={formatCurrency(data.subtotal)} docColor={docColor} />
        {data.discount_amount > 0 && (
          <Row
            label={data.discount_percent ? `Discount (${data.discount_percent}%)` : "Discount"}
            value={`-${formatCurrency(data.discount_amount)}`}
            docColor={docColor}
          />
        )}
        <Row label={data.tax_label || "GST"} value={formatCurrency(data.tax_amount)} docColor={docColor} />
        <Row label="Total" value={formatCurrency(data.total)} bold divider docColor={docColor} />
      </View>
    </View>
  );
}
