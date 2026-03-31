-- AlterEnum: Add OPTIMIZED to PricingType
ALTER TYPE "PricingType" ADD VALUE 'OPTIMIZED';

-- AlterTable: Add monthlyRate to Model
ALTER TABLE "model" ADD COLUMN "monthlyRate" DECIMAL(10,2);

-- AlterTable: Add billingMonths to Project
ALTER TABLE "project" ADD COLUMN "billingMonths" INTEGER;

-- AlterTable: Add billingMonths to ProjectGroup
ALTER TABLE "project_group" ADD COLUMN "billingMonths" INTEGER;

-- AlterTable: Add pricing optimization fields to ProjectLineItem
ALTER TABLE "project_line_item" ADD COLUMN "priceBreakdown" TEXT;
ALTER TABLE "project_line_item" ADD COLUMN "priceOverridden" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "project_line_item" ADD COLUMN "overrideReason" TEXT;

-- Data migration: Mark existing line items with unitPrice as manually priced
UPDATE "project_line_item" SET "priceOverridden" = true WHERE "unitPrice" IS NOT NULL;
