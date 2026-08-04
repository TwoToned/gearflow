/**
 * gearflowFinancialSummary → react-pdf port. Row set and ordering mirror
 * gearflow-financial-summary.ts exactly: subtotal (+ optional pre-discount
 * transparency rows), discount, tax, Total (bold, divider), then — invoice
 * only — Deposit Paid / Balance Due / Due Date. `document-layouts.ts`'s
 * `defaultTotals` turns the last 3 off for quote; invoice's totals config
 * turns `showDeposit`/`showBalance`/`showDueDate` on, so this component
 * gates each on the corresponding data being present rather than on a
 * separate config flag — `depositPaid > 0`/`dueDate` truthy is the same
 * "has something to show" gate the pdfme original uses.
 *
 * The divider line above "Total" has a documented history of visually
 * touching the Total text on real pdfme renders (2026-07-27, 2026-07-28 x2)
 * — tuned there to a hand-picked 6pt-before/13pt-after gap. Yoga's automatic
 * sizing of the `<Text>` above/below the `<View>` divider here means there's
 * no manual baseline-vs-line-position math to get wrong, but the clearance
 * should still be verified visually once this renders in a real doc type
 * (issue #3's invoice port is the first to exercise the deposit/balance/
 * due-date rows below).
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
        {data.deposit_paid > 0 && (
          <>
            <Row label="Deposit Paid" value={`-${formatCurrency(data.deposit_paid)}`} docColor={docColor} />
            <Row label="Balance Due" value={formatCurrency(data.balance_due)} bold docColor={docColor} />
          </>
        )}
        {/* Bottom-most, bold — the amount owed and the date it's owed by are
         *  read together (invoice only; quote never populates this field). */}
        {data.invoice_due_date && <Row label="Due Date" value={data.invoice_due_date} bold docColor={docColor} />}
      </View>
    </View>
  );
}
