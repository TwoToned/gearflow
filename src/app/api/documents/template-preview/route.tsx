import { NextRequest, NextResponse } from "next/server";
import { requireOrganization } from "@/lib/auth-server";
import { buildSampleDocumentData } from "@/lib/pdfme/sample-document-data";
import { generatePdfFromSettings } from "@/lib/pdfme/generate-pdf";
import type { DocumentType } from "@/lib/pdfme/types";
import type { TemplateSettings } from "@/lib/pdfme/template-settings";

export async function POST(request: NextRequest) {
  let session;
  try {
    session = await requireOrganization();
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await request.json();
    const docType = body.docType as DocumentType;
    const settings = body.settings as TemplateSettings;

    if (!docType || !settings) {
      return NextResponse.json({ error: "Missing docType or settings" }, { status: 400 });
    }

    const sampleData = await buildSampleDocumentData(session.organizationId);
    const pdf = await generatePdfFromSettings(sampleData, docType, settings);

    return new NextResponse(Buffer.from(pdf), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": "inline; filename=preview.pdf",
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    console.error("Template preview generation failed:", err);
    return NextResponse.json(
      { error: "Failed to generate preview" },
      { status: 500 }
    );
  }
}
