-- Wave 3: photos on maintenance records.
--
-- Workshop staff want to attach before/after photos to repair tickets so
-- the next person knows what was wrong + what was done. Mirrors the
-- DamageEvent.photos shape — string URLs from /api/uploads.

ALTER TABLE "maintenance_record"
  ADD COLUMN "photos" TEXT[] DEFAULT ARRAY[]::TEXT[];
