import { Document, Page, Text, View } from "@react-pdf/renderer";
import { createStyles, formatDate, type PdfBranding } from "./styles";
import { PdfHeader } from "./pdf-header";

interface LineItem {
  id: string;
  description: string | null;
  quantity: number;
  status: string;
  groupName: string | null;
  isKitChild?: boolean;
  kitId?: string | null;
  isPrepChild?: boolean;
  prepId?: string | null;
  model: { name: string; modelNumber?: string | null } | null;
  asset: { assetTag: string } | null;
  bulkAsset: { assetTag: string } | null;
  kit?: { assetTag: string; name: string } | null;
  notes: string | null;
  isOverbooked?: boolean;
  overbookedInherited?: boolean;
  overbookedReducedOnly?: boolean;
  overbookedHasOverbooked?: boolean;
  overbookedHasReduced?: boolean;
  isSubhire?: boolean;
  showSubhireOnDocs?: boolean;
  childLineItems?: LineItem[];
}

interface ReturnSheetPDFProps {
  org: { name: string; branding?: PdfBranding; logoData?: string | null; iconData?: string | null };
  project: {
    projectNumber: string;
    name: string;
    loadOutDate: string | null;
    rentalEndDate: string | null;
    client: { name: string } | null;
    lineItems: LineItem[];
  };
}

function Checkbox({ size = 7 }: { size?: number }) {
  return (
    <View
      style={{
        width: size,
        height: size,
        borderWidth: 0.75,
        borderColor: "#333",
        borderRadius: 1,
      }}
    />
  );
}

function ConditionCheckboxes({ fontSize = 7 }: { fontSize?: number }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 3 }}>
      <Checkbox size={fontSize} />
      <Text style={{ fontSize, marginRight: 4 }}>Good</Text>
      <Checkbox size={fontSize} />
      <Text style={{ fontSize, marginRight: 4 }}>Dmg</Text>
      <Checkbox size={fontSize} />
      <Text style={{ fontSize }}>Missing</Text>
    </View>
  );
}

