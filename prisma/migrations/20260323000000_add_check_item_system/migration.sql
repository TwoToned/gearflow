-- CreateEnum
CREATE TYPE "CheckItemType" AS ENUM ('PASS_FAIL', 'NOTES', 'MEASUREMENT', 'DROPDOWN');

-- CreateEnum
CREATE TYPE "CheckContext" AS ENUM ('PREP', 'RETURN', 'AD_HOC');

-- CreateEnum
CREATE TYPE "CheckResult" AS ENUM ('PASS', 'FAIL', 'NOTES_ONLY');

-- CreateEnum
CREATE TYPE "PrepStatus" AS ENUM ('PENDING', 'PULLED', 'FLAGGED_FAULTY', 'FLAGGED_TT_OVERDUE', 'PACKED');

-- CreateEnum
CREATE TYPE "ReturnStatus" AS ENUM ('PENDING', 'UNPACKED', 'STORED', 'DAMAGED', 'LOST');

-- AlterTable
ALTER TABLE "project_line_item" ADD COLUMN "prepStatus" "PrepStatus",
ADD COLUMN "returnStatus" "ReturnStatus";

-- CreateTable
CREATE TABLE "check_item" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "description" TEXT,
    "type" "CheckItemType" NOT NULL DEFAULT 'PASS_FAIL',
    "category" TEXT,
    "measurementUnit" TEXT,
    "measurementMin" DOUBLE PRECISION,
    "measurementMax" DOUBLE PRECISION,
    "dropdownOptions" JSONB,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "check_item_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "model_check_item" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "modelId" TEXT NOT NULL,
    "checkItemId" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "model_check_item_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "check_record" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "context" "CheckContext" NOT NULL,
    "lineItemId" TEXT,
    "assetId" TEXT NOT NULL,
    "bulkAssetId" TEXT,
    "checkItemId" TEXT NOT NULL,
    "checkItemLabelSnapshot" TEXT NOT NULL,
    "checkItemTypeSnapshot" "CheckItemType" NOT NULL,
    "result" "CheckResult" NOT NULL,
    "value" TEXT,
    "notes" TEXT,
    "photos" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "performedById" TEXT NOT NULL,
    "performedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "check_record_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "warehouse_close" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "closedById" TEXT NOT NULL,
    "closedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "storedCount" INTEGER NOT NULL DEFAULT 0,
    "damagedCount" INTEGER NOT NULL DEFAULT 0,
    "lostCount" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "warehouse_close_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "check_item_organizationId_idx" ON "check_item"("organizationId");

-- CreateIndex
CREATE INDEX "check_item_organizationId_category_idx" ON "check_item"("organizationId", "category");

-- CreateIndex
CREATE UNIQUE INDEX "model_check_item_modelId_checkItemId_key" ON "model_check_item"("modelId", "checkItemId");

-- CreateIndex
CREATE INDEX "model_check_item_organizationId_idx" ON "model_check_item"("organizationId");

-- CreateIndex
CREATE INDEX "model_check_item_organizationId_modelId_idx" ON "model_check_item"("organizationId", "modelId");

-- CreateIndex
CREATE INDEX "check_record_organizationId_idx" ON "check_record"("organizationId");

-- CreateIndex
CREATE INDEX "check_record_organizationId_assetId_idx" ON "check_record"("organizationId", "assetId");

-- CreateIndex
CREATE INDEX "check_record_organizationId_checkItemId_idx" ON "check_record"("organizationId", "checkItemId");

-- CreateIndex
CREATE INDEX "check_record_lineItemId_idx" ON "check_record"("lineItemId");

-- CreateIndex
CREATE INDEX "warehouse_close_organizationId_idx" ON "warehouse_close"("organizationId");

-- CreateIndex
CREATE INDEX "warehouse_close_organizationId_projectId_idx" ON "warehouse_close"("organizationId", "projectId");

-- AddForeignKey
ALTER TABLE "check_item" ADD CONSTRAINT "check_item_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "check_item" ADD CONSTRAINT "check_item_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "model_check_item" ADD CONSTRAINT "model_check_item_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "model_check_item" ADD CONSTRAINT "model_check_item_modelId_fkey" FOREIGN KEY ("modelId") REFERENCES "model"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "model_check_item" ADD CONSTRAINT "model_check_item_checkItemId_fkey" FOREIGN KEY ("checkItemId") REFERENCES "check_item"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "check_record" ADD CONSTRAINT "check_record_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "check_record" ADD CONSTRAINT "check_record_lineItemId_fkey" FOREIGN KEY ("lineItemId") REFERENCES "project_line_item"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "check_record" ADD CONSTRAINT "check_record_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "asset"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "check_record" ADD CONSTRAINT "check_record_bulkAssetId_fkey" FOREIGN KEY ("bulkAssetId") REFERENCES "bulk_asset"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "check_record" ADD CONSTRAINT "check_record_checkItemId_fkey" FOREIGN KEY ("checkItemId") REFERENCES "check_item"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "check_record" ADD CONSTRAINT "check_record_performedById_fkey" FOREIGN KEY ("performedById") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "warehouse_close" ADD CONSTRAINT "warehouse_close_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "warehouse_close" ADD CONSTRAINT "warehouse_close_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "warehouse_close" ADD CONSTRAINT "warehouse_close_closedById_fkey" FOREIGN KEY ("closedById") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;
