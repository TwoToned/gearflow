-- AlterTable: Add isPrep to Kit
ALTER TABLE "kit" ADD COLUMN "isPrep" BOOLEAN NOT NULL DEFAULT false;

-- Clean up columns/tables from the old prep system (if they exist)
DROP INDEX IF EXISTS "project_line_item_prepId_idx";
ALTER TABLE "project_line_item" DROP COLUMN IF EXISTS "prepId";
ALTER TABLE "project_line_item" DROP COLUMN IF EXISTS "isPrepChild";
DROP TABLE IF EXISTS "prep_item";
DROP TABLE IF EXISTS "prep";
DROP TYPE IF EXISTS "PrepStatus";
