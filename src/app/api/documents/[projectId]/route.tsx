import { NextRequest, NextResponse } from "next/server";
import { renderToBuffer } from "@react-pdf/renderer";
import { prisma } from "@/lib/prisma";
import { requireOrganization } from "@/lib/auth-server";
import { QuotePDF } from "@/lib/pdf/quote-pdf";
import { InvoicePDF } from "@/lib/pdf/invoice-pdf";
import { PullSlipPDF } from "@/lib/pdf/packing-list-pdf";
import { ReturnSheetPDF } from "@/lib/pdf/return-sheet-pdf";
import { DeliveryDocketPDF } from "@/lib/pdf/delivery-docket-pdf";
import { computeOverbookedStatus } from "@/lib/availability";
import { getFileAsDataUri } from "@/lib/storage";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> }
) {
  const { projectId } = await params;
  const url = new URL(request.url);
  const type = url.searchParams.get("type") || "quote";

  let session;
  try {
    session = await requireOrganization();
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { organizationId } = session;

  const org = await prisma.organization.findUnique({
    where: { id: organizationId },
  });

  const project = await prisma.project.findUnique({
    where: { id: projectId, organizationId },
    include: {
      client: true,
      location: true,
      lineItems: {
        where: { status: { not: "CANCELLED" } },
        orderBy: { sortOrder: "asc" },
        include: {
          model: { include: { category: true } },
          asset: true,
          bulkAsset: true,
          kit: true,
          childLineItems: {
            orderBy: { sortOrder: "asc" },
            include: {
              model: { include: { category: true } },
              asset: true,
              bulkAsset: true,
              kit: true,
              childLineItems: {
                orderBy: { sortOrder: "asc" },
                include: {
                  model: { include: { category: true } },
                  asset: true,
                  bulkAsset: true,
                },
              },
            },
          },
        },
      },
    },
  });

  if (!project) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  let orgSettings: Record<string, unknown> = {};
  if (org?.metadata) {
    try {
      orgSettings = JSON.parse(org.metadata);
    } catch {
      // ignore
    }
  }

  const branding = orgSettings.branding as {
    primaryColor?: string; accentColor?: string; documentColor?: string;
    logoUrl?: string; iconUrl?: string; documentLogoMode?: "logo" | "icon" | "none";
  } | undefined;

  // Read logo/icon directly from S3 as base64 data URIs for PDF embedding
  const [logoData, iconData] = await Promise.all([
    branding?.logoUrl ? getFileAsDataUri(branding.logoUrl) : null,
    branding?.iconUrl ? getFileAsDataUri(branding.iconUrl) : null,
  ]);

  const orgData = {
    name: org?.name || "",
    email: (orgSettings.email as string) || undefined,
    phone: (orgSettings.phone as string) || undefined,
    address: (orgSettings.address as string) || undefined,
    website: (orgSettings.website as string) || undefined,
    taxRate: (orgSettings.taxRate as number) || 10,
    taxLabel: (orgSettings.taxLabel as string) || "GST",
    branding,
    logoData,
    iconData,
  };

  // Compute overbooked status dynamically
  const overbookedMap = await computeOverbookedStatus(
    organizationId,
    project.lineItems,
    project.rentalStartDate,
    project.rentalEndDate,
    project.id,
  );

  const enrichedLineItems = project.lineItems.map((li) => {
    const info = overbookedMap.get(li.id);
    return {
      ...li,
      isOverbooked: !!info,
      overbookedInherited: info?.inherited ?? false,
      overbookedReducedOnly: info?.reducedOnly ?? false,
      overbookedHasOverbooked: info?.hasOverbookedChildren ?? false,
      overbookedHasReduced: info?.hasReducedChildren ?? false,
      childLineItems: (li as unknown as { childLineItems?: typeof project.lineItems }).childLineItems?.map((child) => {
        const childInfo = overbookedMap.get(child.id);
        return {
          ...child,
          isOverbooked: !!childInfo,
          overbookedReducedOnly: childInfo?.reducedOnly ?? false,
        };
      }),
    };
  });

  // Serialize Decimals to numbers
  const serializedProject = JSON.parse(
    JSON.stringify({ ...project, lineItems: enrichedLineItems }, (_key, value) =>
      value && typeof value === "object" && typeof value.toNumber === "function"
        ? value.toNumber()
        : value
    )
  );

  let doc;
  let filename: string;

  switch (type) {
    case "invoice":
      doc = <InvoicePDF org={orgData} project={serializedProject} />;
      filename = `Invoice-${project.projectNumber}.pdf`;
      break;
    case "pull-slip":
      doc = <PullSlipPDF org={orgData} project={serializedProject} />;
      filename = `PullSlip-${project.projectNumber}.pdf`;
      break;
    case "return-sheet":
      doc = <ReturnSheetPDF org={orgData} project={serializedProject} />;
      filename = `ReturnSheet-${project.projectNumber}.pdf`;
      break;
    case "delivery-docket":
      doc = <DeliveryDocketPDF org={orgData} project={serializedProject} />;
      filename = `DeliveryDocket-${project.projectNumber}.pdf`;
      break;
    case "quote":
    default:
      doc = <QuotePDF org={orgData} project={serializedProject} />;
      filename = `Quote-${project.projectNumber}.pdf`;
      break;
  }

  const buffer = await renderToBuffer(doc);

  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${filename}"`,
    },
  });
}
