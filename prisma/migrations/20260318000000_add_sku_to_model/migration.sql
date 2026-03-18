-- AlterTable
ALTER TABLE "model" ADD COLUMN "sku" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "model_organizationId_sku_key" ON "model"("organizationId", "sku");
