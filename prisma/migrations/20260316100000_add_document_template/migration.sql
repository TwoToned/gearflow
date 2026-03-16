-- CreateTable
CREATE TABLE "document_template" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "basePdf" TEXT NOT NULL,
    "schemas" TEXT NOT NULL,
    "settings" TEXT,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "isDraft" BOOLEAN NOT NULL DEFAULT true,
    "version" INTEGER NOT NULL DEFAULT 1,
    "thumbnailUrl" TEXT,
    "publishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "document_template_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "document_template_organizationId_type_idx" ON "document_template"("organizationId", "type");

-- AddForeignKey
ALTER TABLE "document_template" ADD CONSTRAINT "document_template_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
