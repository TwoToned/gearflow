-- CreateEnum
CREATE TYPE "KitCheckMode" AS ENUM ('KIT_LEVEL', 'PER_ITEM');

-- AlterTable
ALTER TABLE "kit" ADD COLUMN "checkMode" "KitCheckMode" NOT NULL DEFAULT 'KIT_LEVEL';
