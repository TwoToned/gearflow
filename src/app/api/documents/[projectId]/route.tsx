import { NextRequest, NextResponse } from "next/server";
import { logger } from "@/lib/logger";
import { requireOrganization } from "@/lib/auth-server";
import { generatePdf } from "@/lib/pdfme/generate-pdf";
import type { ProjectDocumentType } from "@/lib/pdfme/document-layouts";

/** Map URL type param values to pdfme ProjectDocumentType */
const typeMap: Record<string, ProjectDocumentType> = {
  quote: "quote",
  invoice: "invoice",
  "pull-slip": "packing-list",
  "return-sheet": "return-sheet",
  "delivery-docket": "delivery-docket",
};

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

  const docType = typeMap[type];
  if (!docType) {
    return NextResponse.json({ error: `Unknown document type: ${type}` }, { status: 400 });
  }

  try {
    const pdf = await generatePdf(projectId, organizationId, docType);
    const filename = `${docType}-${projectId}.pdf`;
    return new NextResponse(Buffer.from(pdf), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="${filename}"`,
      },
    });
  } catch (error) {
    logger.error("PDF generation error", { error: error });
    return NextResponse.json(
      { error: "PDF generation failed", details: String(error) },
      { status: 500 }
    );
  }
}