export function ReturnSheetPDF({ org, project }: ReturnSheetPDFProps) {
  const s = createStyles(org.branding);
  // Only include items that were checked out, exclude kit children
  const items = project.lineItems.filter(
    (i) => (i.status === "CHECKED_OUT" || i.status === "RETURNED") && !i.isKitChild && !i.isPrepChild
  );

  return (
    <Document>
      <Page size="A4" style={s.page}>
        {/* Header */}
        <PdfHeader
          orgName={org.name}
          orgDetails="Return Sheet"
          docTitle="RETURN SHEET"
          docMeta={`${project.projectNumber}\n${project.name}${project.client ? `\n${project.client.name}` : ""}${project.loadOutDate ? `\nLoad Out: ${formatDate(project.loadOutDate)}` : ""}`}
          branding={org.branding}
          logoData={org.logoData}
          iconData={org.iconData}
          styles={s}
        />

        {/* Table */}
        <View style={s.table}>
          <View style={s.tableHeader}>
            <Text style={[s.th, { width: 20, textAlign: "center" }]}>Ret</Text>
            <Text style={[s.th, { flex: 2 }]}>Item</Text>
            <Text style={[s.th, { width: 30, textAlign: "center" }]}>Qty</Text>
            <Text style={[s.th, { width: 80 }]}>Asset Tag</Text>
            <Text style={[s.th, { width: 80, textAlign: "center" }]}>Condition</Text>
            <Text style={[s.th, { flex: 1 }]}>Notes</Text>
          </View>

          {items.map((item, idx) => {
            const isKit = !!item.kitId && !item.isKitChild;
            const isPrep = !!item.prepId && !item.isPrepChild;
            const isGroup = isKit || isPrep;
            const children = isGroup ? (item.childLineItems || []) : [];
            return (
              <View key={item.id}>
                <View style={idx % 2 === 0 ? s.tableRow : s.tableRowAlt}>
                  <View style={[s.td, { width: 20, alignItems: "center", justifyContent: "center" }]}>
                    <Checkbox />
                  </View>
                  <View style={{ flex: 2 }}>
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
                      <Text style={s.td}>
                        {isKit
                          ? (item.description || item.kit?.name || "Kit")
                          : isPrep
                            ? (item.description || "Prep")
                            : item.model
                              ? `${item.model.name}${item.model.modelNumber ? ` (${item.model.modelNumber})` : ""}`
                              : item.description || "-"}
                      </Text>
                      {item.isOverbooked && item.overbookedHasOverbooked && item.overbookedHasReduced ? (
                        <>
                          <Text style={{ fontSize: 6, color: "#dc2626", backgroundColor: "#fee2e2", paddingHorizontal: 3, paddingVertical: 1, borderRadius: 2, fontFamily: "Helvetica-Bold" }}>OVERBOOKED</Text>
                          <Text style={{ fontSize: 6, color: "#7c3aed", backgroundColor: "#ede9fe", paddingHorizontal: 3, paddingVertical: 1, borderRadius: 2, fontFamily: "Helvetica-Bold" }}>REDUCED STOCK</Text>
                        </>
                      ) : item.isOverbooked ? (
                        <Text style={{ fontSize: 6, color: item.overbookedReducedOnly ? "#7c3aed" : item.overbookedInherited ? "#d97706" : "#dc2626", backgroundColor: item.overbookedReducedOnly ? "#ede9fe" : item.overbookedInherited ? "#fef3c7" : "#fee2e2", paddingHorizontal: 3, paddingVertical: 1, borderRadius: 2, fontFamily: "Helvetica-Bold" }}>{item.overbookedReducedOnly ? "REDUCED STOCK" : "OVERBOOKED"}</Text>
                      ) : null}
                      {item.isSubhire && item.showSubhireOnDocs && (
                        <Text style={{ fontSize: 6, color: "#0891b2", backgroundColor: "#cffafe", paddingHorizontal: 3, paddingVertical: 1, borderRadius: 2, fontFamily: "Helvetica-Bold" }}>SUBHIRE</Text>
                      )}
                    </View>
                    {item.notes && (
                      <Text style={{ fontSize: 7, color: "#888", marginTop: 1 }}>{item.notes}</Text>
                    )}
                  </View>
                  <Text style={[s.td, { width: 30, textAlign: "center" }]}>
                    {isGroup ? children.length : item.quantity}
                  </Text>
                  <Text style={[s.td, { width: 80, fontSize: 8, fontFamily: "Courier" }]}>
                    {isKit ? (item.kit?.assetTag || "-") : isPrep ? "-" : (item.asset?.assetTag || item.bulkAsset?.assetTag || "-")}
                  </Text>
                  <View style={[s.td, { width: 80, justifyContent: "center" }]}>
                    <ConditionCheckboxes />
                  </View>
                  <Text style={[s.td, { flex: 1 }]}> </Text>
                </View>
                {children.map((child) => (
                  <View key={child.id} style={s.tableRow}>
                    <View style={[s.td, { width: 20, alignItems: "center", justifyContent: "center" }]}>
                      <Checkbox size={6} />
                    </View>
                    <View style={{ flex: 2, paddingLeft: 12 }}>
                      <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
                        <Text style={[s.td, { fontSize: 8, color: "#555" }]}>
                          {child.model?.name || child.description || "-"}
                        </Text>
                        {child.isOverbooked && (
                          <Text style={{ fontSize: 6, color: child.overbookedReducedOnly ? "#7c3aed" : "#dc2626", backgroundColor: child.overbookedReducedOnly ? "#ede9fe" : "#fee2e2", paddingHorizontal: 3, paddingVertical: 1, borderRadius: 2, fontFamily: "Helvetica-Bold" }}>{child.overbookedReducedOnly ? "REDUCED STOCK" : "OVERBOOKED"}</Text>
                        )}
                      </View>
                    </View>
                    <Text style={[s.td, { width: 30, textAlign: "center", fontSize: 8 }]}>
                      {child.quantity}
                    </Text>
                    <Text style={[s.td, { width: 80, fontSize: 7, fontFamily: "Courier", color: "#555" }]}>
                      {child.asset?.assetTag || child.bulkAsset?.assetTag || "-"}
                    </Text>
                    <View style={[s.td, { width: 80, justifyContent: "center" }]}>
                      <ConditionCheckboxes fontSize={6} />
                    </View>
                    <Text style={[s.td, { flex: 1 }]}> </Text>
                  </View>
                ))}
              </View>
            );
          })}
        </View>

        {/* Sign-off */}
        <View style={{ marginTop: 40 }}>
          <View style={[s.row, { gap: 40 }]}>
            <View style={s.col}>
              <Text style={s.label}>Returned By</Text>
              <View style={{ borderBottomWidth: 0.5, borderBottomColor: "#ccc", marginTop: 30 }} />
              <Text style={[s.value, { marginTop: 4 }]}>Name / Signature</Text>
            </View>
            <View style={s.col}>
              <Text style={s.label}>Received By</Text>
              <View style={{ borderBottomWidth: 0.5, borderBottomColor: "#ccc", marginTop: 30 }} />
              <Text style={[s.value, { marginTop: 4 }]}>Name / Signature</Text>
            </View>
            <View style={{ width: 80 }}>
              <Text style={s.label}>Date</Text>
              <View style={{ borderBottomWidth: 0.5, borderBottomColor: "#ccc", marginTop: 30 }} />
            </View>
          </View>
        </View>

        {/* Footer */}
        <Text style={s.footer}>
          {org.name} | {project.projectNumber} | Printed {formatDate(new Date().toISOString())}
        </Text>
      </Page>
    </Document>
  );
}
