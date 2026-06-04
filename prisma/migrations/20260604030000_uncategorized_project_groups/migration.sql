-- Make ProjectGroup.categoryId nullable + change FK from CASCADE to SET NULL.
--
-- Why: v0.9.4.0 allows groups to live in the project's Uncategorized
-- zone, mirroring how SubHireGroup.targetCategoryId already works.
-- Switching the FK from ON DELETE CASCADE to ON DELETE SET NULL means
-- deleting a category now orphans its groups (they appear under
-- Uncategorized) instead of silently destroying them with their items.

ALTER TABLE "project_group"
  DROP CONSTRAINT "project_group_categoryId_fkey";

ALTER TABLE "project_group"
  ALTER COLUMN "categoryId" DROP NOT NULL;

ALTER TABLE "project_group"
  ADD CONSTRAINT "project_group_categoryId_fkey"
  FOREIGN KEY ("categoryId") REFERENCES "project_category"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
