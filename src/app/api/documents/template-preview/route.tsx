import { NextRequest, NextResponse } from "next/server";
import { logger } from "@/lib/logger";
import { requireOrganization } from "@/lib/auth-server";
import { withValidatedBody } from "@/lib/api-validation";
import { buildSampleDocumentData } from "@/lib/pdfme/sample-document-data";
import { generatePdfFromSettings, generatePdfFromSections } from "@/lib/pdfme/generate-pdf";
import type { TemplateSettings } from "@/lib/pdfme/template-settings";
import type { TemplateSection } from "@/lib/pdfme/section-types";
import { templatePreviewRequestSchema } from "@/lib/validations/template-section";

const preview = withValidatedBody(
  templatePreviewRequestSchema,
  async ({ docType, sections, docColor, footerText, footerSecondLine, settings }, _request, organizationId: string) => {
    try {
      const sampleData = await buildSampleDocumentData(organizationId);
      let pdf: Uint8Array;

      // Section-based preview (new builder)
      if (sections) {
        pdf = await generatePdfFromSections(
          sampleData,
          docType,
          sections as TemplateSection[],
          docColor,
          footerText,
          footerSecondLine,
        );
      }
      // Legacy settings-based preview
      else if (settings) {
        pdf = await generatePdfFromSettings(sampleData, docType, settings as unknown as TemplateSettings);
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
  },
);

export async function POST(request: NextRequest) {
  let session;
  try {
    session = await requireOrganization();
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  return preview(request, session.organizationId);
}
