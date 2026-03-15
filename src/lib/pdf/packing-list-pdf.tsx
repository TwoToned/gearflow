import { Document, Page, Text, View } from "@react-pdf/renderer";
import { createStyles, formatDate, type PdfBranding } from "./styles";
import { PdfHeader } from "./pdf-header";

interface LineItem {
  id: string;
  description: string | null;
  quantity: number;
  groupName: string | null;
  status: string;
  isKitChild?: boolean;
  kitId?: string | null;
  model: {
    name: string;
    modelNumber?: string | null;
    weight?: number | null;
    category?: { name: string } | null;
  } | null;
  asset: { assetTag: string } | null;
  bulkAsset: { assetTag: string } | null;
  kit?: { assetTag: string; name: string; isPrep?: boolean } | null;
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

interface PullSlipPDFProps {
  org: { name: string; branding?: PdfBranding; logoData?: string | null; iconData?: string | null };
  project: {
    projectNumber: string;
    name: string;
    loadInDate: string | null;
    rentalStartDate: string | null;
    client: { name: string } | null;
    location: { name: string } | null;
    lineItems: LineItem[];
  };
}

export function PullSlipPDF({ org, project }: PullSlipPDFProps) {
  const s = createStyles(org.branding);
  // Filter out kit children (they'll be rendered under their parent)
  const equipmentItems = project.lineItems.filter(
    (i) => i.status !== "CANCELLED" && !i.isKitChild
  );

  // Group by groupName
  const groups = new Map<string, LineItem[]>();
  for (const item of equipmentItems) {
    const key = item.groupName || "Ungrouped";
    const arr = groups.get(key) || [];
    arr.push(item);
    groups.set(key, arr);
  }

  const totalItems = equipmentItems.reduce((sum, i) => sum + i.quantity, 0);
  const totalWeight = equipmentItems.reduce((sum, i) => {
    const w = i.model?.weight ? Number(i.model.weight) : 0;
    return sum + w * i.quantity;
  }, 0);

  return (
    <Document>
      <Page size="A4" style={s.page}>
        {/* Header */}
        <PdfHeader
          orgName={org.name}
          orgDetails="Pull Slip"
          docTitle="PULL SLIP"
          docMeta={`${project.projectNumber}\n${project.name}${project.client ? `\n${project.client.name}` : ""}`}
          branding={org.branding}
          logoData={org.logoData}
          iconData={org.iconData}
          styles={s}
        />

        {/* Info row */}
        <View style={[s.row, { marginBottom: 12 }]}>
          {project.location && (
            <View style={s.col}>
              <Text style={s.label}>Venue</Text>
              <Text style={s.value}>{project.location.name}</Text>
            </View>
          )}
          {project.loadInDate && (
            <View style={s.col}>
              <Text style={s.label}>Load In</Text>
              <Text style={s.value}>{formatDate(project.loadInDate)}</Text>
            </View>
          )}
          <View style={s.col}>
            <Text style={s.label}>Total Items</Text>
            <Text style={s.value}>{totalItems}</Text>
          </View>
          {totalWeight > 0 && (
            <View style={s.col}>
              <Text style={s.label}>Est. Weight</Text>
              <Text style={s.value}>{totalWeight.toFixed(1)} kg</Text>
            </View>
          )}
        </View>

        {/* Items table */}
        <View style={s.table}>
          <View style={s.tableHeader}>
            <View style={[s.th, { width: 20, alignItems: "center", justifyContent: "center" }]}>
              <View style={{ width: 7, height: 7, borderWidth: 0.75, borderColor: "#fff", borderRadius: 1 }} />
            </View>
            <Text style={[s.th, { flex: 3 }]}>Item</Text>
            <Text style={[s.th, { width: 30, textAlign: "center" }]}>Qty</Text>
            <Text style={[s.th, { width: 80 }]}>Asset Tag</Text>
            <Text style={[s.th, { width: 70 }]}>Category</Text>
          </View>

          {Array.from(groups.entries()).map(([groupName, items]) => (
            <View key={groupName}>
              {groupName !== "Ungrouped" && (
                <View style={s.groupHeader}>
                  <Text style={s.groupName}>{groupName}</Text>
                </View>
              )}
              {items.map((item, idx) => {
                const isKit = !!item.kitId && !item.isKitChild;
                const isGroup = isKit;
                const children = isGroup ? (item.childLineItems || []) : [];
                return (
                  <View key={item.id}>
                    <View style={idx % 2 === 0 ? s.tableRow : s.tableRowAlt}>
                      <View style={[s.td, { width: 20, alignItems: "center", justifyContent: "center" }]}>
                        <View style={{ width: 7, height: 7, borderWidth: 0.75, borderColor: "#333", borderRadius: 1 }} />
                      </View>
                      <View style={{ flex: 3 }}>
                        <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
                          <Text style={[s.td, { fontFamily: isGroup ? "Helvetica-Bold" : "Helvetica" }]}>
                            {isKit
                              ? `[${item.kit?.isPrep ? "Prep" : "Kit"}] ${item.description || item.kit?.name || "Kit"}`
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
                          {item.isSubhire && (
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
                        {isKit ? (item.kit?.isPrep && item.kit.assetTag.startsWith("PREP-") ? "-" : (item.kit?.assetTag || "-")) : (item.asset?.assetTag || item.bulkAsset?.assetTag || "-")}
                      </Text>
                      <Text style={[s.td, { width: 70, fontSize: 8, color: "#888" }]}>
                        {item.model?.category?.name || "-"}
                      </Text>
                    </View>
                    {!isGroup && item.quantity > 1 && (() => {
                      const shortName = item.model
                        ? item.model.name
                        : (item.description || "Item");
                      return (
                        <View style={{ paddingLeft: 26, paddingRight: 6, paddingBottom: 4 }}>
                          {Array.from({ length: item.quantity }).map((_, i) => (
                            <View key={i} style={{ flexDirection: "row", alignItems: "center", gap: 4, paddingVertical: 1 }}>
                              <View style={{ width: 7, height: 7, borderWidth: 0.75, borderColor: "#333", borderRadius: 1 }} />
                              <Text style={{ fontSize: 7, color: "#666" }}>{shortName} - {i + 1}</Text>
                            </View>
                          ))}
                        </View>
                      );
                    })()}
                    {children.map((child) => {
                      const childName = child.model?.name || child.description || "-";
                      const isNestedKit = !!child.kitId && (child.childLineItems?.length ?? 0) > 0;
                      const nestedChildren = child.childLineItems || [];
                      return (
                        <View key={child.id}>
                          <View style={s.tableRow}>
                            <View style={[s.td, { width: 20, alignItems: "center", justifyContent: "center" }]}>
                              <View style={{ width: 7, height: 7, borderWidth: 0.75, borderColor: "#333", borderRadius: 1 }} />
                            </View>
                            <View style={{ flex: 3, paddingLeft: 12 }}>
                              <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
                                <Text style={[s.td, { fontSize: 8, color: "#555", fontFamily: isNestedKit ? "Helvetica-Bold" : "Helvetica" }]}>
                                  {isNestedKit ? `[Kit] ${childName}` : childName}
                                </Text>
                                {child.isOverbooked && (
                                  <Text style={{ fontSize: 6, color: child.overbookedReducedOnly ? "#7c3aed" : "#dc2626", backgroundColor: child.overbookedReducedOnly ? "#ede9fe" : "#fee2e2", paddingHorizontal: 3, paddingVertical: 1, borderRadius: 2, fontFamily: "Helvetica-Bold" }}>{child.overbookedReducedOnly ? "REDUCED STOCK" : "OVERBOOKED"}</Text>
                                )}
                              </View>
                            </View>
                            <Text style={[s.td, { width: 30, textAlign: "center", fontSize: 8 }]}>
                              {isNestedKit ? nestedChildren.length : child.quantity}
                            </Text>
                            <Text style={[s.td, { width: 80, fontSize: 7, fontFamily: "Courier", color: "#555" }]}>
                              {child.asset?.assetTag || child.bulkAsset?.assetTag || (isNestedKit ? (child.kit?.assetTag || "-") : "-")}
                            </Text>
                            <Text style={[s.td, { width: 70, fontSize: 7, color: "#aaa" }]}>
                              {child.model?.category?.name || ""}
                            </Text>
                          </View>
                          {!isNestedKit && child.quantity > 1 && (
                            <View style={{ paddingLeft: 38, paddingRight: 6, paddingBottom: 4 }}>
                              {Array.from({ length: child.quantity }).map((_, i) => (
                                <View key={i} style={{ flexDirection: "row", alignItems: "center", gap: 4, paddingVertical: 1 }}>
                                  <View style={{ width: 7, height: 7, borderWidth: 0.75, borderColor: "#333", borderRadius: 1 }} />
                                  <Text style={{ fontSize: 7, color: "#666" }}>{childName} - {i + 1}</Text>
                                </View>
                              ))}
                            </View>
                          )}
                          {isNestedKit && nestedChildren.map((nested) => {
                            const nestedName = nested.model?.name || nested.description || "-";
                            return (
                              <View key={nested.id}>
                                <View style={s.tableRow}>
                                  <View style={[s.td, { width: 20, alignItems: "center", justifyContent: "center" }]}>
                                    <View style={{ width: 7, height: 7, borderWidth: 0.75, borderColor: "#333", borderRadius: 1 }} />
                                  </View>
                                  <View style={{ flex: 3, paddingLeft: 24 }}>
                                    <Text style={[s.td, { fontSize: 7, color: "#777" }]}>{nestedName}</Text>
                                  </View>
                                  <Text style={[s.td, { width: 30, textAlign: "center", fontSize: 7 }]}>{nested.quantity}</Text>
                                  <Text style={[s.td, { width: 80, fontSize: 7, fontFamily: "Courier", color: "#777" }]}>
                                    {nested.asset?.assetTag || nested.bulkAsset?.assetTag || "-"}
                                  </Text>
                                  <Text style={[s.td, { width: 70, fontSize: 7, color: "#aaa" }]}>{nested.model?.category?.name || ""}</Text>
                                </View>
                              </View>
                            );
                          })}
                        </View>
                      );
                    })}
                  </View>
                );
              })}
            </View>
          ))}
        </View>

        {/* Footer */}
        <Text style={s.footer}>
          {org.name} - {project.projectNumber} - Printed {formatDate(new Date().toISOString())}
        </Text>
      </Page>
    </Document>
  );
}
