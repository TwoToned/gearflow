import { Document, Page, Text, View } from "@react-pdf/renderer";
import { createStyles, formatCurrency, formatDate, type PdfBranding } from "./styles";
import { PdfHeader } from "./pdf-header";

interface LineItem {
  id: string;
  description: string | null;
  quantity: number;
  unitPrice: number | null;
  pricingType: string;
  duration: number;
  discount: number | null;
  lineTotal: number | null;
  groupName: string | null;
  isOptional: boolean;
  isKitChild?: boolean;
  kitId?: string | null;
  pricingMode?: string | null;
  notes: string | null;
  isOverbooked?: boolean;
  overbookedInherited?: boolean;
  overbookedReducedOnly?: boolean;
  overbookedHasOverbooked?: boolean;
  overbookedHasReduced?: boolean;
  isSubhire?: boolean;
  showSubhireOnDocs?: boolean;
  model: { name: string; modelNumber?: string | null } | null;
  kit?: { assetTag: string; name: string; isPrep?: boolean } | null;
  childLineItems?: LineItem[];
}

interface InvoicePDFProps {
  org: {
    name: string;
    email?: string;
    phone?: string;
    address?: string;
    taxRate?: number;
    taxLabel?: string;
    branding?: PdfBranding;
    logoData?: string | null;
    iconData?: string | null;
  };
  project: {
    projectNumber: string;
    name: string;
    rentalStartDate: string | null;
    rentalEndDate: string | null;
    subtotal: number | null;
    discountPercent: number | null;
    discountAmount: number | null;
    taxAmount: number | null;
    total: number | null;
    depositPaid: number | null;
    client: {
      name: string;
      contactName?: string | null;
      contactEmail?: string | null;
      billingAddress?: string | null;
      taxId?: string | null;
      paymentTerms?: string | null;
    } | null;
    lineItems: LineItem[];
  };
}

const pricingLabels: Record<string, string> = {
  PER_DAY: "/day",
  PER_WEEK: "/week",
  PER_HOUR: "/hr",
  FLAT: "flat",
};

