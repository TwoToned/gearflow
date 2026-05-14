-- Wave 2: drop the legacy `isSubhire` column from project_line_item.
--
-- Sub-hire detection now uses `subHireId != null` (single source of truth via
-- the SubHire entity). The audit found 0 legacy-only rows on dev DB
-- (where isSubhire=true AND subHireId IS NULL). Production check should
-- confirm the same before deploy:
--
--   SELECT COUNT(*) FROM project_line_item
--   WHERE "isSubhire" = true AND "subHireId" IS NULL;
--
-- If non-zero on prod, run a backfill that creates SubHire entities for those
-- rows before applying this migration.

ALTER TABLE "project_line_item" DROP COLUMN "isSubhire";
