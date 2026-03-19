-- CreateTable: brand_template
CREATE TABLE "brand_template" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "headerSettings" TEXT NOT NULL,
    "footerSettings" TEXT NOT NULL,
    "accentColor" TEXT,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "brand_template_pkey" PRIMARY KEY ("id")
);

-- CreateTable: section_preset
CREATE TABLE "section_preset" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "sections" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "section_preset_pkey" PRIMARY KEY ("id")
);

-- AlterTable: document_template
-- Make basePdf and schemas nullable (legacy fields)
ALTER TABLE "document_template" ALTER COLUMN "basePdf" DROP NOT NULL;
ALTER TABLE "document_template" ALTER COLUMN "schemas" DROP NOT NULL;

-- Add new section-based columns
ALTER TABLE "document_template" ADD COLUMN "sections" TEXT;
ALTER TABLE "document_template" ADD COLUMN "brandTemplateId" TEXT;
ALTER TABLE "document_template" ADD COLUMN "thumbnailData" TEXT;

-- CreateIndex
CREATE INDEX "brand_template_organizationId_idx" ON "brand_template"("organizationId");
CREATE INDEX "section_preset_organizationId_idx" ON "section_preset"("organizationId");

-- AddForeignKey
ALTER TABLE "brand_template" ADD CONSTRAINT "brand_template_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "section_preset" ADD CONSTRAINT "section_preset_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "document_template" ADD CONSTRAINT "document_template_brandTemplateId_fkey" FOREIGN KEY ("brandTemplateId") REFERENCES "brand_template"("id") ON DELETE SET NULL ON UPDATE CASCADE;
