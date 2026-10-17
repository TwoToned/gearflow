/**
 * Item labels (FEATUREDOCS/83) — one label per loose item (a drum shield, a
 * stand, a hired-in desk): the same header and client/project/dates blocks as
 * the container and kit labels, with the one item in the contents band and a QR
 * of its asset tag. Label models come from `container-labels.ts`
 * (`buildItemLabels`); this file only draws.
 *
 * Three shapes of item, one layout: a serialised unit (tag + QR), a bulk line
 * (the pool's tag + QR, quantity up front) and a custom / sub-hired line (no
 * tag, so no QR — the quantity and, for a sub-hire, the supplier carry it).
 */
import { Document, Page, View, Text } from "@react-pdf/renderer";
import type { DocumentData } from "@/lib/pdfme/types";
import { buildItemLabels, type ItemLabel } from "@/lib/pdfme/container-labels";
import { COLORS, PAGE_MARGIN, lightenHex, pageSizeFor } from "./styles";
import { Block, LabelHeader, joinDates } from "./container-label-document";
import { QrCode } from "./components/qr-code";

const KIND_NOUN: Record<ItemLabel["kind"], string> = { ASSET: "Item", BULK: "Bulk item", CUSTOM: "Custom item" };

function subtitleFor(label: ItemLabel): string {
  const parts = [
    label.supplierName != null ? `Sub-hire${label.supplierName ? ` · ${label.supplierName}` : ""}` : KIND_NOUN[label.kind],
    label.tag,
  ];
  return parts.filter(Boolean).join(" · ");
}

function ItemSingleLabel({ data, label, color }: { data: DocumentData; label: ItemLabel; color: string }) {
  const rental = joinDates(data.rental_start, data.rental_end);
  const event = joinDates(data.event_start, data.event_end);
  const itemCount = label.qty + label.accessories.reduce((s, a) => s + a.qty, 0);
  return (
    <View wrap={false} style={{ borderWidth: 0.6, borderStyle: "dashed", borderColor: "#999999", paddingVertical: "5mm", paddingHorizontal: "6mm", marginBottom: "5mm" }}>
      <LabelHeader data={data} title={label.title} subtitle={subtitleFor(label)} color={color} />
      <View style={{ flexDirection: "row", marginTop: "4mm" }}>
        <Block caption="Client">
          <Text style={{ fontSize: 10, fontFamily: "Helvetica-Bold" }}>{data.client_name || "-"}</Text>
        </Block>
        <View style={{ width: "3mm" }} />
        <Block caption="Project">
          <Text style={{ fontSize: 10, fontFamily: "Helvetica-Bold" }}>{data.project_name || "-"}</Text>
        </Block>
        <View style={{ width: "3mm" }} />
        <Block caption="Dates" flex={1.2}>
          {rental ? <Text style={{ fontSize: 9 }}>Rental: {rental}</Text> : null}
          {event ? <Text style={{ fontSize: 9 }}>Event: {event}</Text> : null}
        </Block>
      </View>
      <View style={{ flexDirection: "row", justifyContent: "space-between", backgroundColor: lightenHex(color, 0.88), paddingVertical: "1.6mm", paddingHorizontal: "3mm", marginTop: "4mm" }}>
        <Text style={{ fontSize: 9, fontFamily: "Helvetica-Bold", color }}>Item</Text>
        <Text style={{ fontSize: 9, fontFamily: "Helvetica-Bold", color }}>
          {itemCount} {itemCount === 1 ? "item" : "items"}
        </Text>
      </View>
      <View style={{ flexDirection: "row", alignItems: "center", paddingVertical: "3mm", paddingHorizontal: "3mm" }}>
        <View style={{ flex: 1 }}>
          <View style={{ flexDirection: "row" }}>
            <Text style={{ width: "9mm", fontFamily: "Helvetica-Bold", fontSize: 11, textAlign: "right", paddingRight: "2mm" }}>{label.qty}x</Text>
            <View style={{ flex: 1 }}>
              <Text style={{ fontSize: 11 }}>{label.title}</Text>
              {label.subtitle ? <Text style={{ fontSize: 8, color: COLORS.label, marginTop: "0.5mm" }}>{label.subtitle}</Text> : null}
              {label.tag ? <Text style={{ fontSize: 12, fontFamily: "Courier-Bold", marginTop: "1.5mm" }}>{label.tag}</Text> : null}
            </View>
          </View>
          {label.accessories.map((a) => (
            <View key={a.name} style={{ flexDirection: "row", alignItems: "center", marginTop: "1.5mm", paddingLeft: "12mm" }}>
              <Text style={{ fontSize: 8, color, fontFamily: "Helvetica-Bold", marginRight: "1mm" }}>+</Text>
              <Text style={{ fontSize: 8, color: COLORS.childText }}>{a.qty}x {a.name}</Text>
            </View>
          ))}
        </View>
        {label.tag ? <QrCode value={label.tag} sizeMm={30} /> : null}
      </View>
    </View>
  );
}

export function ItemLabelDocument({ data, labelId }: { data: DocumentData; /** Print just this item label (its `ItemLabel.id`). */ labelId?: string }) {
  const color = data.org_document_color || "#0d4f4f";
  const all = buildItemLabels(data.line_items);
  const labels = labelId ? all.filter((l) => l.id === labelId) : all;
  return (
    <Document title={`${data.org_name} — Item labels ${data.project_number}`}>
      <Page size={pageSizeFor(data.org_paper_size)} wrap style={{ padding: PAGE_MARGIN, fontFamily: "Helvetica", fontSize: 9, color: COLORS.text }}>
        {labels.length === 0 ? (
          <Text style={{ fontSize: 11, color: COLORS.label }}>
            {`No loose items on this job${labelId ? " match that label" : ""}.`}
          </Text>
        ) : (
          labels.map((l) => <ItemSingleLabel key={l.id} data={data} label={l} color={color} />)
        )}
      </Page>
    </Document>
  );
}
