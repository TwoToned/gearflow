import { NextRequest, NextResponse } from "next/server";
import { requireOrganization } from "@/lib/auth-server";
import { generatePdf } from "@/lib/pdfme/generate-pdf";
import type { DocumentType } from "@/lib/pdfme/types";

/** Map URL type param values to pdfme DocumentType */
const typeMap: Record<string, DocumentType> = {
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
  const templateId = url.searchParams.get("templateId") || undefined;

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
    const pdf = await generatePdf(projectId, organizationId, docType, undefined, templateId);
    const filename = `${docType}-${projectId}.pdf`;
    return new NextResponse(Buffer.from(pdf), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="${filename}"`,
      },
    });
  } catch (error) {
    console.error("PDF generation error:", error);
    return NextResponse.json(
      { error: "PDF generation failed", details: String(error) },
      { status: 500 }
    );
  }
}
