-- AlterTable
ALTER TABLE "check_record" ADD COLUMN     "lineItemUnitId" TEXT;

-- AlterTable
ALTER TABLE "damage_event" ADD COLUMN     "lineItemUnitId" TEXT;

-- AlterTable
ALTER TABLE "project_line_item" ADD COLUMN     "assignedQuantity" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "damagedQuantity" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "lostQuantity" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "packedQuantity" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "project_line_item_unit" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "lineItemId" TEXT NOT NULL,
    "ordinal" INTEGER NOT NULL,
    "assetId" TEXT,
    "bulkAssetId" TEXT,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "returnedQuantity" INTEGER NOT NULL DEFAULT 0,
    "status" "LineItemStatus" NOT NULL DEFAULT 'CONFIRMED',
    "prepStatus" "PrepStatus",
    "prepContainer" TEXT,
    "checkedOutAt" TIMESTAMP(3),
    "checkedOutById" TEXT,
    "returnedAt" TIMESTAMP(3),
    "returnedById" TEXT,
    "returnCondition" "ReturnCondition",
    "returnStatus" "ReturnStatus",
    "returnNotes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "project_line_item_unit_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "project_line_item_unit_organizationId_assetId_status_idx" ON "project_line_item_unit"("organizationId", "assetId", "status");

-- CreateIndex
CREATE INDEX "project_line_item_unit_organizationId_bulkAssetId_status_idx" ON "project_line_item_unit"("organizationId", "bulkAssetId", "status");

-- CreateIndex
CREATE INDEX "project_line_item_unit_lineItemId_status_idx" ON "project_line_item_unit"("lineItemId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "project_line_item_unit_lineItemId_assetId_key" ON "project_line_item_unit"("lineItemId", "assetId");

-- CreateIndex
CREATE UNIQUE INDEX "project_line_item_unit_lineItemId_ordinal_key" ON "project_line_item_unit"("lineItemId", "ordinal");

-- CreateIndex
CREATE INDEX "check_record_lineItemUnitId_idx" ON "check_record"("lineItemUnitId");

-- CreateIndex
CREATE INDEX "damage_event_lineItemUnitId_idx" ON "damage_event"("lineItemUnitId");

-- AddForeignKey
ALTER TABLE "damage_event" ADD CONSTRAINT "damage_event_lineItemUnitId_fkey" FOREIGN KEY ("lineItemUnitId") REFERENCES "project_line_item_unit"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_line_item_unit" ADD CONSTRAINT "project_line_item_unit_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_line_item_unit" ADD CONSTRAINT "project_line_item_unit_lineItemId_fkey" FOREIGN KEY ("lineItemId") REFERENCES "project_line_item"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_line_item_unit" ADD CONSTRAINT "project_line_item_unit_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "asset"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_line_item_unit" ADD CONSTRAINT "project_line_item_unit_bulkAssetId_fkey" FOREIGN KEY ("bulkAssetId") REFERENCES "bulk_asset"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "check_record" ADD CONSTRAINT "check_record_lineItemUnitId_fkey" FOREIGN KEY ("lineItemUnitId") REFERENCES "project_line_item_unit"("id") ON DELETE SET NULL ON UPDATE CASCADE;

