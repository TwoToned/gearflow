-- CreateEnum: SubHirePricingMode
CREATE TYPE "SubHirePricingMode" AS ENUM ('ITEMIZED', 'ORDER_TOTAL');

-- CreateEnum: SubHirePaymentStatus
CREATE TYPE "SubHirePaymentStatus" AS ENUM ('UNPAID', 'PARTIALLY_PAID', 'PAID');

-- AlterTable: sub_hire — add fields added after initial migration
ALTER TABLE "sub_hire" ADD COLUMN "supplierReference" TEXT;
ALTER TABLE "sub_hire" ADD COLUMN "pricingMode" "SubHirePricingMode" NOT NULL DEFAULT 'ITEMIZED';
ALTER TABLE "sub_hire" ADD COLUMN "orderTotalCost" DECIMAL(10,2);
ALTER TABLE "sub_hire" ADD COLUMN "orderTotalCharge" DECIMAL(10,2);
ALTER TABLE "sub_hire" ADD COLUMN "paymentStatus" "SubHirePaymentStatus" NOT NULL DEFAULT 'UNPAID';
ALTER TABLE "sub_hire" ADD COLUMN "defaultTargetCategoryId" TEXT;
ALTER TABLE "sub_hire" ADD COLUMN "defaultTargetGroupId" TEXT;

-- AlterTable: sub_hire_item — add group, visibility, and placement fields
ALTER TABLE "sub_hire_item" ADD COLUMN "groupId" TEXT;
ALTER TABLE "sub_hire_item" ADD COLUMN "showOnQuote" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "sub_hire_item" ADD COLUMN "showOnDocs" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "sub_hire_item" ADD COLUMN "targetCategoryId" TEXT;
ALTER TABLE "sub_hire_item" ADD COLUMN "targetGroupId" TEXT;

-- CreateTable: sub_hire_group
CREATE TABLE "sub_hire_group" (
    "id" TEXT NOT NULL,
    "subHireId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "cost" DECIMAL(12,2),
    "charge" DECIMAL(12,2),
    "showOnQuote" BOOLEAN NOT NULL DEFAULT true,
    "showOnDocs" BOOLEAN NOT NULL DEFAULT false,
    "targetCategoryId" TEXT,
    "targetGroupId" TEXT,

    CONSTRAINT "sub_hire_group_pkey" PRIMARY KEY ("id")
);

-- CreateTable: sub_hire_media
CREATE TABLE "sub_hire_media" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "subHireId" TEXT NOT NULL,
    "fileId" TEXT NOT NULL,
    "type" "MediaType" NOT NULL DEFAULT 'DOCUMENT',
    "displayName" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sub_hire_media_pkey" PRIMARY KEY ("id")
);

-- AlterTable: project — add subHireCostTotal
ALTER TABLE "project" ADD COLUMN "subHireCostTotal" DECIMAL(12,2);

-- AlterTable: project_line_item — add subHireGroupId
ALTER TABLE "project_line_item" ADD COLUMN "subHireGroupId" TEXT;

-- CreateIndex: sub_hire_group
CREATE INDEX "sub_hire_group_subHireId_idx" ON "sub_hire_group"("subHireId");

-- CreateIndex: sub_hire_item groupId
CREATE INDEX "sub_hire_item_groupId_idx" ON "sub_hire_item"("groupId");

-- CreateIndex: sub_hire_media
CREATE UNIQUE INDEX "sub_hire_media_subHireId_fileId_key" ON "sub_hire_media"("subHireId", "fileId");
CREATE INDEX "sub_hire_media_organizationId_idx" ON "sub_hire_media"("organizationId");
CREATE INDEX "sub_hire_media_subHireId_idx" ON "sub_hire_media"("subHireId");

-- CreateIndex: project_line_item subHireGroupId
CREATE INDEX "project_line_item_subHireGroupId_idx" ON "project_line_item"("subHireGroupId");

-- AddForeignKey: sub_hire placement targets
ALTER TABLE "sub_hire" ADD CONSTRAINT "sub_hire_defaultTargetCategoryId_fkey" FOREIGN KEY ("defaultTargetCategoryId") REFERENCES "project_category"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "sub_hire" ADD CONSTRAINT "sub_hire_defaultTargetGroupId_fkey" FOREIGN KEY ("defaultTargetGroupId") REFERENCES "project_group"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey: sub_hire_item
ALTER TABLE "sub_hire_item" ADD CONSTRAINT "sub_hire_item_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "sub_hire_group"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "sub_hire_item" ADD CONSTRAINT "sub_hire_item_targetCategoryId_fkey" FOREIGN KEY ("targetCategoryId") REFERENCES "project_category"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "sub_hire_item" ADD CONSTRAINT "sub_hire_item_targetGroupId_fkey" FOREIGN KEY ("targetGroupId") REFERENCES "project_group"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey: sub_hire_group
ALTER TABLE "sub_hire_group" ADD CONSTRAINT "sub_hire_group_subHireId_fkey" FOREIGN KEY ("subHireId") REFERENCES "sub_hire"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "sub_hire_group" ADD CONSTRAINT "sub_hire_group_targetCategoryId_fkey" FOREIGN KEY ("targetCategoryId") REFERENCES "project_category"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "sub_hire_group" ADD CONSTRAINT "sub_hire_group_targetGroupId_fkey" FOREIGN KEY ("targetGroupId") REFERENCES "project_group"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey: sub_hire_media
ALTER TABLE "sub_hire_media" ADD CONSTRAINT "sub_hire_media_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "sub_hire_media" ADD CONSTRAINT "sub_hire_media_subHireId_fkey" FOREIGN KEY ("subHireId") REFERENCES "sub_hire"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "sub_hire_media" ADD CONSTRAINT "sub_hire_media_fileId_fkey" FOREIGN KEY ("fileId") REFERENCES "file_upload"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey: project_line_item subHireGroupId
ALTER TABLE "project_line_item" ADD CONSTRAINT "project_line_item_subHireGroupId_fkey" FOREIGN KEY ("subHireGroupId") REFERENCES "sub_hire_group"("id") ON DELETE SET NULL ON UPDATE CASCADE;
