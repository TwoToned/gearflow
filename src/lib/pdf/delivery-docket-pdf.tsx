import { Document, Page, Text, View } from "@react-pdf/renderer";
import { createStyles, formatDate, type PdfBranding } from "./styles";
import { PdfHeader } from "./pdf-header";

interface LineItem {
  id: string;
  description: string | null;
  quantity: number;
  checkedOutQuantity: number;
  groupName: string | null;
  status: string;
  assetId: string | null;
  bulkAssetId: string | null;
  isKitChild?: boolean;
  kitId?: string | null;
  model: {
    name: string;
    modelNumber?: string | null;
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

function isBulk(item: LineItem) {
  return !!item.bulkAssetId || (!item.assetId && item.quantity > 1);
}

interface DeliveryDocketPDFProps {
  org: {
    name: string;
    email?: string;
    phone?: string;
    address?: string;
    branding?: PdfBranding;
    logoData?: string | null;
    iconData?: string | null;
  };
  project: {
    projectNumber: string;
    name: string;
    loadInDate: string | null;
    rentalStartDate: string | null;
    rentalEndDate: string | null;
    siteContactName: string | null;
    siteContactPhone: string | null;
    client: {
      name: string;
      contactName?: string | null;
      contactPhone?: string | null;
    } | null;
    location: { name: string } | null;
    lineItems: LineItem[];
  };
}

export function DeliveryDocketPDF({ org, project }: DeliveryDocketPDFProps) {
  const s = createStyles(org.branding);
  // Only items that are actually checked out right now, exclude kit children
  const deliveredItems = project.lineItems.filter((i) => {
    if (i.isKitChild) return false;
    if (isBulk(i)) return i.checkedOutQuantity > 0;
    return i.status === "CHECKED_OUT";
  });

  // Group by groupName
  const groups = new Map<string, LineItem[]>();
  for (const item of deliveredItems) {
    const key = item.groupName || "General";
    const arr = groups.get(key) || [];
    arr.push(item);
    groups.set(key, arr);
  }

  const totalItems = deliveredItems.reduce((sum, i) => {
    if (i.kitId && !i.isKitChild) {
      // Kit/prep-kit: count deployed children + grandchildren
      const children = (i.childLineItems || []).filter((c) => c.status === "CHECKED_OUT");
      let count = 0;
      for (const child of children) {
        if (child.kitId && child.childLineItems?.length) {
          count += (child.childLineItems || []).filter((gc) => gc.status === "CHECKED_OUT").reduce((s, gc) => s + gc.quantity, 0);
        } else {
          count += child.quantity;
        }
      }
      return sum + count;
    }
    if (isBulk(i)) return sum + i.checkedOutQuantity;
    return sum + 1;
  }, 0);

  return (
    <Document>
      <Page size="A4" style={s.page}>
        {/* Header */}
        <PdfHeader
          orgName={org.name}
          orgDetails={[org.address, org.phone, org.email].filter(Boolean).join("\n")}
          docTitle="DELIVERY DOCKET"
          docMeta={`${project.projectNumber}\nDate: ${formatDate(new Date().toISOString())}`}
          branding={org.branding}
          logoData={org.logoData}
          iconData={org.iconData}
          styles={s}
        />

        {/* Project & Client Info */}
        <View style={s.row}>
          <View style={s.col}>
            <Text style={s.sectionTitle}>Delivered To</Text>
            {project.client ? (
              <View>
                <Text style={s.value}>{project.client.name}</Text>
                {project.client.contactName && (
                  <Text style={s.value}>Attn: {project.client.contactName}</Text>
                )}
                {project.client.contactPhone && (
                  <Text style={s.value}>Ph: {project.client.contactPhone}</Text>
                )}
              </View>
            ) : (
              <Text style={s.value}>-</Text>
            )}
            {project.siteContactName && (
              <View style={{ marginTop: 6 }}>
                <Text style={s.label}>Site Contact</Text>
                <Text style={s.value}>
                  {project.siteContactName}
                  {project.siteContactPhone ? ` - ${project.siteContactPhone}` : ""}
                </Text>
              </View>
            )}
          </View>
          <View style={s.col}>
            <Text style={s.sectionTitle}>Project Details</Text>
            <Text style={s.value}>{project.name}</Text>
            {project.location && (
              <View>
                <Text style={s.label}>Venue / Location</Text>
                <Text style={s.value}>{project.location.name}</Text>
              </View>
            )}
            {project.rentalStartDate && (
              <View>
                <Text style={s.label}>Rental Period</Text>
                <Text style={s.value}>
                  {formatDate(project.rentalStartDate)}
                  {project.rentalEndDate ? ` - ${formatDate(project.rentalEndDate)}` : ""}
                </Text>
              </View>
            )}
            <View style={{ marginTop: 4 }}>
              <Text style={s.label}>Total Items Delivered</Text>
              <Text style={[s.value, { fontFamily: "Helvetica-Bold" }]}>
                {totalItems}
              </Text>
            </View>
          </View>
        </View>

        {/* Items Table */}
        <View style={[s.section, { marginTop: 12 }]}>
          <Text style={s.sectionTitle}>Items Delivered</Text>
          <View style={s.table}>
            <View style={s.tableHeader}>
              <Text style={[s.th, { width: 24, textAlign: "center" }]}>#</Text>
              <Text style={[s.th, { flex: 3 }]}>Description</Text>
              <Text style={[s.th, { width: 40, textAlign: "center" }]}>Qty</Text>
              <Text style={[s.th, { width: 80 }]}>Asset Tag</Text>
              <Text style={[s.th, { width: 50, textAlign: "center" }]}>Received</Text>
            </View>

            {(() => {
              let rowNum = 0;
              return Array.from(groups.entries()).map(([groupName, items]) => (
                <View key={groupName}>
                  {groupName !== "General" && (
                    <View style={s.groupHeader}>
                      <Text style={s.groupName}>{groupName}</Text>
                    </View>
                  )}
                  {items.map((item) => {
                    rowNum++;
                    const bulk = isBulk(item);
                    const isKit = !!item.kitId && !item.isKitChild;
                    const isGroup = isKit;
                    // Only show deployed children
                    const allChildren = isGroup ? (item.childLineItems || []) : [];
                    const children = allChildren.filter((c) => c.status === "CHECKED_OUT");
                    const itemName = isKit
                      ? (item.description || item.kit?.name || "Kit")
                      : item.model
                        ? `${item.model.name}${item.model.modelNumber ? ` (${item.model.modelNumber})` : ""}`
                        : item.description || "-";

                    return (
                      <View key={item.id}>
                        <View style={rowNum % 2 === 0 ? s.tableRowAlt : s.tableRow}>
                          <Text style={[s.td, { width: 24, textAlign: "center", color: "#999" }]}>
                            {rowNum}
                          </Text>
                          <View style={{ flex: 3 }}>
                            <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
                              <Text style={s.td}>
                                {bulk ? `${item.checkedOutQuantity}x ${itemName}` : itemName}
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
                          <Text style={[s.td, { width: 40, textAlign: "center" }]}>
                            {isGroup ? children.length : bulk ? item.checkedOutQuantity : 1}
                          </Text>
                          <Text style={[s.td, { width: 80, fontSize: 8, fontFamily: "Courier" }]}>
                            {isKit ? (item.kit?.isPrep && item.kit.assetTag.startsWith("PREP-") ? "-" : (item.kit?.assetTag || "-")) : bulk ? "-" : (item.asset?.assetTag || "-")}
                          </Text>
                          <View style={[s.td, { width: 50, alignItems: "center", justifyContent: "center" }]}>
                            <View style={{ width: 8, height: 8, borderWidth: 0.75, borderColor: "#333", borderRadius: 1 }} />
                          </View>
                        </View>
                        {children.map((child) => {
                          const isNestedKit = !!child.kitId && (child.childLineItems?.length ?? 0) > 0;
                          // Only show deployed grandchildren
                          const nestedChildren = isNestedKit
                            ? (child.childLineItems || []).filter((gc) => gc.status === "CHECKED_OUT")
                            : [];
                          const childName = child.model?.name || child.description || "-";
                          return (
                            <View key={child.id}>
                              <View style={s.tableRow}>
                                <Text style={[s.td, { width: 24 }]}> </Text>
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
                                <Text style={[s.td, { width: 40, textAlign: "center", fontSize: 8 }]}>
                                  {isNestedKit ? nestedChildren.length : child.quantity}
                                </Text>
                                <Text style={[s.td, { width: 80, fontSize: 7, fontFamily: "Courier", color: "#555" }]}>
                                  {child.asset?.assetTag || child.bulkAsset?.assetTag || (isNestedKit ? (child.kit?.assetTag || "-") : "-")}
                                </Text>
                                <View style={[s.td, { width: 50, alignItems: "center", justifyContent: "center" }]}>
                                  <View style={{ width: 8, height: 8, borderWidth: 0.75, borderColor: "#333", borderRadius: 1 }} />
                                </View>
                              </View>
                              {isNestedKit && nestedChildren.map((nested) => (
                                <View key={nested.id} style={s.tableRow}>
                                  <Text style={[s.td, { width: 24 }]}> </Text>
                                  <View style={{ flex: 3, paddingLeft: 24 }}>
                                    <Text style={[s.td, { fontSize: 7, color: "#777" }]}>{nested.model?.name || nested.description || "-"}</Text>
                                  </View>
                                  <Text style={[s.td, { width: 40, textAlign: "center", fontSize: 7 }]}>{nested.quantity}</Text>
                                  <Text style={[s.td, { width: 80, fontSize: 7, fontFamily: "Courier", color: "#777" }]}>
                                    {nested.asset?.assetTag || nested.bulkAsset?.assetTag || "-"}
                                  </Text>
                                  <View style={[s.td, { width: 50, alignItems: "center", justifyContent: "center" }]}>
                                    <View style={{ width: 8, height: 8, borderWidth: 0.75, borderColor: "#333", borderRadius: 1 }} />
                                  </View>
                                </View>
                              ))}
                            </View>
                          );
                        })}
                      </View>
                    );
                  })}
                </View>
              ));
            })()}
          </View>
        </View>

        {/* Condition Notes */}
        <View style={[s.section, { marginTop: 8 }]}>
          <Text style={s.sectionTitle}>Notes / Discrepancies</Text>
          <View style={{ borderWidth: 0.5, borderColor: "#ddd", borderRadius: 3, minHeight: 50, padding: 6 }}>
            <Text style={{ fontSize: 8, color: "#ccc" }}> </Text>
          </View>
        </View>

        {/* Acknowledgement & Signatures */}
        <View style={{ marginTop: 16 }}>
          <Text style={[s.notes, { marginBottom: 8 }]}>
            By signing below, the recipient acknowledges receipt of the above items in good working
            condition and accepts responsibility for the equipment until it is returned to {org.name}.
            Any damage, loss, or theft must be reported immediately.
          </Text>

          <View style={[s.row, { gap: 30, marginTop: 16 }]}>
            <View style={s.col}>
              <Text style={s.label}>Delivered By ({org.name})</Text>
              <View style={{ borderBottomWidth: 0.5, borderBottomColor: "#ccc", marginTop: 30 }} />
              <Text style={[s.value, { marginTop: 4 }]}>Print Name</Text>
              <View style={{ borderBottomWidth: 0.5, borderBottomColor: "#ccc", marginTop: 20 }} />
              <Text style={[s.value, { marginTop: 4 }]}>Signature</Text>
            </View>
            <View style={s.col}>
              <Text style={s.label}>Received By (Client)</Text>
              <View style={{ borderBottomWidth: 0.5, borderBottomColor: "#ccc", marginTop: 30 }} />
              <Text style={[s.value, { marginTop: 4 }]}>Print Name</Text>
              <View style={{ borderBottomWidth: 0.5, borderBottomColor: "#ccc", marginTop: 20 }} />
              <Text style={[s.value, { marginTop: 4 }]}>Signature</Text>
            </View>
            <View style={{ width: 80 }}>
              <Text style={s.label}>Date</Text>
              <View style={{ borderBottomWidth: 0.5, borderBottomColor: "#ccc", marginTop: 30 }} />
              <Text style={s.label}>{"\n"}Time</Text>
              <View style={{ borderBottomWidth: 0.5, borderBottomColor: "#ccc", marginTop: 20 }} />
            </View>
          </View>
        </View>

        {/* Footer */}
        <Text style={s.footer}>
          {org.name} | {org.email || ""} | {org.phone || ""}
          {"\n"}Ref: {project.projectNumber}
        </Text>
      </Page>
    </Document>
  );
}
