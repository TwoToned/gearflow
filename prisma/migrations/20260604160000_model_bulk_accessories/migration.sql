-- CreateTable
CREATE TABLE "model_bulk_accessory" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "modelId" TEXT NOT NULL,
    "bulkAssetId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "notes" TEXT,
    "addedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "addedById" TEXT NOT NULL,

    CONSTRAINT "model_bulk_accessory_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "model_bulk_accessory_organizationId_idx" ON "model_bulk_accessory"("organizationId");

-- CreateIndex
CREATE INDEX "model_bulk_accessory_modelId_idx" ON "model_bulk_accessory"("modelId");

-- CreateIndex
CREATE INDEX "model_bulk_accessory_bulkAssetId_idx" ON "model_bulk_accessory"("bulkAssetId");

-- CreateIndex
CREATE UNIQUE INDEX "model_bulk_accessory_modelId_bulkAssetId_key" ON "model_bulk_accessory"("modelId", "bulkAssetId");

-- AddForeignKey
ALTER TABLE "model_bulk_accessory" ADD CONSTRAINT "model_bulk_accessory_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "model_bulk_accessory" ADD CONSTRAINT "model_bulk_accessory_modelId_fkey" FOREIGN KEY ("modelId") REFERENCES "model"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "model_bulk_accessory" ADD CONSTRAINT "model_bulk_accessory_bulkAssetId_fkey" FOREIGN KEY ("bulkAssetId") REFERENCES "bulk_asset"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "model_bulk_accessory" ADD CONSTRAINT "model_bulk_accessory_addedById_fkey" FOREIGN KEY ("addedById") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

