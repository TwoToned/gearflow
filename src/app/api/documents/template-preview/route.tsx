import { NextRequest, NextResponse } from "next/server";
import { logger } from "@/lib/logger";
import { requireOrganization } from "@/lib/auth-server";
import { buildSampleDocumentData } from "@/lib/pdfme/sample-document-data";
import { generatePdfFromSettings, generatePdfFromSections } from "@/lib/pdfme/generate-pdf";
import type { DocumentType } from "@/lib/pdfme/types";
import type { TemplateSettings } from "@/lib/pdfme/template-settings";
import type { TemplateSection } from "@/lib/pdfme/section-types";

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

    if (!docType) {
      return NextResponse.json({ error: "Missing docType" }, { status: 400 });
    }

    const sampleData = await buildSampleDocumentData(session.organizationId);
    let pdf: Uint8Array;

    // Section-based preview (new builder)
    if (body.sections) {
      const sections = body.sections as TemplateSection[];
      pdf = await generatePdfFromSections(
        sampleData,
        docType,
        sections,
        body.docColor,
        body.footerText,
        body.footerSecondLine,
      );
    }
    // Legacy settings-based preview
    else if (body.settings) {
      const settings = body.settings as TemplateSettings;
      pdf = await generatePdfFromSettings(sampleData, docType, settings);
    } else {
      return NextResponse.json(
        { error: "Missing sections or settings" },
        { status: 400 }
      );
    }

    return new NextResponse(Buffer.from(pdf), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": "inline; filename=preview.pdf",
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    logger.error("Template preview generation failed", { error: err });
    return NextResponse.json(
      { error: "Failed to generate preview" },
      { status: 500 }
    );
  }
}
