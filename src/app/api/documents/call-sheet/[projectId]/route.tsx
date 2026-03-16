import { NextRequest, NextResponse } from "next/server";
import { requireOrganization } from "@/lib/auth-server";
import { generatePdf } from "@/lib/pdfme/generate-pdf";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> }
) {
  const { projectId } = await params;
  const url = new URL(request.url);
  const dateParam = url.searchParams.get("date");
  const templateId = url.searchParams.get("templateId") || undefined;

  let session;
  try {
    session = await requireOrganization();
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { organizationId } = session;

  try {
    const callSheetDate = dateParam ? new Date(dateParam) : undefined;
    const pdf = await generatePdf(projectId, organizationId, "call-sheet", callSheetDate, templateId);
    const filename = `CallSheet-${projectId}.pdf`;
    return new NextResponse(Buffer.from(pdf), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="${filename}"`,
      },
    });
  } catch (error) {
    console.error("Call sheet PDF generation error:", error);
    return NextResponse.json(
      { error: "PDF generation failed", details: String(error) },
      { status: 500 }
    );
  }
}
