/**
 * Assembles the full data contract for document generation.
 * Loads project, org, branding, overbooking status, and returns a flat token map
 * plus complex data arrays for custom plugins.
 */
import { prisma } from "@/lib/prisma";
import { computeOverbookedStatus } from "@/lib/availability";
import { getFileAsDataUri } from "@/lib/storage";
import { formatCurrency, formatDate } from "@/lib/pdf/styles";
import type { DocumentData, DocumentLineItem, CrewEntry, DocumentType } from "./types";

const DEFAULT_DOC_COLOR = "#0d4f4f";

/** Deep include for line items — 2 levels of children for nested kits */
const lineItemInclude = {
  model: { include: { category: true } },
  asset: true,
  bulkAsset: true,
  kit: true,
  childLineItems: {
    orderBy: { sortOrder: "asc" as const },
    include: {
      model: { include: { category: true } },
      asset: true,
      bulkAsset: true,
      kit: true,
      childLineItems: {
        orderBy: { sortOrder: "asc" as const },
        include: {
          model: { include: { category: true } },
          asset: true,
          bulkAsset: true,
        },
      },
    },
  },
} as const;

/** Serialize Decimal fields to numbers (Prisma v6 Decimal type) */
function serializeDecimals<T>(obj: T): T {
  return JSON.parse(
    JSON.stringify(obj, (_key, value) =>
      value && typeof value === "object" && typeof value.toNumber === "function"
        ? value.toNumber()
        : value
    )
  );
}

/**
 * Build the full document data contract for a project.
 * Used by the pdfme generation pipeline.
 */
