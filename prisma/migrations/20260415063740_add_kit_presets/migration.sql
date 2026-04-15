-- CreateTable
CREATE TABLE "kit_preset" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "categoryId" TEXT,
    "notes" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT NOT NULL,

    CONSTRAINT "kit_preset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "kit_preset_item" (
    "id" TEXT NOT NULL,
    "presetId" TEXT NOT NULL,
    "modelId" TEXT,
    "kitId" TEXT,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "notes" TEXT,

    CONSTRAINT "kit_preset_item_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "kit_preset_organizationId_idx" ON "kit_preset"("organizationId");

-- CreateIndex
CREATE INDEX "kit_preset_categoryId_idx" ON "kit_preset"("categoryId");

-- CreateIndex
CREATE INDEX "kit_preset_isActive_idx" ON "kit_preset"("isActive");

-- CreateIndex
CREATE INDEX "kit_preset_item_presetId_idx" ON "kit_preset_item"("presetId");

-- CreateIndex
CREATE INDEX "kit_preset_item_modelId_idx" ON "kit_preset_item"("modelId");

-- CreateIndex
CREATE INDEX "kit_preset_item_kitId_idx" ON "kit_preset_item"("kitId");

-- AddForeignKey
ALTER TABLE "kit_preset" ADD CONSTRAINT "kit_preset_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kit_preset" ADD CONSTRAINT "kit_preset_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "category"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kit_preset" ADD CONSTRAINT "kit_preset_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kit_preset_item" ADD CONSTRAINT "kit_preset_item_presetId_fkey" FOREIGN KEY ("presetId") REFERENCES "kit_preset"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kit_preset_item" ADD CONSTRAINT "kit_preset_item_modelId_fkey" FOREIGN KEY ("modelId") REFERENCES "model"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kit_preset_item" ADD CONSTRAINT "kit_preset_item_kitId_fkey" FOREIGN KEY ("kitId") REFERENCES "kit"("id") ON DELETE CASCADE ON UPDATE CASCADE;
