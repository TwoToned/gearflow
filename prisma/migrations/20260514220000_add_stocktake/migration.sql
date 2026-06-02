-- CreateEnum
CREATE TYPE "StocktakeScope" AS ENUM ('FULL', 'CATEGORY', 'SPOT_CHECK');

-- CreateEnum
CREATE TYPE "StocktakeStatus" AS ENUM ('DRAFT', 'IN_PROGRESS', 'REVIEWING', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "StocktakeItemResult" AS ENUM ('MATCH', 'MISSING', 'UNEXPECTED', 'QUANTITY_MISMATCH', 'WRONG_LOCATION');

-- CreateTable
CREATE TABLE "stocktake" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "scope" "StocktakeScope" NOT NULL,
    "categoryId" TEXT,
    "status" "StocktakeStatus" NOT NULL DEFAULT 'DRAFT',
    "startedAt" TIMESTAMP(3),
    "startedById" TEXT,
    "completedAt" TIMESTAMP(3),
    "reviewedById" TEXT,
    "expectedCount" INTEGER NOT NULL DEFAULT 0,
    "foundCount" INTEGER NOT NULL DEFAULT 0,
    "missingCount" INTEGER NOT NULL DEFAULT 0,
    "unexpectedCount" INTEGER NOT NULL DEFAULT 0,
    "discrepancyCount" INTEGER NOT NULL DEFAULT 0,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "stocktake_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stocktake_item" (
    "id" TEXT NOT NULL,
    "stocktakeId" TEXT NOT NULL,
    "assetId" TEXT,
    "bulkAssetId" TEXT,
    "expectedAtLocation" BOOLEAN NOT NULL DEFAULT true,
    "expectedQuantity" INTEGER NOT NULL DEFAULT 1,
    "found" BOOLEAN NOT NULL DEFAULT false,
    "foundQuantity" INTEGER NOT NULL DEFAULT 0,
    "scannedAt" TIMESTAMP(3),
    "scannedById" TEXT,
    "result" "StocktakeItemResult" NOT NULL DEFAULT 'MATCH',
    "conditionNote" TEXT,
    "actionTaken" TEXT,

    CONSTRAINT "stocktake_item_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "stocktake_organizationId_idx" ON "stocktake"("organizationId");

-- CreateIndex
CREATE INDEX "stocktake_locationId_idx" ON "stocktake"("locationId");

-- CreateIndex
CREATE INDEX "stocktake_item_stocktakeId_idx" ON "stocktake_item"("stocktakeId");

-- CreateIndex
CREATE INDEX "stocktake_item_assetId_idx" ON "stocktake_item"("assetId");

-- CreateIndex
CREATE INDEX "stocktake_item_bulkAssetId_idx" ON "stocktake_item"("bulkAssetId");

-- AddForeignKey
ALTER TABLE "stocktake" ADD CONSTRAINT "stocktake_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stocktake" ADD CONSTRAINT "stocktake_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "location"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stocktake" ADD CONSTRAINT "stocktake_startedById_fkey" FOREIGN KEY ("startedById") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stocktake" ADD CONSTRAINT "stocktake_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stocktake_item" ADD CONSTRAINT "stocktake_item_stocktakeId_fkey" FOREIGN KEY ("stocktakeId") REFERENCES "stocktake"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stocktake_item" ADD CONSTRAINT "stocktake_item_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "asset"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stocktake_item" ADD CONSTRAINT "stocktake_item_bulkAssetId_fkey" FOREIGN KEY ("bulkAssetId") REFERENCES "bulk_asset"("id") ON DELETE SET NULL ON UPDATE CASCADE;
