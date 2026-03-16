/**
 * Builds sample DocumentData for template preview generation.
 * Uses real org info from the database, fills in realistic fake project/client/line items.
 */
import { prisma } from "@/lib/prisma";
import { getFileAsDataUri } from "@/lib/storage";
import type { DocumentData, DocumentLineItem, PdfBranding } from "./types";

const DEFAULT_DOC_COLOR = "#0d4f4f";

/**
 * Build sample DocumentData for preview rendering.
 * Loads real org branding (name, logo, colors) and fills placeholder content.
 */
export async function buildSampleDocumentData(
  organizationId: string
): Promise<DocumentData> {
  const org = await prisma.organization.findUniqueOrThrow({
    where: { id: organizationId },
  });

  // Parse org metadata for branding
  let meta: Record<string, unknown> = {};
  if (org.metadata) {
    try { meta = JSON.parse(org.metadata) as Record<string, unknown>; } catch { /* skip */ }
  }
  const branding = (meta.branding as PdfBranding) || {};
  const docColor = branding.documentColor || DEFAULT_DOC_COLOR;

  // Load logo/icon as data URIs
  let logoData: string | null = null;
  let iconData: string | null = null;
  if (branding.logoUrl) {
    try { logoData = await getFileAsDataUri(branding.logoUrl); } catch { /* skip */ }
  }
  if (branding.iconUrl) {
    try { iconData = await getFileAsDataUri(branding.iconUrl); } catch { /* skip */ }
  }

  const orgEmail = (meta.email as string) || "";
  const orgPhone = (meta.phone as string) || "";
  const orgAddress = (meta.address as string) || "";
  const orgWebsite = (meta.website as string) || "";
  const taxRate = (meta.taxRate as number) || 10;
  const taxLabel = (meta.taxLabel as string) || "GST";

  // Sample line items — realistic rental/AV equipment
  const sampleItems: DocumentLineItem[] = [
    makeItem("Shure SM58", "Dynamic Microphone", 4, 25, "Audio"),
    makeItem("Yamaha QL5", "Digital Mixing Console", 1, 450, "Audio"),
    makeItem("JBL VTX A12", "Line Array Speaker", 8, 120, "Audio", "PA System"),
    makeItem("Sennheiser EW 100", "Wireless Lapel Microphone Kit", 2, 75, "Audio", "PA System", true),
    makeItem("ETC Source Four", "750W Ellipsoidal", 12, 35, "Lighting"),
    makeItem("Martin MAC Aura XB", "LED Wash Moving Head", 6, 95, "Lighting"),
    makeItem("Blackmagic ATEM Mini", "Live Production Switcher", 1, 150, "Video"),
    makeItem("60\" Tripod Screen", "Portable Projection Screen", 2, 45, "Video"),
  ];

  const subtotal = sampleItems.reduce((s, i) => s + (i.lineTotal || 0), 0);
  const taxAmount = Math.round(subtotal * (taxRate / 100) * 100) / 100;
  const total = subtotal + taxAmount;
  const deposit = Math.round(total * 0.5 * 100) / 100;

  const today = new Date();
  const startDate = new Date(today);
  startDate.setDate(today.getDate() + 7);
  const endDate = new Date(startDate);
  endDate.setDate(startDate.getDate() + 3);

  const fmt = (d: Date) =>
    d.toLocaleDateString("en-AU", { day: "2-digit", month: "short", year: "numeric" });

  return {
    org_name: org.name,
    org_email: orgEmail,
    org_phone: orgPhone,
    org_address: orgAddress,
    org_website: orgWebsite,
    org_logo: logoData,
    org_icon: iconData,
    org_tax_rate: taxRate,
    org_tax_label: taxLabel,
    org_branding: branding,
    org_document_color: docColor,

    project_number: "PRJ-2024-042",
    project_name: "Annual Gala Dinner 2024",
    project_status: "CONFIRMED",
    project_type: "DRY_HIRE",

    rental_start: fmt(startDate),
    rental_end: fmt(endDate),
    event_start: fmt(new Date(startDate.getTime() + 86400000)),
    event_end: fmt(new Date(startDate.getTime() + 86400000 * 2)),
    load_in_date: fmt(startDate),
    load_out_date: fmt(endDate),

    client_name: "Stellar Events Co.",
    client_contact: "Sarah Mitchell",
    client_email: "sarah@stellarevents.com.au",
    client_phone: "0412 345 678",
    client_billing_address: "42 Collins Street\nMelbourne VIC 3000",
    client_tax_id: "51 824 753 556",
    client_payment_terms: "Net 14",

    venue_name: "Grand Ballroom, Hilton Melbourne",
    venue_address: "192 Wellington Parade\nEast Melbourne VIC 3002",
    site_contact_name: "James Chen",
    site_contact_phone: "0498 765 432",
    site_contact_email: "j.chen@hiltonmelbourne.com",

    subtotal,
    discount_percent: 5,
    discount_amount: Math.round(subtotal * 0.05 * 100) / 100,
    tax_label: taxLabel,
    tax_amount: taxAmount,
    total,
    deposit_paid: deposit,
    balance_due: Math.round((total - deposit) * 100) / 100,

    client_notes: "Please ensure all equipment is PAT tested. Loading dock access via rear entrance on Wellington Parade.",
    crew_notes: "Call time 6:00 AM. Black dress code. Meal provided.",
    internal_notes: "",

    document_date: fmt(today),

    line_items: sampleItems,
    crew: [
      { name: "Alex Turner", role: "Sound Engineer", phase: "Setup", callTime: "06:00", endTime: "23:00", phone: "0411 222 333", email: "alex@crew.com", notes: "", status: "CONFIRMED" },
      { name: "Maya Johnson", role: "Lighting Designer", phase: "Setup", callTime: "06:00", endTime: "23:00", phone: "0422 333 444", email: "maya@crew.com", notes: "", status: "CONFIRMED" },
      { name: "Tom Walsh", role: "Vision Tech", phase: "Show", callTime: "14:00", endTime: "23:00", phone: "0433 444 555", email: "tom@crew.com", notes: "Operating ATEM", status: "CONFIRMED" },
    ],

    total_items: sampleItems.reduce((s, i) => s + i.quantity, 0),
    total_weight: 285,
  };
}

let itemCounter = 0;

function makeItem(
  name: string,
  description: string,
  qty: number,
  rate: number,
  category: string,
  groupName?: string,
  isKitChild?: boolean
): DocumentLineItem {
  itemCounter++;
  return {
    id: `sample-${itemCounter}`,
    description,
    quantity: qty,
    checkedOutQuantity: qty,
    unitPrice: rate,
    pricingType: "DAILY",
    duration: 3,
    discount: 0,
    lineTotal: qty * rate * 3,
    groupName: groupName || null,
    isOptional: false,
    isKitChild: isKitChild || false,
    notes: null,
    status: "CONFIRMED",
    model: {
      name,
      modelNumber: null,
      weight: Math.round(Math.random() * 10 + 2),
      category: { name: category },
    },
    asset: null,
    bulkAsset: null,
  };
}