export async function buildDocumentData(
  projectId: string,
  organizationId: string,
  docType: DocumentType,
  callSheetDate?: Date
): Promise<DocumentData> {
  // Load org
  const org = await prisma.organization.findUnique({
    where: { id: organizationId },
  });

  let orgSettings: Record<string, unknown> = {};
  if (org?.metadata) {
    try {
      orgSettings = JSON.parse(org.metadata);
    } catch {
      // ignore
    }
  }

  const branding = orgSettings.branding as {
    primaryColor?: string;
    accentColor?: string;
    documentColor?: string;
    logoUrl?: string;
    iconUrl?: string;
    documentLogoMode?: "logo" | "icon" | "none";
    showOrgNameOnDocuments?: boolean;
  } | undefined;

  // Load logo/icon as base64
  const [logoData, iconData] = await Promise.all([
    branding?.logoUrl ? getFileAsDataUri(branding.logoUrl) : null,
    branding?.iconUrl ? getFileAsDataUri(branding.iconUrl) : null,
  ]);

  const docColor = branding?.documentColor || branding?.primaryColor || DEFAULT_DOC_COLOR;

  // Load project with deep includes
  const project = await prisma.project.findUnique({
    where: { id: projectId, organizationId },
    include: {
      client: true,
      location: true,
      lineItems: {
        where: { status: { not: "CANCELLED" } },
        orderBy: { sortOrder: "asc" },
        include: lineItemInclude,
      },
      ...(docType === "call-sheet"
        ? {
            crewAssignments: {
              where: {
                organizationId,
                status: { notIn: ["CANCELLED", "DECLINED"] },
              },
              include: {
                crewMember: {
                  select: {
                    firstName: true,
                    lastName: true,
                    phone: true,
                    email: true,
                  },
                },
                crewRole: { select: { name: true } },
                shifts: { orderBy: { date: "asc" } },
              },
              orderBy: [
                { isProjectManager: "desc" },
                { phase: "asc" },
                { crewMember: { lastName: "asc" } },
              ],
            },
          }
        : {}),
    },
  });

  if (!project) {
    throw new Error(`Project ${projectId} not found`);
  }

  // Compute overbooking status
  const overbookedMap = await computeOverbookedStatus(
    organizationId,
    project.lineItems,
    project.rentalStartDate,
    project.rentalEndDate,
    project.id
  );

  // Enrich line items with overbooking flags
  type LineItemRow = (typeof project.lineItems)[number];
  const enrichedLineItems = project.lineItems.map((li: LineItemRow) => {
    const info = overbookedMap.get(li.id);
    const children = (li as unknown as { childLineItems?: LineItemRow[] }).childLineItems;
    return {
      ...li,
      isOverbooked: !!info,
      overbookedInherited: info?.inherited ?? false,
      overbookedReducedOnly: info?.reducedOnly ?? false,
      overbookedHasOverbooked: info?.hasOverbookedChildren ?? false,
      overbookedHasReduced: info?.hasReducedChildren ?? false,
      childLineItems: children?.map((child: LineItemRow) => {
        const childInfo = overbookedMap.get(child.id);
        return {
          ...child,
          isOverbooked: !!childInfo,
          overbookedReducedOnly: childInfo?.reducedOnly ?? false,
        };
      }),
    };
  });

  // Serialize Decimals
  const serialized = serializeDecimals({
    ...project,
    lineItems: enrichedLineItems,
  });

  const lineItems: DocumentLineItem[] = serialized.lineItems;

  // Compute totals for packing list / delivery docket
  const topLevelItems = lineItems.filter((i) => !i.isKitChild);
  const totalItems = topLevelItems.reduce((sum, i) => {
    if (i.kitId && !i.isKitChild) {
      const children = i.childLineItems || [];
      let count = 0;
      for (const child of children) {
        if (child.kitId && child.childLineItems?.length) {
          count += child.childLineItems.reduce((s, gc) => s + gc.quantity, 0);
        } else {
          count += child.quantity;
        }
      }
      return sum + count;
    }
    return sum + i.quantity;
  }, 0);

  const totalWeight = topLevelItems.reduce((sum, i) => {
    const w = i.model?.weight ? Number(i.model.weight) : 0;
    return sum + w * i.quantity;
  }, 0);

  // Build crew entries for call sheet
  let crew: CrewEntry[] = [];
  if (docType === "call-sheet") {
    const crewAssignments = (serialized as unknown as {
      crewAssignments?: Array<{
        crewMember: { firstName: string; lastName: string; phone: string | null; email: string | null };
        crewRole: { name: string } | null;
        phase: string | null;
        startTime: string | null;
        endTime: string | null;
        notes: string | null;
        status: string;
        shifts: Array<{ date: string | Date; callTime: string | null; endTime: string | null }>;
      }>;
    }).crewAssignments || [];

    const callDate = callSheetDate || project.loadInDate || project.eventStartDate || project.rentalStartDate || new Date();
    const dateStr = new Date(callDate).toISOString().split("T")[0];

    crew = crewAssignments.map((a) => {
      const shift = a.shifts.find((s) => {
        const shiftDate = new Date(s.date).toISOString().split("T")[0];
        return shiftDate === dateStr;
      });
      return {
        name: `${a.crewMember.firstName} ${a.crewMember.lastName}`,
        role: a.crewRole?.name || null,
        phase: a.phase,
        callTime: shift?.callTime || a.startTime || null,
        endTime: shift?.endTime || a.endTime || null,
        phone: a.crewMember.phone || null,
        email: a.crewMember.email || null,
        notes: a.notes || null,
        status: a.status,
      };
    });
  }

  const totalNum = Number(serialized.total) || 0;
  const depositNum = Number(serialized.depositPaid) || 0;

  return {
    // Org
    org_name: org?.name || "",
    org_email: (orgSettings.email as string) || "",
    org_phone: (orgSettings.phone as string) || "",
    org_address: (orgSettings.address as string) || "",
    org_website: (orgSettings.website as string) || "",
    org_logo: logoData,
    org_icon: iconData,
    org_tax_rate: (orgSettings.taxRate as number) || 10,
    org_tax_label: (orgSettings.taxLabel as string) || "GST",
    org_branding: branding,
    org_document_color: docColor,

    // Project
    project_number: serialized.projectNumber,
    project_name: serialized.name,
    project_status: serialized.status,
    project_type: serialized.type || "",

    // Dates
    rental_start: formatDate(serialized.rentalStartDate),
    rental_end: formatDate(serialized.rentalEndDate),
    event_start: formatDate(serialized.eventStartDate),
    event_end: formatDate(serialized.eventEndDate),
    load_in_date: formatDate(serialized.loadInDate),
    load_out_date: formatDate(serialized.loadOutDate),

    // Client
    client_name: serialized.client?.name || "",
    client_contact: serialized.client?.contactName || "",
    client_email: serialized.client?.contactEmail || "",
    client_phone: serialized.client?.contactPhone || "",
    client_billing_address: serialized.client?.billingAddress || "",
    client_tax_id: serialized.client?.taxId || "",
    client_payment_terms: serialized.client?.paymentTerms || "",

    // Location
    venue_name: serialized.location?.name || "",
    venue_address: serialized.location?.address || "",
    site_contact_name: serialized.siteContactName || "",
    site_contact_phone: serialized.siteContactPhone || "",
    site_contact_email: serialized.siteContactEmail || "",

    // Financial
    subtotal: Number(serialized.subtotal) || 0,
    discount_percent: Number(serialized.discountPercent) || 0,
    discount_amount: Number(serialized.discountAmount) || 0,
    tax_label: (orgSettings.taxLabel as string) || "GST",
    tax_amount: Number(serialized.taxAmount) || 0,
    total: totalNum,
    deposit_paid: depositNum,
    balance_due: totalNum - depositNum,

    // Notes
    client_notes: serialized.clientNotes || "",
    crew_notes: serialized.crewNotes || "",
    internal_notes: serialized.internalNotes || "",

    // Metadata
    document_date: formatDate(new Date().toISOString()),

    // Complex data
    line_items: lineItems,
    crew,

    // Computed
    total_items: totalItems,
    total_weight: totalWeight,
  };
}
