/**
 * Temporary test route for pdfme PDF generation.
 * GET /api/documents/pdfme-test/:projectId?type=quote
 * Remove after verification.
 */
import { NextRequest, NextResponse } from "next/server";
import { generatePdf } from "@/lib/pdfme/generate-pdf";
import { requireOrganization } from "@/lib/auth-server";
import type { DocumentType } from "@/lib/pdfme/types";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> }
) {
  let session;
  try {
    session = await requireOrganization();
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const orgId = session.organizationId;
  const { projectId } = await params;
  const docType = (request.nextUrl.searchParams.get("type") || "quote") as DocumentType;

  try {
    const pdf = await generatePdf(projectId, orgId, docType);

    return new NextResponse(Buffer.from(pdf), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="${docType}-${projectId}.pdf"`,
      },
    });
  } catch (error) {
    console.error("pdfme generation error:", error);
    return NextResponse.json(
      { error: "Failed to generate PDF", details: String(error) },
      { status: 500 }
    );
  }
}
