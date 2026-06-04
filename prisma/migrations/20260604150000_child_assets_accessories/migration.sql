-- CreateEnum
CREATE TYPE "LineItemChildKind" AS ENUM ('KIT', 'ACCESSORY');

-- CreateEnum
CREATE TYPE "AccessoryAllocationMode" AS ENUM ('SHIPS_WITH', 'DEDICATED');

-- AlterTable
ALTER TABLE "asset" ADD COLUMN     "parentAssetId" TEXT;

-- AlterTable
ALTER TABLE "project_line_item" ADD COLUMN     "childKind" "LineItemChildKind";

-- CreateTable
CREATE TABLE "asset_bulk_child" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "parentAssetId" TEXT NOT NULL,
    "bulkAssetId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "allocationMode" "AccessoryAllocationMode" NOT NULL DEFAULT 'SHIPS_WITH',
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "notes" TEXT,
    "addedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "addedById" TEXT NOT NULL,

    CONSTRAINT "asset_bulk_child_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "asset_bulk_child_organizationId_idx" ON "asset_bulk_child"("organizationId");

-- CreateIndex
CREATE INDEX "asset_bulk_child_parentAssetId_idx" ON "asset_bulk_child"("parentAssetId");

-- CreateIndex
CREATE INDEX "asset_bulk_child_bulkAssetId_idx" ON "asset_bulk_child"("bulkAssetId");

-- CreateIndex
CREATE INDEX "asset_parentAssetId_idx" ON "asset"("parentAssetId");

-- AddForeignKey
ALTER TABLE "asset" ADD CONSTRAINT "asset_parentAssetId_fkey" FOREIGN KEY ("parentAssetId") REFERENCES "asset"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "asset_bulk_child" ADD CONSTRAINT "asset_bulk_child_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "asset_bulk_child" ADD CONSTRAINT "asset_bulk_child_parentAssetId_fkey" FOREIGN KEY ("parentAssetId") REFERENCES "asset"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "asset_bulk_child" ADD CONSTRAINT "asset_bulk_child_bulkAssetId_fkey" FOREIGN KEY ("bulkAssetId") REFERENCES "bulk_asset"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "asset_bulk_child" ADD CONSTRAINT "asset_bulk_child_addedById_fkey" FOREIGN KEY ("addedById") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