export function InvoicePDF({ org, project }: InvoicePDFProps) {
  const s = createStyles(org.branding);
  const taxLabel = org.taxLabel || "GST";
  const totalNum = Number(project.total) || 0;
  const depositNum = Number(project.depositPaid) || 0;
  const balanceDue = totalNum - depositNum;

  // Only include non-optional confirmed items, exclude kit children
  const invoiceItems = project.lineItems.filter((i) => !i.isOptional && !i.isKitChild);

  const groups = new Map<string, LineItem[]>();
  for (const item of invoiceItems) {
    const key = item.groupName || "_ungrouped";
    const arr = groups.get(key) || [];
    arr.push(item);
    groups.set(key, arr);
  }

  return (
    <Document>
      <Page size="A4" style={s.page}>
        {/* Header */}
        <PdfHeader
          orgName={org.name}
          orgDetails={[org.address, org.phone, org.email].filter(Boolean).join("\n")}
          docTitle="INVOICE"
          docMeta={`${project.projectNumber}\nDate: ${formatDate(new Date().toISOString())}\n${project.client?.paymentTerms ? `Terms: ${project.client.paymentTerms}` : "Terms: Due on receipt"}`}
          branding={org.branding}
          logoData={org.logoData}
          iconData={org.iconData}
          styles={s}
        />

        {/* Bill To */}
        <View style={s.row}>
          <View style={s.col}>
            <Text style={s.sectionTitle}>Bill To</Text>
            {project.client ? (
              <View>
                <Text style={s.value}>{project.client.name}</Text>
                {project.client.contactName && (
                  <Text style={s.value}>Attn: {project.client.contactName}</Text>
                )}
                {project.client.billingAddress && (
                  <Text style={s.value}>{project.client.billingAddress}</Text>
                )}
                {project.client.taxId && (
                  <Text style={s.value}>ABN: {project.client.taxId}</Text>
                )}
              </View>
            ) : (
              <Text style={s.value}>-</Text>
            )}
          </View>
          <View style={s.col}>
            <Text style={s.sectionTitle}>Project</Text>
            <Text style={s.value}>{project.name}</Text>
            {project.rentalStartDate && (
              <View>
                <Text style={s.label}>Rental Period</Text>
                <Text style={s.value}>
                  {formatDate(project.rentalStartDate)}
                  {project.rentalEndDate ? ` - ${formatDate(project.rentalEndDate)}` : ""}
                </Text>
              </View>
            )}
          </View>
        </View>

        {/* Line Items */}
        <View style={[s.section, { marginTop: 16 }]}>
          <View style={s.table}>
            <View style={s.tableHeader}>
              <Text style={[s.th, { flex: 3 }]}>Description</Text>
              <Text style={[s.th, { width: 30, textAlign: "center" }]}>Qty</Text>
              <Text style={[s.th, { width: 60, textAlign: "right" }]}>Rate</Text>
              <Text style={[s.th, { width: 30, textAlign: "center" }]}>Days</Text>
              <Text style={[s.th, { width: 60, textAlign: "right" }]}>Amount</Text>
            </View>

            {Array.from(groups.entries()).map(([groupName, items]) => (
              <View key={groupName}>
                {groupName !== "_ungrouped" && (
                  <View style={s.groupHeader}>
                    <Text style={s.groupName}>{groupName}</Text>
                  </View>
                )}
                {items.map((item, idx) => {
                  const isKit = !!item.kitId && !item.isKitChild;
                  const isGroup = isKit;
                  const isItemized = isGroup && item.pricingMode === "ITEMIZED";
                  const children = isItemized ? (item.childLineItems || []) : [];
                  return (
                    <View key={item.id}>
                      <View style={idx % 2 === 0 ? s.tableRow : s.tableRowAlt}>
                        <View style={{ flex: 3 }}>
                          <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
                            <Text style={s.td}>
                              {isKit
                                ? (item.description || item.kit?.name || "Kit")
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
                          {item.quantity}
                        </Text>
                        <Text style={[s.tdRight, { width: 60 }]}>
                          {isItemized ? "-" : item.unitPrice != null
                            ? `${formatCurrency(item.unitPrice)}${pricingLabels[item.pricingType] || ""}`
                            : "-"}
                        </Text>
                        <Text style={[s.td, { width: 30, textAlign: "center" }]}>
                          {item.duration}
                        </Text>
                        <Text style={[s.tdRight, { width: 60 }]}>
                          {isItemized ? "-" : formatCurrency(item.lineTotal)}
                        </Text>
                      </View>
                      {children.map((child) => {
                        const isNestedKit = !!child.kitId && (child.childLineItems?.length ?? 0) > 0;
                        const nestedChildren = child.childLineItems || [];
                        const childName = child.model?.name || child.description || "-";
                        return (
                          <View key={child.id}>
                            <View style={s.tableRow}>
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
                              <Text style={[s.tdRight, { width: 60, fontSize: 8 }]}>
                                {child.unitPrice != null ? formatCurrency(child.unitPrice) : "-"}
                              </Text>
                              <Text style={[s.td, { width: 30, textAlign: "center", fontSize: 8 }]}>
                                {child.duration}
                              </Text>
                              <Text style={[s.tdRight, { width: 60, fontSize: 8 }]}>
                                {formatCurrency(child.lineTotal)}
                              </Text>
                            </View>
                            {isNestedKit && nestedChildren.map((nested) => (
                              <View key={nested.id} style={s.tableRow}>
                                <View style={{ flex: 3, paddingLeft: 24 }}>
                                  <Text style={[s.td, { fontSize: 7, color: "#777" }]}>{nested.model?.name || nested.description || "-"}</Text>
                                </View>
                                <Text style={[s.td, { width: 30, textAlign: "center", fontSize: 7 }]}>{nested.quantity}</Text>
                                <Text style={[s.tdRight, { width: 60, fontSize: 7, color: "#777" }]}>
                                  {nested.unitPrice != null ? formatCurrency(nested.unitPrice) : "-"}
                                </Text>
                                <Text style={[s.td, { width: 30, textAlign: "center", fontSize: 7 }]}>{nested.duration}</Text>
                                <Text style={[s.tdRight, { width: 60, fontSize: 7, color: "#777" }]}>{formatCurrency(nested.lineTotal)}</Text>
                              </View>
                            ))}
                          </View>
                        );
                      })}
                    </View>
                  );
                })}
              </View>
            ))}
          </View>

          {/* Totals */}
          <View style={s.totalsContainer}>
            <View style={s.totalsRow}>
              <Text style={s.totalsLabel}>Subtotal</Text>
              <Text style={s.totalsValue}>{formatCurrency(project.subtotal)}</Text>
            </View>
            {project.discountAmount != null && Number(project.discountAmount) > 0 && (
              <View style={s.totalsRow}>
                <Text style={s.totalsLabel}>
                  Discount{project.discountPercent ? ` (${project.discountPercent}%)` : ""}
                </Text>
                <Text style={s.totalsValue}>-{formatCurrency(project.discountAmount)}</Text>
              </View>
            )}
            <View style={s.totalsRow}>
              <Text style={s.totalsLabel}>{taxLabel}</Text>
              <Text style={s.totalsValue}>{formatCurrency(project.taxAmount)}</Text>
            </View>
            <View style={[s.totalsRow, s.totalsDivider]}>
              <Text style={[s.totalsLabel, { fontFamily: "Helvetica-Bold", fontSize: 11 }]}>
                Total
              </Text>
              <Text style={s.totalsBold}>{formatCurrency(project.total)}</Text>
            </View>
            {depositNum > 0 && (
              <>
                <View style={s.totalsRow}>
                  <Text style={s.totalsLabel}>Deposit Paid</Text>
                  <Text style={s.totalsValue}>-{formatCurrency(depositNum)}</Text>
                </View>
                <View style={s.totalsRow}>
                  <Text style={[s.totalsLabel, { fontFamily: "Helvetica-Bold" }]}>
                    Balance Due
                  </Text>
                  <Text style={[s.totalsValue, { fontFamily: "Helvetica-Bold" }]}>
                    {formatCurrency(balanceDue)}
                  </Text>
                </View>
              </>
            )}
          </View>
        </View>

        {/* Footer */}
        <Text style={s.footer}>
          {org.name} | {org.email || ""} | {org.phone || ""}
          {"\n"}Thank you for your business.
        </Text>
      </Page>
    </Document>
  );
}
