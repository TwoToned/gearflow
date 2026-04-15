-- Drop the never-used kit_preset tables (the KitPreset abstraction was
-- superseded by extending GroupTemplate to support rigid kits, since
-- GroupTemplate already does 80% of what KitPreset was going to do).

-- DropForeignKey
ALTER TABLE "kit_preset_item" DROP CONSTRAINT IF EXISTS "kit_preset_item_kitId_fkey";
ALTER TABLE "kit_preset_item" DROP CONSTRAINT IF EXISTS "kit_preset_item_modelId_fkey";
ALTER TABLE "kit_preset_item" DROP CONSTRAINT IF EXISTS "kit_preset_item_presetId_fkey";
ALTER TABLE "kit_preset" DROP CONSTRAINT IF EXISTS "kit_preset_categoryId_fkey";
ALTER TABLE "kit_preset" DROP CONSTRAINT IF EXISTS "kit_preset_createdById_fkey";
ALTER TABLE "kit_preset" DROP CONSTRAINT IF EXISTS "kit_preset_organizationId_fkey";

-- DropTable
DROP TABLE IF EXISTS "kit_preset_item";
DROP TABLE IF EXISTS "kit_preset";

-- Extend group_template_item so each row can reference EITHER a model or a
-- rigid kit. modelId becomes nullable; kitId is added. When a template is
-- applied, kit items call addKitLineItem and expand to the kit's children.

-- AlterTable
ALTER TABLE "group_template_item" ALTER COLUMN "modelId" DROP NOT NULL;
ALTER TABLE "group_template_item" ADD COLUMN "kitId" TEXT;
ALTER TABLE "group_template_item" ADD COLUMN "sortOrder" INTEGER NOT NULL DEFAULT 0;

-- CreateIndex
CREATE INDEX "group_template_item_kitId_idx" ON "group_template_item"("kitId");

-- AddForeignKey
ALTER TABLE "group_template_item" ADD CONSTRAINT "group_template_item_kitId_fkey" FOREIGN KEY ("kitId") REFERENCES "kit"("id") ON DELETE CASCADE ON UPDATE CASCADE;
