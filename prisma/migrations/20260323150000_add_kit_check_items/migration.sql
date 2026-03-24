-- CreateTable
CREATE TABLE "kit_check_item" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "kitId" TEXT NOT NULL,
    "checkItemId" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "kit_check_item_pkey" PRIMARY KEY ("id")
);

-- AlterTable
ALTER TABLE "check_record" ADD COLUMN "kitId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "kit_check_item_kitId_checkItemId_key" ON "kit_check_item"("kitId", "checkItemId");

-- CreateIndex
CREATE INDEX "kit_check_item_organizationId_idx" ON "kit_check_item"("organizationId");

-- CreateIndex
CREATE INDEX "kit_check_item_organizationId_kitId_idx" ON "kit_check_item"("organizationId", "kitId");

-- AddForeignKey
ALTER TABLE "kit_check_item" ADD CONSTRAINT "kit_check_item_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kit_check_item" ADD CONSTRAINT "kit_check_item_kitId_fkey" FOREIGN KEY ("kitId") REFERENCES "kit"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kit_check_item" ADD CONSTRAINT "kit_check_item_checkItemId_fkey" FOREIGN KEY ("checkItemId") REFERENCES "check_item"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "check_record" ADD CONSTRAINT "check_record_kitId_fkey" FOREIGN KEY ("kitId") REFERENCES "kit"("id") ON DELETE SET NULL ON UPDATE CASCADE;
